import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import type { InstallProgress } from "@bukitjalil/shared";

/**
 * Bukit 2.0.12 install (plan 8.1): official package for this platform, SHA-256 pinned in code (the
 * downloaded checksum files are not trusted), extracted by a strict reader that accepts only the
 * expected entries, staged in a temp directory and moved into place in one rename.
 */

export const BUKIT_VERSION = "2.0.12";
/** The oldest Bukit that works (`deploy --token-env` and the other 2.0.11 behaviour, plan 8.1). */
export const MIN_BUKIT_VERSION = "2.0.11";
/** Earlier app-managed installs (~/.bukitjalil/bin/bukit-<version>), still used until an upgrade replaces them. */
export const PREVIOUS_APP_VERSIONS: readonly string[] = ["2.0.11"];

export interface BukitPackage {
  file: string;
  sha256: string;
  /** Files the package must contain, and nothing else (besides the "./" directory entry). */
  files: readonly string[];
  executable: string;
}

const RELEASE_URL = `https://github.com/ALi365-SDN-BHD/Bukit/releases/download/v${BUKIT_VERSION}`;

/** Official packages by `${process.platform}-${process.arch}`. Windows is not an MVP platform (plan 1.2). */
export const PACKAGES: Record<string, BukitPackage> = {
  "darwin-arm64": {
    file: `bukit-${BUKIT_VERSION}-osx-arm64.tar.gz`,
    sha256: "0be48b9da79569988257650028517833a73907e1cd49c76d60fbcb243621c33a",
    files: ["bukit", "libSkiaSharp.dylib"],
    executable: "bukit",
  },
  "linux-x64": {
    file: `bukit-${BUKIT_VERSION}-linux-x64.tar.gz`,
    sha256: "1dbb37c0227570c25e71fd1ff9574c95f9217ded6c681add31f19e8653479823",
    files: ["bukit", "libSkiaSharp.so"],
    executable: "bukit",
  },
};

export function packageForPlatform(
  platform: string = process.platform,
  arch: string = process.arch,
): BukitPackage | null {
  return PACKAGES[`${platform}-${arch}`] ?? null;
}

export const packageUrl = (pkg: BukitPackage) => `${RELEASE_URL}/${pkg.file}`;

/** Why an install failed; the codes are the shared InstallProgress ones. */
export type InstallFailure = Extract<InstallProgress, { state: "failed" }>["code"];

export class InstallError extends Error {
  constructor(
    readonly code: InstallFailure,
    message: string,
  ) {
    super(message);
    this.name = "InstallError";
  }
}

const MAX_DOWNLOAD = 100 * 1024 * 1024;
const MAX_UNPACKED = 200 * 1024 * 1024;
/** The whole download may take this long (the package is ~30 MB)... */
const DOWNLOAD_TIMEOUT_MS = 15 * 60_000;
/** ...but must never go this long without receiving data (also covers connecting). */
const STALL_TIMEOUT_MS = 60_000;

/**
 * Download to memory with a size cap, reporting progress. Fails after `stallMs` without data or `totalMs`
 * overall, so a hung connection never leaves an install running forever. `fetchImpl` is injectable for tests.
 */
export async function download(
  url: string,
  onProgress: (received: number, total: number | null) => void,
  fetchImpl: typeof fetch = fetch,
  limits: { stallMs?: number; totalMs?: number } = {},
): Promise<Buffer> {
  const controller = new AbortController();
  const stallMs = limits.stallMs ?? STALL_TIMEOUT_MS;
  let timedOut: string | null = null;
  const abort = (why: string) => {
    timedOut ??= why;
    controller.abort();
  };
  const total = setTimeout(() => abort("download timed out"), limits.totalMs ?? DOWNLOAD_TIMEOUT_MS);
  let stall = setTimeout(() => abort("no data received"), stallMs);
  const alive = () => {
    clearTimeout(stall);
    stall = setTimeout(() => abort("no data received"), stallMs);
  };
  try {
    const res = await fetchImpl(url, { redirect: "follow", signal: controller.signal });
    if (!res.ok || !res.body) throw new InstallError("download_failed", `download failed: HTTP ${res.status}`);
    const length = Number(res.headers.get("content-length")) || null;
    if (length !== null && length > MAX_DOWNLOAD) throw new InstallError("too_large", "package is too large");
    const chunks: Uint8Array[] = [];
    let received = 0;
    const reader = res.body.getReader();
    controller.signal.addEventListener("abort", () => void reader.cancel().catch(() => {}), { once: true });
    for (;;) {
      const { done, value } = await reader.read();
      if (controller.signal.aborted) break;
      if (done) break;
      alive();
      received += value.length;
      if (received > MAX_DOWNLOAD) {
        await reader.cancel();
        throw new InstallError("too_large", "package is too large");
      }
      chunks.push(value);
      onProgress(received, length);
    }
    if (timedOut) throw new InstallError("download_failed", timedOut);
    return Buffer.concat(chunks);
  } catch (err) {
    if (err instanceof InstallError) throw err;
    throw new InstallError("download_failed", timedOut ?? `cannot download ${url}: ${(err as Error).message}`);
  } finally {
    clearTimeout(total);
    clearTimeout(stall);
  }
}

export function verifySha256(data: Buffer, expected: string): void {
  const actual = crypto.createHash("sha256").update(data).digest("hex");
  if (actual !== expected) {
    throw new InstallError("checksum_mismatch", `SHA-256 mismatch: expected ${expected}, got ${actual}`);
  }
}

/**
 * Read a .tar.gz and return its files. Only regular files whose normalized names are exactly `allowed`
 * are accepted, plus the "./" directory entry and the directories in `dirs`; links, devices, pax/GNU
 * extension headers, absolute paths, "..", duplicates and missing files all fail.
 */
export function readStrictTarGz(
  data: Buffer,
  allowed: readonly string[],
  dirs: readonly string[] = [],
): Map<string, { mode: number; data: Buffer }> {
  let tar: Buffer;
  try {
    tar = zlib.gunzipSync(data, { maxOutputLength: MAX_UNPACKED });
  } catch (err) {
    throw new InstallError("bad_archive", `cannot decompress: ${(err as Error).message}`);
  }
  const files = new Map<string, { mode: number; data: Buffer }>();
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break; // end of archive
    if (!checksumOk(header)) throw new InstallError("bad_archive", "bad tar header checksum");
    const name = cString(header, 0, 100);
    const prefix = cString(header, 345, 155);
    const full = prefix ? `${prefix}/${name}` : name;
    const size = octal(header, 124, 12);
    const mode = octal(header, 100, 8);
    const type = String.fromCharCode(header[156] ?? 0);
    const body = offset + 512;
    if (body + size > tar.length) throw new InstallError("bad_archive", "truncated tar entry");

    if (full.startsWith("/") || full.includes("\\") || full.includes("\0")) {
      throw new InstallError("bad_archive", `unsafe entry name: ${full}`);
    }
    const segments = full.split("/").filter((s) => s !== "" && s !== ".");
    if (segments.includes("..")) throw new InstallError("bad_archive", `unsafe entry name: ${full}`);
    const normalized = segments.join("/");

    if (type === "5") {
      if (normalized !== "" && !dirs.includes(normalized))
        throw new InstallError("bad_archive", `unexpected directory: ${full}`);
    } else if (type === "0" || type === "\0") {
      if (!allowed.includes(normalized)) throw new InstallError("bad_archive", `unexpected file: ${full}`);
      if (files.has(normalized)) throw new InstallError("bad_archive", `duplicate entry: ${full}`);
      files.set(normalized, { mode, data: Buffer.from(tar.subarray(body, body + size)) });
    } else {
      throw new InstallError("bad_archive", `entry type "${type}" is not allowed: ${full}`);
    }
    offset = body + Math.ceil(size / 512) * 512;
  }
  for (const f of allowed) if (!files.has(f)) throw new InstallError("bad_archive", `missing file: ${f}`);
  return files;
}

/**
 * Write the files into a fresh staging directory next to `target`, then replace `target` with one rename.
 * `target` is e.g. ~/.bukitjalil/bin/bukit-2.0.12.
 */
export function installFiles(
  files: Map<string, { mode: number; data: Buffer }>,
  target: string,
  executable: string,
): void {
  const parent = path.dirname(target);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const staging = fs.mkdtempSync(path.join(parent, `.staging-${path.basename(target)}-`));
  try {
    for (const [name, file] of files) {
      const mode = name === executable ? 0o755 : 0o644;
      fs.writeFileSync(path.join(staging, name), file.data, { mode, flag: "wx" });
    }
    fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(staging, target);
  } catch (err) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw err;
  }
}

/**
 * Write one file next to `target` and move it into place with one rename (e.g. ~/.bukitjalil/pi/bin/rg).
 * A directory in the way is removed first, since a rename cannot replace it.
 */
export function installFile(data: Buffer, target: string, mode: number): void {
  const parent = path.dirname(target);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const staging = path.join(parent, `.staging-${path.basename(target)}-${crypto.randomBytes(6).toString("hex")}`);
  try {
    fs.writeFileSync(staging, data, { mode, flag: "wx" });
    fs.chmodSync(staging, mode);
    if (fs.lstatSync(target, { throwIfNoEntry: false })?.isDirectory()) fs.rmSync(target, { recursive: true });
    fs.renameSync(staging, target);
  } catch (err) {
    fs.rmSync(staging, { force: true });
    throw err;
  }
}

/**
 * One install at a time, its progress read by polling (`progress`). The task reports download progress
 * and throws an InstallError to fail; when it returns, the job is done.
 */
export class InstallJob {
  progress: InstallProgress = { state: "idle" };
  private running: Promise<void> | null = null;

  constructor(private readonly task: (report: (progress: InstallProgress) => void) => Promise<void>) {}

  get busy(): boolean {
    return this.running !== null;
  }

  /** Start installing; returns false if an install is already running. */
  start(): boolean {
    if (this.running) return false;
    this.progress = { state: "downloading", received: 0, total: null };
    this.running = this.task((progress) => {
      this.progress = progress;
    })
      .then(
        () => {
          this.progress = { state: "done" };
        },
        (err: unknown) => {
          this.progress =
            err instanceof InstallError
              ? { state: "failed", code: err.code, message: err.message }
              : { state: "failed", code: "install_failed", message: (err as Error).message };
        },
      )
      .finally(() => {
        this.running = null;
      });
    return true;
  }

  /** Resolves when the current install (if any) has finished. */
  async wait(): Promise<void> {
    await this.running;
  }
}

function cString(buf: Buffer, start: number, length: number): string {
  const slice = buf.subarray(start, start + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? length : end).toString("utf8");
}

function octal(buf: Buffer, start: number, length: number): number {
  const text = cString(buf, start, length).trim();
  if (!/^[0-7]*$/.test(text)) throw new InstallError("bad_archive", "bad octal field");
  return text === "" ? 0 : Number.parseInt(text, 8);
}

function checksumOk(header: Buffer): boolean {
  const stored = octal(header, 148, 8);
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : (header[i] ?? 0);
  return sum === stored;
}
