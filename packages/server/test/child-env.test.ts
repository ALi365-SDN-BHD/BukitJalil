import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { BukitRunner } from "../src/bukit/runner.ts";
import { searchPath, systemEnv, tempEnv } from "../src/child-env.ts";
import type { GitRunner } from "../src/git/run.ts";

const base = fs.mkdtempSync(path.join(os.tmpdir(), "bj-childenv-"));
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

describe("child environments", () => {
  it("passes nothing extra off Windows", () => {
    expect(systemEnv("linux", { SystemRoot: "C:\\Windows" })).toEqual({});
    expect(tempEnv("/t", "darwin")).toEqual({ TMPDIR: "/t" });
    expect(searchPath(["/a"], "linux")).toBe(["/a", "/usr/bin", "/bin"].join(path.delimiter));
  });

  it("passes only the system variables a Windows program needs", () => {
    const source = { SystemRoot: "C:\\Windows", ComSpec: "cmd.exe", USERPROFILE: "C:\\Users\\a", PATH: "x" };
    expect(systemEnv("win32", source)).toEqual({ SystemRoot: "C:\\Windows", ComSpec: "cmd.exe" });
    expect(tempEnv("D:\\t", "win32")).toEqual({ TMPDIR: "D:\\t", TEMP: "D:\\t", TMP: "D:\\t" });
    expect(searchPath(["C:\\a", "C:\\b"], "win32")).toBe("C:\\a;C:\\b");
  });
});

describe("BukitRunner PATH on Windows", () => {
  const gitPath = path.join(base, "Git", "cmd", "git.exe");
  const git = { opts: { gitPath }, envForChildGit: () => ({}) } as unknown as GitRunner;
  const make = (symlink: (target: string, link: string) => void, home: string) =>
    new BukitRunner({ bukitPath: "bukit", git, home, tmpDir: path.join(home, "tmp"), platform: "win32", symlink });

  it("links git.exe in the private directory when links are allowed", () => {
    const home = path.join(base, "h1");
    const linked: string[] = [];
    const runner = make((target, link) => linked.push(target, path.basename(link)), home);
    expect(runner.env().PATH).toBe(runner.binDir);
    expect(linked).toEqual([gitPath, "git.exe"]);
  });

  it("falls back to git's own directory when a link is refused", () => {
    const home = path.join(base, "h2");
    const runner = make(() => {
      throw Object.assign(new Error("denied"), { code: "EPERM" });
    }, home);
    expect(runner.env().PATH).toBe(path.dirname(gitPath));
  });

  it("does not hide other link errors", () => {
    const home = path.join(base, "h3");
    const runner = make(() => {
      throw Object.assign(new Error("full"), { code: "ENOSPC" });
    }, home);
    expect(() => runner.env()).toThrow("full");
  });
});
