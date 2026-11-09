import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { resolveStaticFile } from "../src/static-files.ts";

let root: string;
let outside: string;

beforeAll(() => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bj-static-")));
  root = path.join(base, "site");
  outside = path.join(base, "secret.txt");
  fs.mkdirSync(path.join(root, "posts/a"), { recursive: true });
  fs.writeFileSync(path.join(root, "index.html"), "home");
  fs.writeFileSync(path.join(root, "posts/a/index.html"), "post");
  fs.writeFileSync(outside, "secret");
  fs.symlinkSync(outside, path.join(root, "link.txt"));
  fs.symlinkSync(base, path.join(root, "linkdir"));
});

describe("resolveStaticFile (plan 8.4)", () => {
  it("serves files and directory index pages", () => {
    expect(resolveStaticFile(root, "/")).toEqual({ ok: true, file: path.join(root, "index.html") });
    expect(resolveStaticFile(root, "/posts/a/")).toEqual({ ok: true, file: path.join(root, "posts/a/index.html") });
    expect(resolveStaticFile(root, "/posts/a/index.html?x=1")).toMatchObject({ ok: true });
  });

  it("rejects traversal, encoded traversal, backslashes and NUL", () => {
    for (const p of [
      "/../secret.txt",
      "/%2e%2e/secret.txt",
      "/posts/..%2f..%2fsecret.txt",
      "/a\\b",
      "/x%00",
      "/%E0%A4%A",
    ]) {
      expect(resolveStaticFile(root, p), p).toMatchObject({ ok: false, status: 400 });
    }
  });

  it("answers symlinks to files and directories like missing files", () => {
    expect(resolveStaticFile(root, "/link.txt")).toEqual({ ok: false, status: 404 });
    expect(resolveStaticFile(root, "/linkdir/secret.txt")).toEqual({ ok: false, status: 404 });
  });

  it("works when the root itself sits below a symlinked directory", () => {
    const linked = path.join(path.dirname(root), "via-link");
    fs.symlinkSync(path.dirname(root), linked);
    expect(resolveStaticFile(path.join(linked, "site"), "/posts/a/")).toMatchObject({ ok: true });
  });

  it("returns 404 for missing files", () => {
    expect(resolveStaticFile(root, "/nope.html")).toEqual({ ok: false, status: 404 });
  });
});
