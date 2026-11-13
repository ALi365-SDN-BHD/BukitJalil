import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_MAX_BYTES = 256 * 1024;

/** What a service reads and writes its JSON through: a JsonFile, or an encrypted one (plan 6.7). */
export interface StoredJson {
  readonly file: string;
  /** undefined when there is nothing saved; throws when it exists but cannot be read. */
  read(): unknown | undefined;
  write(value: unknown): void;
  /** false when write() would refuse (secrets unavailable, plan 6.7); a JsonFile always writes. */
  writable?(): boolean;
  /** Remove temporary files left by a write that was killed before its rename. */
  cleanupTempFiles(): number;
}

/**
 * A small JSON file with an explicit missing/unreadable split. A missing file is empty; a file that exists
 * but cannot be read, is not a regular file, is too large or is not valid JSON throws, so callers never
 * overwrite data they failed to read.
 *
 * Writes go to a temporary file, are fsynced, then renamed. A failed write leaves the old file untouched.
 */
export class JsonFile implements StoredJson {
  constructor(
    readonly file: string,
    private readonly opts: { maxBytes?: number } = {},
  ) {}

  /** undefined when the file does not exist; throws when it exists but cannot be read. */
  read(): unknown | undefined {
    let stat: fs.Stats | undefined;
    try {
      stat = fs.lstatSync(this.file, { throwIfNoEntry: false });
    } catch (err) {
      throw new JsonFileError(this.file, `cannot inspect: ${(err as Error).message}`);
    }
    if (!stat) return undefined;
    if (!stat.isFile() || stat.size > this.limit()) {
      throw new JsonFileError(this.file, "not a regular file within the size limit");
    }
    let text: string;
    try {
      text = fs.readFileSync(this.file, "utf8");
    } catch (err) {
      throw new JsonFileError(this.file, `cannot read: ${(err as Error).message}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      // The parser's message can quote the file text, which may contain a token.
      throw new JsonFileError(this.file, "invalid JSON");
    }
  }

  write(value: unknown): void {
    const text = `${JSON.stringify(value, null, 2)}\n`;
    // Check before touching the file system: a value that cannot be read back must never replace the old file.
    if (Buffer.byteLength(text) > this.limit()) {
      throw new JsonFileError(this.file, "data is too large to save", "storage.too_large");
    }
    const dir = path.dirname(this.file);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const temp = path.join(dir, `.${path.basename(this.file)}-${randomBytes(6).toString("hex")}.tmp`);
    let fd: number | null = null;
    try {
      fd = fs.openSync(temp, "wx", 0o600);
      fs.writeFileSync(fd, text);
      // openSync's mode is filtered by umask; set it on the temp file so a failure leaves the old file alone.
      fs.fchmodSync(fd, 0o600);
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = null;
      fs.renameSync(temp, this.file);
      // The rename is only durable after the directory is synced; not every platform supports this.
      syncDirectory(dir);
    } finally {
      if (fd !== null) {
        try {
          fs.closeSync(fd);
        } catch {
          // The write error is the useful one.
        }
      }
      fs.rmSync(temp, { force: true });
    }
  }

  /** Remove temporary files left by a write that was killed before its rename. */
  cleanupTempFiles(): number {
    const dir = path.dirname(this.file);
    const prefix = `.${path.basename(this.file)}-`;
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return 0;
    }
    let removed = 0;
    for (const name of names) {
      if (!name.startsWith(prefix) || !name.endsWith(".tmp")) continue;
      const temp = path.join(dir, name);
      try {
        if (!fs.lstatSync(temp).isFile()) continue;
        fs.rmSync(temp, { force: true });
        removed++;
      } catch {
        // A file that disappears or cannot be removed is not worth failing startup for.
      }
    }
    return removed;
  }

  private limit(): number {
    return this.opts.maxBytes ?? DEFAULT_MAX_BYTES;
  }
}

/** fsync a directory after a rename; best effort because Windows and some file systems refuse it. */
function syncDirectory(dir: string): void {
  let fd: number | null = null;
  try {
    fd = fs.openSync(dir, "r");
    fs.fsyncSync(fd);
  } catch {
    // The file itself is already fsynced; a missing directory fsync is not a write failure.
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // Best effort.
      }
    }
  }
}

/** The file exists but is not the JSON we expected. Never include its contents in the message. */
export class JsonFileError extends Error {
  constructor(
    readonly file: string,
    message: string,
    readonly code: "storage.unreadable" | "storage.too_large" = "storage.unreadable",
  ) {
    super(`${file}: ${message}`);
    this.name = "JsonFileError";
  }
}
