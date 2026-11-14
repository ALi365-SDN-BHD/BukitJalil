import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import type { InstallProgress } from "@bukitjalil/shared";
import { unzipSync } from "fflate";

/**
 * Bukit packages (plan 8.1): Bukit ships inside BukitJalil, like Pi. The packaging script and
 * `pnpm fetch:bukit` download the official package for `BUKIT_VERSION`, check it against the SHA-256 fixed
 * here and unpack it strictly; the app itself never downloads or upgrades Bukit. Raising Bukit means changing
 * `BUKIT_VERSION` and the three checksums, then releasing BukitJalil.
 */

export const BUKIT_VERSION = "2.2.1";
/**
 * The oldest Bukit that works (`--secrets-stdin` and `site.languages` as the only language setting, plan 8.7), for a
 * development copy picked with BUKITJALIL_BUKIT_DIR. Raise it to the first release with a behaviour
 * BukitJalil starts to rely on, and add a test for that behaviour to test/bukit-behavior.test.ts.
 */
export const MIN_BUKIT_VERSION = "2.2.1";

export interface BukitPackage {
  file: string;
  sha256: string;
  /** Files the package must contain, and nothing else (besides the "./" directory entry). */
  files: readonly string[];
  executable: string;
}

const RELEASE_URL = `https://github.com/ALi365-SDN-BHD/Bukit/releases/download/v${BUKIT_VERSION}`;

/** Official packages by `<platform>-<arch>`: macOS arm64, Linux x64 and Windows x64. */
export const PACKAGES: Record<string, BukitPackage> = {
  "darwin-arm64": {
    file: `bukit-${BUKIT_VERSION}-osx-arm64.tar.gz`,
    sha256: "9fa70725bb2c31415e067bfeb7f1b3d8714910fdc2d6ee58b262123e546d5ef7",
    files: ["bukit", "libSkiaSharp.dylib"],
    executable: "bukit",
  },
  "linux-x64": {
    file: `bukit-${BUKIT_VERSION}-linux-x64.tar.gz`,
    sha256: "6b062296cb362cd7dcb4c9ae75daa7ff325ec4ca91cce557cb9e252cb3244b09",
    files: ["bukit", "libSkiaSharp.so"],
    executable: "bukit",
  },
  "win32-x64": {
    file: `bukit-${BUKIT_VERSION}-win-x64.zip`,
    sha256: "5dbcb7a645b3efd2b264a9a2238800918f13eba5f2dccd68fce9ec1b9a81696f",
    files: ["bukit.exe", "libSkiaSharp.dll"],
    executable: "bukit.exe",
  },
};

export function packageForPlatform(
  platform: string = process.platform,
  arch: string = process.arch,
): BukitPackage | null {
  return PACKAGES[`${platform}-${arch}`] ?? null;
}

export const packageUrl = (pkg: BukitPackage) => `${RELEASE_URL}/${pkg.file}`;

/** The files of a downloaded package, checked strictly (tar.gz or, on Windows, zip). */
export function readPackage(pkg: BukitPackage, data: Buffer): Map<string, { mode: number; data: Buffer }> {
  return pkg.file.endsWith(".zip") ? readStrictZip(data, pkg.files) : readStrictTarGz(data, pkg.files);
}

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
 * `target` is e.g. ~/.bukitjalil/bin/bukit-2.0.15.
 */
/**
 * Strict ZIP reader for the Windows Bukit package: only the expected files, no traversal, and a cap on
 * the unpacked size. The archive is small and its SHA-256 was checked before this runs.
 */
export function readStrictZip(data: Buffer, allowed: readonly string[]): Map<string, { mode: number; data: Buffer }> {
  const files = new Map<string, { mode: number; data: Buffer }>();
  let total = 0;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(data), {
      filter: (file) => {
        if (file.name.endsWith("/")) return false;
        total += file.originalSize;
        if (total > MAX_UNPACKED) throw new InstallError("too_large", "package is too large when unpacked");
        if (!allowed.includes(file.name)) throw new InstallError("bad_archive", `unexpected file: ${file.name}`);
        return true;
      },
    });
  } catch (err) {
    if (err instanceof InstallError) throw err;
    throw new InstallError("bad_archive", `cannot decompress: ${(err as Error).message}`);
  }
  for (const [name, bytes] of Object.entries(entries)) {
    files.set(name, { mode: 0o644, data: Buffer.from(bytes) });
  }
  for (const name of allowed) if (!files.has(name)) throw new InstallError("bad_archive", `missing file: ${name}`);
  return files;
}

const MAX_ZIP_FILES = 5000;

/** Strict ZIP tree reader for Git for Windows MinGit: safe relative names, bounded file count and size. */
export function readZipTree(data: Buffer): Map<string, { mode: number; data: Buffer }> {
  const files = new Map<string, { mode: number; data: Buffer }>();
  let total = 0;
  let count = 0;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(data), {
      filter: (file) => {
        if (file.name.endsWith("/")) return false;
        if (
          file.name.length > 1024 ||
          file.name.includes("\\") ||
          file.name.includes("\0") ||
          file.name.startsWith("/") ||
          file.name.split("/").some((part) => part === "" || part === "." || part === "..")
        ) {
          throw new InstallError("bad_archive", `unsafe entry name: ${file.name}`);
        }
        count++;
        if (count > MAX_ZIP_FILES) throw new InstallError("too_large", "too many files in the archive");
        total += file.originalSize;
        if (total > MAX_UNPACKED) throw new InstallError("too_large", "package is too large when unpacked");
        return true;
      },
    });
  } catch (err) {
    if (err instanceof InstallError) throw err;
    throw new InstallError("bad_archive", `cannot decompress: ${(err as Error).message}`);
  }
  if (Object.keys(entries).length === 0) throw new InstallError("bad_archive", "archive is empty");
  for (const [name, bytes] of Object.entries(entries)) {
    files.set(name, { mode: 0o644, data: Buffer.from(bytes) });
  }
  return files;
}

/** Write a validated ZIP tree into `target`, replacing an earlier app-managed copy. */
export function installTree(files: Map<string, { mode: number; data: Buffer }>, target: string): void {
  const parent = path.dirname(target);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const staging = fs.mkdtempSync(path.join(parent, `.staging-${path.basename(target)}-`));
  try {
    for (const [name, file] of files) {
      const filePath = path.join(staging, name);
      fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o755 });
      fs.writeFileSync(filePath, file.data, { mode: name.endsWith(".exe") ? 0o755 : 0o644, flag: "wx" });
    }
    fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(staging, target);
  } catch (err) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw err;
  }
}

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
