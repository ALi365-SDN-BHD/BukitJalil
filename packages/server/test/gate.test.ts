import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { preparePiEnvironment } from "../src/agent/env.ts";
import { GateError, MAX_WRITE_BYTES, PathGate } from "../src/agent/gate.ts";
import { loadPi, type PiModules } from "../src/agent/pi.ts";
import { BUILTIN_TOOLS, checkToolPath, createGatedTools, dropGitLines, MAX_WALK } from "../src/agent/tools.ts";

const SECRET = "TOP-SECRET-VALUE";

let root: string;
let worktree: string;
let outside: string;
let skills: string;
let piDir: string;
let pi: PiModules;

function systemRg(): string | null {
  try {
    return execFileSync("/bin/sh", ["-c", "command -v rg"], { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

beforeAll(async () => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "bj-gate-")));
  worktree = path.join(root, "worktrees", "ai");
  outside = path.join(root, "outside");
  skills = path.join(root, "skills");
  piDir = path.join(root, "pi");
  for (const d of [worktree, outside, path.join(skills, "site-editing"), path.join(piDir, "bin")]) {
    fs.mkdirSync(d, { recursive: true });
  }
  fs.writeFileSync(path.join(outside, "secret.txt"), SECRET);
  fs.writeFileSync(path.join(worktree, "index.md"), "# Hello\nfind-me here\n");
  fs.writeFileSync(path.join(worktree, ".git"), `gitdir: /site/.git/worktrees/ai find-me ${SECRET}\n`);
  fs.writeFileSync(path.join(worktree, ".env"), `find-me ${SECRET}\n`);
  fs.mkdirSync(path.join(worktree, "content"), { recursive: true });
  fs.writeFileSync(path.join(worktree, "content", ".env.local"), `find-me ${SECRET}\n`);
  fs.mkdirSync(path.join(worktree, "content", ".GIT"), { recursive: true });
  fs.writeFileSync(path.join(worktree, "content", ".GIT", "config"), `find-me ${SECRET}\n`);
  fs.writeFileSync(path.join(worktree, "content", "post.md"), "find-me in a post\n");
  fs.symlinkSync(path.join(outside, "secret.txt"), path.join(worktree, "link.md"));
  fs.symlinkSync(outside, path.join(worktree, "linkdir"));
  fs.symlinkSync(path.join(outside, "new.txt"), path.join(worktree, "dangle.md"));
  fs.symlinkSync(path.join(outside, "nodir"), path.join(worktree, "dangledir"));
  fs.writeFileSync(path.join(skills, "site-editing", "SKILL.md"), "# skill body\n");
  preparePiEnvironment(piDir);
  pi = await loadPi(piDir);
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("PathGate", () => {
  const gate = () => new PathGate(worktree, [skills]);
  const refused = (p: string, mode: "read" | "list" | "write") =>
    expect(() => gate().check(p, mode)).toThrow(GateError);

  it("allows files and new deep paths inside the working copy", () => {
    expect(gate().check(path.join(worktree, "index.md"), "read")).toBe(path.join(worktree, "index.md"));
    expect(gate().check(path.join(worktree, "a", "b", "c.md"), "write")).toBe(path.join(worktree, "a", "b", "c.md"));
    expect(gate().check(worktree, "list")).toBe(worktree);
  });

  it("refuses relative, outside, .. and symlinked paths", () => {
    refused("index.md", "read");
    refused(path.join(outside, "secret.txt"), "read");
    refused(path.join(worktree, "..", "outside", "secret.txt"), "read");
    refused(path.join(worktree, "link.md"), "read");
    refused(path.join(worktree, "linkdir", "secret.txt"), "read");
    refused(path.join(worktree, "linkdir", "new.md"), "write");
    refused(`${worktree}\0x`, "read");
    refused(path.join(root, "worktrees", "ai2", "x.md"), "read");
  });

  it("refuses writes through dangling symlinks", () => {
    refused(path.join(worktree, "dangle.md"), "write");
    refused(path.join(worktree, "dangledir", "x.md"), "write");
    refused(path.join(worktree, "dangle.md"), "read");
  });

  it("refuses names Windows would store as .git or a protected name", () => {
    for (const p of [".git.", ".git ", ".GIT. .", ".git::$INDEX_ALLOCATION", "content/.git./config"]) {
      refused(path.join(worktree, p), "read");
      refused(path.join(worktree, p, "x"), "write");
    }
    for (const p of [
      "dist./x",
      "plugins /x",
      "themes/a/plugin.yaml.",
      "content/plugin.json ",
      ".env.",
      "x/node_modules./a",
    ]) {
      refused(path.join(worktree, p), "write");
    }
  });

  it("refuses to read .env files like it refuses to write them", () => {
    for (const mode of ["read", "list"] as const) {
      refused(path.join(worktree, ".env"), mode);
      refused(path.join(worktree, "content", ".env.local"), mode);
      refused(path.join(worktree, ".env", "nested"), mode);
    }
  });

  it("refuses .git at any level and in any case", () => {
    for (const mode of ["read", "list", "write"] as const) {
      refused(path.join(worktree, ".git"), mode);
      refused(path.join(worktree, ".Git", "config"), mode);
      refused(path.join(worktree, "content", ".GIT", "config"), mode);
      refused(path.join(worktree, "content", ".git"), mode);
    }
  });

  it("refuses writes to build output, plugins, node_modules and .env files", () => {
    for (const p of [
      "dist/index.html",
      "DIST/x",
      ".bukit/plugins.yaml",
      ".cache/x",
      ".bukitjalil-build/x",
      "plugins/x/plugin.yaml",
      "content/plugin.json",
      "themes/a/plugin.yaml",
      "node_modules/a.js",
      "themes/a/node_modules/b.js",
      ".env",
      "config/.env.local",
    ]) {
      refused(path.join(worktree, p), "write");
    }
    expect(gate().check(path.join(worktree, "content", "dist.md"), "write")).toContain("dist.md");
    expect(gate().check(path.join(worktree, "content", "plugins.md"), "write")).toContain("plugins.md");
  });

  it("lets skills be read but not written or listed", () => {
    const skill = path.join(skills, "site-editing", "SKILL.md");
    expect(gate().check(skill, "read")).toBe(skill);
    refused(skill, "write");
    refused(path.join(skills, "site-editing"), "list");
    refused(skill, "list");
  });

  it("limits written content to 1 MB of text", () => {
    expect(() => gate().checkContent("x".repeat(MAX_WRITE_BYTES))).not.toThrow();
    expect(() => gate().checkContent("x".repeat(MAX_WRITE_BYTES + 1))).toThrow(GateError);
    expect(() => gate().checkContent("a\0b")).toThrow(GateError);
  });
});

describe("checkToolPath", () => {
  it("refuses paths Pi would rewrite", () => {
    for (const p of [
      "~/secret.txt",
      "~",
      " ~/x",
      "@index.md",
      "@/etc/passwd",
      "file:///etc/passwd",
      "FILE:x",
      "a b.md",
      "a b",
    ]) {
      expect(() => checkToolPath(p)).toThrow(GateError);
    }
    for (const p of [undefined, "index.md", "content/a b.md", "/abs/path"])
      expect(() => checkToolPath(p)).not.toThrow();
  });
});

describe("dropGitLines", () => {
  it("drops matches and context lines from .git and .env paths", () => {
    const text = [
      "index.md:2: find-me",
      ".git:1: gitdir",
      "content/.GIT/config-1- x",
      ".env:1: TOP-SECRET-VALUE",
      "content/.env.local-2- TOP-SECRET-VALUE",
      "content/post.md:1: find-me",
    ].join("\n");
    expect(dropGitLines(text)).toBe("index.md:2: find-me\ncontent/post.md:1: find-me");
    expect(dropGitLines(".git:1: gitdir")).toBe("No matches found");
    expect(dropGitLines("No matches found")).toBe("No matches found");
  });
});

describe("gated tools", () => {
  let tools: Record<string, ToolDefinition>;
  let rgPath: string;

  beforeAll(() => {
    rgPath = path.join(piDir, "bin", "rg");
    const list = createGatedTools(pi, {
      cwd: worktree,
      gate: new PathGate(worktree, [skills]),
      rgReady: () => fs.existsSync(rgPath),
    });
    tools = Object.fromEntries(list.map((t) => [t.name, t]));
  });

  async function run(name: string, params: Record<string, unknown>) {
    try {
      const tool = tools[name] as ToolDefinition;
      const result = await tool.execute("t1", params as never, undefined, undefined, undefined as never);
      return { ok: true, text: result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n") };
    } catch (err) {
      return { ok: false, text: String((err as Error).message) };
    }
  }
  const expectRefused = async (name: string, params: Record<string, unknown>) => {
    const r = await run(name, params);
    expect(r.ok, `${name} ${JSON.stringify(params)} -> ${r.text}`).toBe(false);
    expect(r.text).not.toContain(SECRET);
  };

  it("are the six built-in tools", () => {
    expect(Object.keys(tools).sort()).toEqual([...BUILTIN_TOOLS].sort());
  });

  it("read inside the working copy and skills, nothing else", async () => {
    expect(await run("read", { path: "index.md" })).toMatchObject({ ok: true, text: expect.stringContaining("Hello") });
    expect((await run("read", { path: path.join(worktree, "index.md") })).ok).toBe(true);
    expect(await run("read", { path: path.join(skills, "site-editing", "SKILL.md") })).toMatchObject({
      ok: true,
      text: expect.stringContaining("skill body"),
    });
    for (const p of [
      "../outside/secret.txt",
      path.join(outside, "secret.txt"),
      "~/secret.txt",
      "@../outside/secret.txt",
      `file://${path.join(outside, "secret.txt")}`,
      "link.md",
      "linkdir/secret.txt",
      ".git",
      "content/.GIT/config",
      ".env",
      "content/.env.local",
      "index .md",
    ]) {
      await expectRefused("read", { path: p });
    }
  });

  it("read images as images and large files in parts", async () => {
    // A 1x1 PNG.
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );
    fs.writeFileSync(path.join(worktree, "logo.png"), png);
    const tool = tools.read as ToolDefinition;
    const image = await tool.execute("t1", { path: "logo.png" } as never, undefined, undefined, undefined as never);
    expect(image.content.some((c) => c.type === "image")).toBe(true);

    fs.writeFileSync(path.join(worktree, "big.txt"), `${"line\n".repeat(200_000)}`);
    const part = await run("read", { path: "big.txt", offset: 3, limit: 2 });
    expect(part).toMatchObject({ ok: true, text: expect.stringContaining("line\nline") });
    fs.rmSync(path.join(worktree, "logo.png"));
    fs.rmSync(path.join(worktree, "big.txt"));
  });

  it("write new files and refuse protected or outside paths", async () => {
    expect((await run("write", { path: "content/new/deep/page.md", content: "# New\n" })).ok).toBe(true);
    expect(fs.readFileSync(path.join(worktree, "content/new/deep/page.md"), "utf8")).toBe("# New\n");
    for (const p of [
      "dist/index.html",
      "plugins/x/plugin.yaml",
      "content/plugin.json",
      ".env.local",
      "node_modules/a.js",
      ".git/config",
      "content/.GIT/hooks/post-checkout",
      "linkdir/x.md",
      "../outside/x.md",
      path.join(skills, "site-editing", "SKILL.md"),
    ]) {
      await expectRefused("write", { path: p, content: "x" });
    }
    await expectRefused("write", { path: "big.md", content: "x".repeat(MAX_WRITE_BYTES + 1) });
    await expectRefused("write", { path: "bin.dat", content: "a\0b" });
    expect(fs.existsSync(path.join(worktree, "dist"))).toBe(false);
    expect(fs.existsSync(path.join(worktree, "plugins"))).toBe(false);
    expect(fs.existsSync(path.join(outside, "x.md"))).toBe(false);
    expect(fs.existsSync(path.join(worktree, "big.md"))).toBe(false);
  });

  it("write refuses dangling symlinks and creates nothing outside", async () => {
    await expectRefused("write", { path: "dangle.md", content: "x" });
    await expectRefused("write", { path: "dangledir/x.md", content: "x" });
    expect(fs.existsSync(path.join(outside, "new.txt"))).toBe(false);
    expect(fs.existsSync(path.join(outside, "nodir"))).toBe(false);
  });

  it("edit inside the working copy only", async () => {
    const r = await run("edit", { path: "index.md", edits: [{ oldText: "# Hello", newText: "# Hi" }] });
    expect(r.ok, r.text).toBe(true);
    expect(fs.readFileSync(path.join(worktree, "index.md"), "utf8")).toContain("# Hi");
    await expectRefused("edit", { path: "link.md", edits: [{ oldText: SECRET, newText: "x" }] });
    await expectRefused("edit", { path: ".git", edits: [{ oldText: "gitdir", newText: "x" }] });
    expect(fs.readFileSync(path.join(outside, "secret.txt"), "utf8")).toBe(SECRET);
  });

  it("ls hides .git and symlinks out of the working copy", async () => {
    const r = await run("ls", {});
    expect(r.ok).toBe(true);
    const entries = r.text.split("\n");
    expect(entries).toContain("index.md");
    expect(entries).toContain("content/");
    expect(entries).not.toContain(".git");
    expect(entries).not.toContain("link.md");
    expect(entries).not.toContain("linkdir/");
    expect((await run("ls", { path: "content" })).text).not.toMatch(/\.git/i);
    for (const p of ["linkdir", "..", outside, "content/.GIT", skills]) await expectRefused("ls", { path: p });
  });

  it("find matches inside the working copy only", async () => {
    const r = await run("find", { pattern: "*.md" });
    expect(r.ok).toBe(true);
    expect(r.text).toContain("index.md");
    expect(r.text).toContain("content/post.md");
    expect(r.text).not.toContain("secret");
    expect((await run("find", { pattern: "content/**/*.md" })).text).toContain("content/post.md");
    expect((await run("find", { pattern: "config" })).text).toBe("No files found matching pattern");
    for (const p of ["linkdir", "..", outside, "content/.GIT"]) await expectRefused("find", { pattern: "*", path: p });
  });

  it("find shows paths relative to the search path when the working copy is reached through a symlink", async () => {
    const alias = path.join(root, "alias");
    fs.symlinkSync(path.join(root, "worktrees"), alias);
    const aliased = path.join(alias, "ai");
    const list = createGatedTools(pi, {
      cwd: aliased,
      gate: new PathGate(aliased),
      rgReady: () => fs.existsSync(rgPath),
    });
    const aliasFind = list.find((t) => t.name === "find") as ToolDefinition;
    const r = await aliasFind.execute("t", { pattern: "*.md" } as never, undefined, undefined, undefined as never);
    const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    expect(text.split("\n")).toContain("index.md");
    expect(text).not.toContain("..");
  });

  it("find says when it stopped before seeing every file", async () => {
    expect(MAX_WALK).toBe(20_000);
    const many = path.join(worktree, "many");
    fs.mkdirSync(many);
    for (let i = 0; i <= 30; i++) fs.writeFileSync(path.join(many, `f${i}.txt`), "");
    const small = createGatedTools(pi, {
      cwd: worktree,
      gate: new PathGate(worktree),
      rgReady: () => fs.existsSync(rgPath),
      maxWalk: 30,
    });
    const smallFind = small.find((t) => t.name === "find") as ToolDefinition;
    const findText = async (params: Record<string, unknown>) =>
      (await smallFind.execute("t", params as never, undefined, undefined, undefined as never)).content
        .map((c) => (c.type === "text" ? c.text : ""))
        .join("");
    try {
      expect(await findText({ pattern: "*.none", path: "many" })).toContain("Search stopped after 30 entries");
    } finally {
      fs.rmSync(many, { recursive: true, force: true });
    }
    expect(await findText({ pattern: "*.md" })).not.toContain("Search stopped");
  });

  it("grep is refused until BukitJalil's rg is installed", async () => {
    const r = await run("grep", { pattern: "find-me" });
    expect(r).toMatchObject({ ok: false, text: expect.stringContaining("rg") });
  });

  const rg = systemRg();
  // CI installs rg, so the real search is never skipped there.
  it("rg is on PATH under CI", () => {
    if (process.env.CI) expect(rg, "install ripgrep in CI").not.toBeNull();
  });
  it.skipIf(!rg)("grep searches the working copy without .git files", async () => {
    fs.copyFileSync(fs.realpathSync(rg as string), rgPath);
    fs.chmodSync(rgPath, 0o755);
    try {
      const r = await run("grep", { pattern: "find-me", context: 1 });
      expect(r.ok, r.text).toBe(true);
      expect(r.text).toContain("index.md");
      expect(r.text).toContain("content/post.md");
      expect(r.text).not.toMatch(/\.git/i);
      expect(r.text).not.toContain(".env");
      expect(r.text).not.toContain(SECRET);
      expect((await run("grep", { pattern: SECRET })).text).toBe("No matches found");
      // A model-provided glob cannot bring .env lines back: the output filter drops them too.
      const env = await run("grep", { pattern: SECRET, glob: "**/.env*" });
      expect(env.text).toBe("No matches found");
      // .git is left out of the search, so its lines do not take the place of real matches.
      const one = await run("grep", { pattern: "find-me", limit: 1 });
      expect(one.text).toMatch(/^(index\.md|content\/post\.md):/);
      expect((await run("grep", { pattern: "find-me", glob: "*" })).text).not.toMatch(/\.git/i);
      for (const p of ["linkdir", "..", outside, ".git", "content/.GIT"])
        await expectRefused("grep", { pattern: "x", path: p });
    } finally {
      fs.rmSync(rgPath);
    }
  });
});
