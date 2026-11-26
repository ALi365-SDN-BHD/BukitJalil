import { describe, expect, it, vi } from "vitest";
import { GitError } from "../src/git/run.ts";
import { SiteError } from "../src/sites/location.ts";
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

  it.each([
    [
      new SiteError("site.busy", 409, { operation: "build" }),
      409,
      { code: "site.busy", params: { operation: "build" } },
    ],
    [errno("ENOSPC"), 507, { code: "fs.disk_full" }],
    [new Error("private failure detail"), 500, { code: "server.internal" }],
  ] as const)("maps %s through the site API", async (error, status, payload) => {
    const log = vi.fn();
    const { app, sites } = makeApp({ logger: { log } });
    vi.spyOn(sites, "get").mockImplementation(() => {
      throw error;
    });
    const res = await app.request(req("/api/sites/0000000000000000"));
    expect([res.status, await res.json()]).toEqual([status, payload]);
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(log.mock.calls.filter(([, event]) => event === "request.failed")).toHaveLength(status >= 500 ? 1 : 0);
  });
});
