import fs from "node:fs";
import path from "node:path";
import type {
  ConfigResponse,
  ConfigSummary,
  DataResponse,
  DataSource,
  FileResponse,
  ImageMime,
  PanelRef,
  ThemeResponse,
  TreeEntryView,
  TreeResponse,
} from "@bukitjalil/shared";
import { isRecord, pathProblem } from "../bukit/guard.ts";
import { pluginStatesFromConfig } from "../bukit/plugins.ts";
import {
  listTree,
  readBlob,
  readBlobAt,
  readBlobHead,
  readBlobs,
  resolveBranch,
  SYMLINK_MODE,
  type TreeEntry,
  treeEntryAt,
} from "../git/objects.ts";
import { GitError, type GitRunner } from "../git/run.ts";
import { SiteError } from "../sites/location.ts";
import type { SiteService } from "../sites/service.ts";
import { parseFrontMatter, parseYaml } from "./yaml.ts";

/** Text shown inline in the file panel. */
export const MAX_TEXT_BYTES = 1024 * 1024;
/** Images served with as=raw (and read to recognize them). */
export const MAX_RAW_BYTES = 16 * 1024 * 1024;
export const MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024;
const MAX_CONFIG_BYTES = 1024 * 1024;
/** Theme file lists, per list. */
const MAX_THEME_FILES = 2000;
/** Markdown files read for the data panel: count and bytes over all sources, and the size of each. */
const MAX_DATA_FILES = 2000;
const MAX_DATA_BYTES = 32 * 1024 * 1024;
const MAX_DATA_FILE_BYTES = 256 * 1024;
/** Enough bytes to recognize any of the bitmap types. */
const SNIFF_BYTES = 16;
// The panel shows one row as an example; sending more only slows it down.
const MAX_DATA_ITEMS = 1;
/** Entries a single directory listing returns; a huge directory must not freeze the file panel. */
const MAX_TREE_ENTRIES = 2000;

/** What the file route sends: JSON, or bytes for as=raw / as=download. */
export type FileResult =
  | { type: "json"; body: FileResponse }
  | { type: "raw"; data: Buffer; mime: ImageMime }
  | { type: "download"; data: Buffer; name: string };

interface Version {
  repo: string;
  ref: PanelRef;
  commit: string;
}

/**
 * Read-only panels (plan 5.3): everything comes from git objects of the chosen version, never from the
 * site's working directory, so untracked or ignored files (.env) never show up.
 */
export class PanelService {
  constructor(
    private readonly opts: {
      git: GitRunner;
      sites: SiteService;
      /** The snapshot of the site's open change set (ref=change), or null when none is open. */
      changeCommit: (siteId: string) => string | null;
    },
  ) {}

  // --- files ---

  async tree(siteId: string, ref: PanelRef, dir: string): Promise<TreeResponse> {
    return this.withVersion(siteId, ref, async (v) => {
      let entries: TreeEntry[];
      try {
        entries = await listTree(this.opts.git, v.repo, v.commit, dir ? { dir } : {});
      } catch (err) {
        if (!(err instanceof GitError && err.kind === "failed")) throw err;
        const entry = await this.entryAt(v, dir);
        throw entry ? new SiteError("panel.not_directory", 400) : new SiteError("panel.not_found", 404);
      }
      const views = entries.map(toView).sort((a, b) => kindOrder(a) - kindOrder(b) || compare(a.name, b.name));
      return {
        ref,
        commit: v.commit,
        path: dir,
        entries: views.slice(0, MAX_TREE_ENTRIES),
        truncated: views.length > MAX_TREE_ENTRIES,
      };
    });
  }

  async file(siteId: string, ref: PanelRef, filePath: string, as: "json" | "raw" | "download"): Promise<FileResult> {
    return this.withVersion(siteId, ref, async (v) => {
      const entry = await this.entryAt(v, filePath);
      if (!entry) throw new SiteError("panel.not_found", 404);
      const base = { ref, commit: v.commit, path: filePath };
      if (entry.type === "tree") throw new SiteError("panel.not_file", 400);
      if (entry.type === "commit" || entry.mode === SYMLINK_MODE) {
        if (as !== "json") throw new SiteError("panel.not_file", 400);
        if (entry.type === "commit") return { type: "json", body: { ...base, kind: "submodule", target: entry.oid } };
        const target = (await readBlob(this.opts.git, v.repo, entry.oid, 4096)).toString("utf8");
        return { type: "json", body: { ...base, kind: "symlink", target } };
      }

      const size = entry.size ?? 0;
      if (as === "download") {
        if (size > MAX_DOWNLOAD_BYTES) throw tooLarge(MAX_DOWNLOAD_BYTES);
        const data = await readBlob(this.opts.git, v.repo, entry.oid, MAX_DOWNLOAD_BYTES);
        return { type: "download", data, name: filePath.slice(filePath.lastIndexOf("/") + 1) };
      }
      if (as === "raw") {
        if (size > MAX_RAW_BYTES) throw tooLarge(MAX_RAW_BYTES);
        const data = await readBlob(this.opts.git, v.repo, entry.oid, MAX_RAW_BYTES);
        const mime = imageMime(data);
        // Only bitmaps are shown on the admin port; SVG, HTML and PDF can run script (plan 9.1).
        if (!mime) throw new SiteError("panel.not_file", 400);
        return { type: "raw", data, mime };
      }
      // json: past the inline limit only the first bytes are read, to tell an image from the rest.
      if (size > MAX_TEXT_BYTES) {
        const mime = imageMime(await readBlobHead(this.opts.git, v.repo, entry.oid, SNIFF_BYTES));
        if (mime && size <= MAX_RAW_BYTES) return { type: "json", body: { ...base, kind: "image", size, mime } };
        return { type: "json", body: { ...base, kind: "too_large", size } };
      }
      const data = await readBlob(this.opts.git, v.repo, entry.oid, MAX_TEXT_BYTES);
      const mime = imageMime(data);
      if (mime) return { type: "json", body: { ...base, kind: "image", size, mime } };
      const text = decodeText(data);
      if (text === null) return { type: "json", body: { ...base, kind: "binary", size } };
      return { type: "json", body: { ...base, kind: "text", size, content: text } };
    });
  }

  // --- config ---

  async config(siteId: string, ref: PanelRef): Promise<ConfigResponse> {
    return this.withVersion(siteId, ref, async (v) => {
      const { raw, config, error } = await this.siteConfig(v);
      return { ref, commit: v.commit, raw, error, config, summary: config ? summarizeConfig(config) : null };
    });
  }

  // --- theme ---

  async theme(siteId: string, ref: PanelRef): Promise<ThemeResponse> {
    return this.withVersion(siteId, ref, async (v) => {
      const { config, error: configError } = await this.siteConfig(v);
      const theme = isRecord(config?.theme) ? config.theme : {};
      const empty: ThemeResponse = {
        ref,
        commit: v.commit,
        name: null,
        dir: null,
        manifestRaw: null,
        manifest: null,
        error: configError,
        layouts: [],
        assets: [],
        static: [],
        truncated: false,
        params: theme.params ?? null,
      };
      const name = typeof theme.name === "string" && pathProblem(theme.name, true) === null ? theme.name : null;
      if (!name) return empty;
      const dir = `themes/${name}`;
      const dirEntry = await this.entryAt(v, dir);
      if (dirEntry?.type !== "tree") return { ...empty, name };

      const manifestRaw = await this.readText(v, `${dir}/theme.yaml`, MAX_CONFIG_BYTES);
      const manifest = manifestRaw === null ? null : parseYaml(manifestRaw);
      let truncated = false;
      const files = async (key: "layouts" | "assets" | "static") => {
        const sub = typeof theme[key] === "string" ? (theme[key] as string) : key;
        if (pathProblem(sub) !== null) return [];
        const list = await this.blobsUnder(v, normalizeTreePath(`${dir}/${sub}`));
        if (list.length > MAX_THEME_FILES) truncated = true;
        return list.slice(0, MAX_THEME_FILES).map((e) => e.path.slice(dir.length + 1));
      };
      return {
        ...empty,
        name,
        dir,
        manifestRaw,
        manifest: manifest?.value ?? null,
        error: manifest?.error ?? configError,
        layouts: await files("layouts"),
        assets: await files("assets"),
        static: await files("static"),
        truncated,
      };
    });
  }

  // --- data ---

  async data(siteId: string, ref: PanelRef): Promise<DataResponse> {
    return this.withVersion(siteId, ref, async (v) => {
      const { config } = await this.siteConfig(v);
      const content = isRecord(config?.content) ? config.content : {};
      const sources = Array.isArray(content.sources) ? content.sources : [];
      let fileBudget = MAX_DATA_FILES;
      let byteBudget = MAX_DATA_BYTES;
      let truncated = false;
      const out: DataSource[] = [];
      for (const [index, source] of sources.entries()) {
        const s = isRecord(source) ? source : {};
        const base = { index, name: str(s.name), mode: str(s.mode), collection: str(s.collection) };
        const type = str(s.type) ?? (isRecord(s.markdown) ? "markdown" : isRecord(s.notion) ? "notion" : null);
        if (type === "notion") {
          const notion = isRecord(s.notion) ? s.notion : {};
          out.push({ ...base, type: "notion", databaseId: str(notion.databaseId), cacheMode: str(notion.cacheMode) });
          continue;
        }
        if (type !== "markdown") {
          out.push({ ...base, type: "other", sourceType: type });
          continue;
        }
        const markdown = isRecord(s.markdown) ? s.markdown : {};
        const dir = str(markdown.dir);
        // "content/posts/", "./data" and "." name the same directories Bukit reads.
        const files =
          dir !== null && pathProblem(dir) === null
            ? (await this.blobsUnder(v, normalizeTreePath(dir))).filter((e) => /\.(md|markdown)$/i.test(e.path))
            : [];
        const readable: TreeEntry[] = [];
        for (const e of files) {
          // Files over the per-file limit are listed as invalid without being read.
          const cost = (e.size ?? 0) <= MAX_DATA_FILE_BYTES ? (e.size ?? 0) : 0;
          if (fileBudget === 0 || cost > byteBudget) {
            truncated = true;
            break;
          }
          readable.push(e);
          fileBudget -= 1;
          byteBudget -= cost;
        }
        const card = await this.markdownCard(v, readable, base.mode === "data");
        const index_ = isRecord(s.dataIndex) ? s.dataIndex : null;
        out.push({
          ...base,
          type: "markdown",
          dir,
          fileCount: files.length,
          ...card,
          dataIndex: index_
            ? { scopeField: str(index_.scopeField), keyField: str(index_.keyField), valueField: str(index_.valueField) }
            : null,
        });
      }
      return { ref, commit: v.commit, sources: out, truncated };
    });
  }

  private async markdownCard(v: Version, files: TreeEntry[], withItems: boolean) {
    const small = files.filter((e) => (e.size ?? 0) <= MAX_DATA_FILE_BYTES);
    const invalid = files.filter((e) => (e.size ?? 0) > MAX_DATA_FILE_BYTES).map((e) => e.path);
    const blobs = await readBlobs(
      this.opts.git,
      v.repo,
      small.map((e) => e.oid),
      small.reduce((n, e) => n + (e.size ?? 0), 0),
    );
    const counts = new Map<string, number>();
    const items: { file: string; data: Record<string, unknown> }[] = [];
    let itemsTruncated = false;
    for (const e of small) {
      const blob = blobs.get(e.oid);
      const parsed = blob ? parseFrontMatter(blob.toString("utf8")) : null;
      if (!parsed || parsed.error !== null || !isRecord(parsed.value)) {
        invalid.push(e.path);
        continue;
      }
      for (const key of Object.keys(parsed.value)) counts.set(key, (counts.get(key) ?? 0) + 1);
      if (withItems && items.length < MAX_DATA_ITEMS) items.push({ file: e.path, data: parsed.value });
      else if (withItems) itemsTruncated = true;
    }
    const fields = [...counts]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || compare(a.name, b.name));
    return { fields, invalid: invalid.sort(compare), items, itemsTruncated };
  }

  // --- shared ---

  /** Resolve the version and turn git failures about the repository into API errors. */
  private async withVersion<T>(siteId: string, ref: PanelRef, fn: (v: Version) => Promise<T>): Promise<T> {
    const site = this.opts.sites.get(siteId);
    const changeCommit = ref === "change" ? this.opts.changeCommit(siteId) : null;
    if (ref === "change" && changeCommit === null) throw new SiteError("change.not_found", 404);
    if (!fs.existsSync(site.path)) throw new SiteError("fs.not_found", 404);
    if (!fs.existsSync(path.join(site.path, ".git"))) throw new SiteError("site.not_repo", 409);
    try {
      // The snapshot is pinned by refs/bukitjalil/changes/<id>, so it is always there.
      if (changeCommit !== null) return await fn({ repo: site.path, ref, commit: changeCommit });
      let commit: string;
      try {
        commit = await resolveBranch(this.opts.git, site.path, site.defaultBranch);
      } catch (err) {
        if (err instanceof GitError && err.kind === "failed") {
          // A broken .git fails the same command; only a readable repository can be missing a branch.
          if (/not a git repository|cannot locate the git directory/i.test(err.message)) {
            throw new SiteError("site.not_repo", 409);
          }
          throw new SiteError("site.branch_missing", 409, { branch: site.defaultBranch });
        }
        throw err;
      }
      return await fn({ repo: site.path, ref, commit });
    } catch (err) {
      if (err instanceof GitError && (err.kind === "unsafe_repo" || err.kind === "dubious_ownership")) {
        throw new SiteError("site.repo_unsafe", 409);
      }
      if (err instanceof GitError && err.kind === "output_too_large") {
        throw tooLarge(err.details.max ?? MAX_DOWNLOAD_BYTES);
      }
      throw err;
    }
  }

  private entryAt(v: Version, p: string): Promise<TreeEntry | null> {
    return treeEntryAt(this.opts.git, v.repo, v.commit, p);
  }

  /** All regular files below `dir` ("" for the whole tree; none if it is missing or not a directory). */
  private async blobsUnder(v: Version, dir: string): Promise<TreeEntry[]> {
    if (dir !== "" && (await this.entryAt(v, dir))?.type !== "tree") return [];
    const all = await listTree(this.opts.git, v.repo, v.commit, { dir, recursive: true });
    return all.filter((e) => e.type === "blob" && e.mode !== SYMLINK_MODE).sort((a, b) => compare(a.path, b.path));
  }

  private async readText(v: Version, p: string, maxBytes: number): Promise<string | null> {
    return (await readBlobAt(this.opts.git, v.repo, v.commit, p, maxBytes))?.toString("utf8") ?? null;
  }

  private async siteConfig(
    v: Version,
  ): Promise<{ raw: string | null; config: Record<string, unknown> | null; error: string | null }> {
    const raw = await this.readText(v, "site.yaml", MAX_CONFIG_BYTES);
    if (raw === null) return { raw, config: null, error: null };
    const parsed = parseYaml(raw);
    if (parsed.error !== null) return { raw, config: null, error: parsed.error };
    if (!isRecord(parsed.value)) return { raw, config: null, error: "not a mapping" };
    return { raw, config: parsed.value, error: null };
  }
}

/** The structured view of site.yaml shown in the config panel and given to the AI (site_info). */
export function summarizeConfig(config: Record<string, unknown>): ConfigSummary {
  const site = isRecord(config.site) ? config.site : {};
  const content = isRecord(config.content) ? config.content : {};
  const build = isRecord(config.build) ? config.build : {};
  const theme = isRecord(config.theme) ? config.theme : {};
  const collections = isRecord(site.collections) ? site.collections : {};
  const sources = Array.isArray(content.sources) ? content.sources : [];
  return {
    site: {
      name: str(site.name),
      title: str(site.title),
      description: str(site.description),
      url: str(site.url),
      baseUrl: str(site.baseUrl),
      language: str(site.language),
      languages: Array.isArray(site.languages)
        ? site.languages.map((l) => (isRecord(l) ? (str(l.code) ?? str(l.language)) : str(l))).filter((l) => l !== null)
        : [],
      timezone: str(site.timezone),
    },
    collections: Object.entries(collections).map(([name, c]) => ({
      name,
      permalink: isRecord(c) ? str(c.permalink) : null,
      listRoute: isRecord(c) ? str(c.listRoute) : null,
    })),
    sources: sources.map((s) => {
      const r = isRecord(s) ? s : {};
      return { name: str(r.name), type: str(r.type), mode: str(r.mode), collection: str(r.collection) };
    }),
    build: { output: str(build.output), draft: bool(build.draft), clean: bool(build.clean) },
    theme: { name: str(theme.name) },
    plugins: isRecord(site.plugins) ? Object.keys(site.plugins) : [],
    pluginStates: pluginStatesFromConfig(config),
    otherSections: Object.keys(config).filter((k) => !["site", "content", "build", "theme"].includes(k)),
  };
}

function toView(e: TreeEntry): TreeEntryView {
  const kind =
    e.type === "tree" ? "dir" : e.type === "commit" ? "submodule" : e.mode === SYMLINK_MODE ? "symlink" : "file";
  return { name: e.path.slice(e.path.lastIndexOf("/") + 1), path: e.path, kind, size: e.size };
}

const kindOrder = (e: TreeEntryView) => (e.kind === "dir" ? 0 : 1);
/** Code point order: the same for every locale and stable for tests. */
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** Drop empty and "." parts: "./content/posts/" is "content/posts", "." is the root (""). */
const normalizeTreePath = (p: string) =>
  p
    .split("/")
    .filter((s) => s !== "" && s !== ".")
    .join("/");
const tooLarge = (max: number) => new SiteError("panel.too_large", 400, { max: String(max) });
const str = (v: unknown): string | null => (typeof v === "string" ? v : typeof v === "number" ? String(v) : null);
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);

/** A bitmap type recognized by its first bytes; the file name does not count. */
export function imageMime(data: Buffer): ImageMime | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  const head = data.subarray(0, 6).toString("latin1");
  if (head === "GIF87a" || head === "GIF89a") return "image/gif";
  if (
    data.length >= 12 &&
    data.subarray(0, 4).toString("latin1") === "RIFF" &&
    data.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/** UTF-8 text without NUL bytes, or null. */
export function decodeText(data: Buffer): string | null {
  if (data.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    return null;
  }
}
