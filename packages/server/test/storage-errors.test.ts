import { describe, expect, it, vi } from "vitest";
import { GitError } from "../src/git/run.ts";
import type { Logger } from "../src/log.ts";
import { storageErrorCode, storageErrorInText } from "../src/storage-errors.ts";
import { makeApp, req } from "./helpers.ts";

// M5 layer 2: disk write failures get their own error codes.

const errno = (code: string) => Object.assign(new Error(`${code}: failed`), { code });

describe("storage errors", () => {
  it("names a full, read-only or forbidden disk from errno, causes and git's stderr", () => {
    expect(storageErrorCode(errno("ENOSPC"))).toBe("fs.disk_full");
    expect(storageErrorCode(errno("EDQUOT"))).toBe("fs.disk_full");
    expect(storageErrorCode(errno("EROFS"))).toBe("fs.read_only");
    expect(storageErrorCode(errno("EACCES"))).toBe("fs.permission_denied");
    expect(storageErrorCode(new Error("wrapped", { cause: errno("ENOSPC") }))).toBe("fs.disk_full");
    expect(
      storageErrorCode(
        new GitError("failed", "git commit-tree failed", { stderr: "fatal: unable to write: No space left on device" }),
      ),
    ).toBe("fs.disk_full");
    expect(storageErrorCode(errno("ENOENT"))).toBeNull();
    expect(storageErrorCode(new Error("No space left on device"))).toBeNull();
    expect(storageErrorCode("ENOSPC")).toBeNull();
    expect(storageErrorInText("write /x: read-only file system")).toBe("fs.read_only");
    expect(storageErrorInText("permission denied")).toBeNull();
  });

  it("answers an API request that hit a full disk with 507 fs.disk_full", async () => {
    const logger: Logger = { log: () => {} };
    const { app, sites } = makeApp({ logger });
    vi.spyOn(sites, "list").mockImplementation(() => {
      throw errno("ENOSPC");
    });
    const full = await app.request(req("/api/sites"));
    expect(full.status).toBe(507);
    expect(await full.json()).toEqual({ code: "fs.disk_full" });
    vi.spyOn(sites, "list").mockImplementation(() => {
      throw new Error("boom");
    });
    const other = await app.request(req("/api/sites"));
    expect([other.status, await other.json()]).toEqual([500, { code: "server.internal" }]);
  });
});
