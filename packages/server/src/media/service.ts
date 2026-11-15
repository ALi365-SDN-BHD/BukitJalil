import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { MediaMime, MediaUploadRequest, MediaUploadResult } from "@bukitjalil/shared";
import { GateError, PathGate } from "../agent/gate.ts";
import { isRecord } from "../bukit/guard.ts";
import type { ChangeService } from "../changes/service.ts";
import { readBlobAt } from "../git/objects.ts";
import type { GitRunner } from "../git/run.ts";
import type { Logger } from "../log.ts";
import { foldName } from "../names.ts";
import { parseYaml } from "../panels/yaml.ts";
import type { AppPaths } from "../paths.ts";
import { SiteError } from "../sites/location.ts";
import type { SiteLocks } from "../sites/locks.ts";
import type { SiteService } from "../sites/service.ts";
import { assertNoSymlinks, assertSafePath, mediaDir, mediaUrl } from "./dir.ts";
import { hasJpegLocation } from "./location.ts";
import { normalizeMediaName } from "./names.ts";
import { sniffMedia } from "./sniff.ts";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_SITE_YAML = 1024 * 1024;
/** Simple linear check; the nested-group form overflows V8's stack on a 10 MiB value. */
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const EXT: Record<MediaMime, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

const invalidBody = () => new SiteError("request.invalid_body", 400);
const badName = () => new SiteError("media.bad_name", 400);
const dirUnsafe = () => new SiteError("media.dir_unsafe", 409);
const configInvalid = () => new SiteError("media.config_invalid", 409);

export interface MediaServiceOptions {
  git: GitRunner;
  sites: SiteService;
  changes: ChangeService;
  locks: SiteLocks;
  paths: AppPaths;
  logger: Logger;
}

/** Uploads write only the AI working copy; the change set snapshot is what gets reviewed (design 4.3). */
export class MediaService {
  constructor(private readonly opts: MediaServiceOptions) {}

  async upload(siteId: string, req: MediaUploadRequest): Promise<MediaUploadResult> {
    const site = this.opts.sites.get(siteId);
    if (site.readOnly) throw new SiteError("site.read_only", 409);
    return this.opts.locks.run(siteId, "media", async () => {
      const decoded = decode(req);
      const { cwd, change, created } = await this.opts.changes.beginUserChange(siteId);
      let snapshotted = false;
      let backup: string | null = null;
      let target: string | null = null;
      let existingAbs: string | null = null;
      let tmpDir: string | null = null;
      let targetWritten = false;
      try {
        // app home may be reached through /var -> /private/var; resolve once so every path check and git
        // call uses the same form (the worktree path itself can stay a symlinked path).
        const root = fs.realpathSync.native(cwd);
        const config = await this.readConfig(site.path, change.snapshotCommit);
        // The URL follows the default branch: deploy settings commit there directly (design 4.2).
        const base = await this.readConfig(site.path, await this.opts.sites.headOf(site));
        const uploadDir = mediaDir(root, config);
        assertSafePath(root, uploadDir);
        const gate = new PathGate(root);
        const realDir = this.gated(gate, uploadDir);
        // Check the requested path, not the gate's resolved one: every level must be free of symlinks.
        assertNoSymlinks(root, path.join(uploadDir, decoded.name));
        target = path.join(realDir, decoded.name);
        this.gated(gate, target);
        const rel = path.relative(root, target).split(path.sep).join("/");
        const ignored = await this.opts.git.run(["check-ignore", "-q", "--", rel], {
          cwd: root,
          okCodes: [0, 1],
        });
        if (ignored.code === 0) throw dirUnsafe();

        const dirStat = fs.lstatSync(realDir, { throwIfNoEntry: false });
        if (dirStat && !dirStat.isDirectory()) throw dirUnsafe();
        fs.mkdirSync(realDir, { recursive: true, mode: 0o700 });
        const existing = findExisting(realDir, decoded.name);
        if (existing && !req.replace) {
          throw new SiteError("media.exists", 409, { name: existing });
        }
        existingAbs = existing ? path.join(realDir, existing) : null;
        if (existingAbs) {
          const stat = fs.lstatSync(existingAbs);
          if (stat.isSymbolicLink() || !stat.isFile()) throw dirUnsafe();
        }

        tmpDir = path.join(this.opts.paths.worktrees, siteId, ".upload-tmp");
        fs.mkdirSync(path.dirname(tmpDir), { recursive: true, mode: 0o700 });
        fs.rmSync(tmpDir, { recursive: true, force: true });
        fs.mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
        const temp = path.join(tmpDir, `upload-${crypto.randomBytes(8).toString("hex")}`);
        fs.writeFileSync(temp, decoded.data, { mode: 0o644 });
        if (existingAbs) {
          backup = path.join(tmpDir, "backup");
          fs.renameSync(existingAbs, backup);
        }
        fs.renameSync(temp, target);
        targetWritten = true;
        await this.opts.changes.snapshot(siteId, root);
        snapshotted = true;
        if (backup) {
          try {
            fs.rmSync(backup, { force: true });
          } catch (err) {
            this.opts.logger.log("warn", "media.backup_cleanup_failed", { siteId, error: String(err) });
          }
          backup = null;
        }
        return {
          path: rel,
          url: mediaUrl(isRecord(base.site) ? base.site.baseUrl : undefined, decoded.name),
          size: decoded.data.length,
          mime: decoded.mime,
          replaced: existingAbs !== null,
          location: decoded.location,
          changeId: change.id,
        };
      } catch (err) {
        if (!snapshotted && targetWritten && target && fs.existsSync(target)) {
          try {
            fs.rmSync(target, { force: true });
          } catch (cleanupErr) {
            this.opts.logger.log("warn", "media.rollback_failed", { siteId, error: String(cleanupErr) });
          }
        }
        if (!snapshotted && backup && existingAbs) {
          try {
            fs.renameSync(backup, existingAbs);
            backup = null;
          } catch (cleanupErr) {
            this.opts.logger.log("warn", "media.rollback_failed", { siteId, error: String(cleanupErr) });
          }
        }
        if (created && !snapshotted) {
          try {
            await this.opts.changes.discard(change.id);
          } catch (cleanupErr) {
            this.opts.logger.log("warn", "media.discard_failed", {
              siteId,
              changeId: change.id,
              error: String(cleanupErr),
            });
          }
        }
        throw err;
      } finally {
        if (tmpDir && (!backup || !fs.existsSync(backup))) fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  }

  private gated(gate: PathGate, abs: string): string {
    try {
      return gate.check(abs, "write");
    } catch (err) {
      if (err instanceof GateError) throw dirUnsafe();
      throw err;
    }
  }

  private async readConfig(repo: string, commit: string): Promise<Record<string, unknown>> {
    try {
      const raw = await readBlobAt(this.opts.git, repo, commit, "site.yaml", MAX_SITE_YAML);
      if (!raw) throw configInvalid();
      const parsed = parseYaml(raw.toString("utf8"));
      if (parsed.error !== null || !isRecord(parsed.value)) throw configInvalid();
      return parsed.value;
    } catch (err) {
      if (err instanceof SiteError) throw err;
      throw configInvalid();
    }
  }
}

function decode(req: MediaUploadRequest): { data: Buffer; name: string; mime: MediaMime; location: boolean } {
  if (req.data.length % 4 !== 0 || !BASE64.test(req.data)) throw invalidBody();
  if (req.name.length > 255 || [...req.name].some((ch) => (ch.codePointAt(0) ?? 0) < 32 || ch === "\u007f")) {
    throw badName();
  }
  const dot = req.name.lastIndexOf(".");
  if (dot <= 0 || dot === req.name.length - 1) throw badName();
  const data = Buffer.from(req.data, "base64");
  if (data.length === 0) throw new SiteError("media.empty", 400);
  if (data.length > MAX_BYTES) throw new SiteError("media.too_large", 400, { max: String(MAX_BYTES) });
  const mime = sniffMedia(data);
  if (!mime) throw new SiteError("media.unsupported_type", 400);
  const ext = req.name.slice(dot + 1).toLowerCase() === "jpeg" ? "jpg" : req.name.slice(dot + 1).toLowerCase();
  if (ext !== EXT[mime]) throw new SiteError("media.type_mismatch", 400);
  const name = normalizeMediaName(req.name);
  return { data, name, mime, location: mime === "image/jpeg" ? hasJpegLocation(data) : false };
}

/** The actual name in the directory that folds to `name`, or null; more than one is unsafe. */
function findExisting(dir: string, name: string): string | null {
  const wanted = foldName(name);
  const matches = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => foldName(entry.name) === wanted)
    .map((entry) => entry.name);
  if (matches.length > 1) throw dirUnsafe();
  return matches[0] ?? null;
}
