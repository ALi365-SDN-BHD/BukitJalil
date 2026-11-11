import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ConfigResponse, DataResponse, FileResponse, ThemeResponse, TreeResponse } from "@bukitjalil/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveGitPath } from "../src/git/run.ts";
import { decodeText, imageMime } from "../src/panels/service.ts";
import { parseFrontMatter } from "../src/panels/yaml.ts";
import { copyStarter } from "../src/sites/template.ts";
import { commitAllAs, makeApp, rawGit, req } from "./helpers.ts";

const STARTER = path.resolve(import.meta.dirname, "../../../templates/starter");
const _gitPath = resolveGitPath() as string;
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4b00000000049454e44ae426082",
  "hex",
);

let base: string;
let userHome: string;

beforeAll(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bj-panels-")));
  userHome = path.join(base, "home");
  fs.mkdirSync(userHome);
});
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

const raw = (cwd: string, ...args: string[]) => rawGit(base, cwd, ...args);

/** A starter site with a few extra files of every kind, committed on main and imported. */
async function siteWithFiles(name: string) {
  const ctx = makeApp({ userHome, appHome: fs.mkdtempSync(path.join(base, "app-")) });
  const dir = path.join(userHome, name);
  copyStarter(STARTER, dir, { title: "Panel Site", language: "en-US" });
  fs.mkdirSync(path.join(dir, "static", "img"), { recursive: true });
  fs.writeFileSync(path.join(dir, "static", "img", "dot.png"), PNG);
  fs.writeFileSync(
    path.join(dir, "static", "img", "logo.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  );
  fs.writeFileSync(path.join(dir, "static", "blob.bin"), Buffer.from([0, 1, 2, 3, 255]));
  fs.writeFileSync(path.join(dir, "static", "big.txt"), "a".repeat(1024 * 1024 + 1));
  // Past the inline limit: a large PNG is still an image, anything else is too_large.
  fs.writeFileSync(path.join(dir, "static", "img", "big.png"), Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]));
  fs.writeFileSync(path.join(dir, "static", "big.bin"), Buffer.alloc(2 * 1024 * 1024));
  fs.writeFileSync(path.join(dir, "static", "it's (1).txt"), "apostrophe\n");
  fs.writeFileSync(path.join(dir, "static", '名字 "q".txt'), "unicode name\n");
  fs.writeFileSync(path.join(dir, "content", "posts", "broken.md"), "---\ntitle: [unclosed\n---\nbody\n");
  fs.symlinkSync("../site.yaml", path.join(dir, "static", "link"));
  raw(dir, "init", "-q", "-b", "main");
  commitAllAs(base, dir);
  const get = async <T>(url: string) => {
    const res = await ctx.app.fetch(req(url));
    const type = res.headers.get("content-type") ?? "";
    const body = type.includes("json") ? ((await res.json()) as T) : (Buffer.from(await res.arrayBuffer()) as T);
    return { status: res.status, body, headers: res.headers };
  };
  const site = await ctx.sites.import({ path: dir });
  // Working tree changes after import: the panels must not see them.
  fs.writeFileSync(path.join(dir, ".env"), "SECRET=1\n");
  fs.writeFileSync(path.join(dir, "site.yaml"), "changed: in the working tree only\n");

  return { ...ctx, dir, site, get, api: (p: string) => `/api/sites/${site.id}${p}` };
}

describe("file panel (plan 5.3, 9.1)", () => {
  let s: Awaited<ReturnType<typeof siteWithFiles>>;
  beforeAll(async () => {
    s = await siteWithFiles("files");
  });

  it("lists one directory level from git objects, directories first", async () => {
    const root = await s.get<TreeResponse>(s.api("/tree"));
    expect(root.status).toBe(200);
    expect(root.body.commit).toMatch(/^[0-9a-f]{40}$/);
    const names = root.body.entries.map((e) => `${e.kind}:${e.name}`);
    expect(names.slice(0, 4)).toEqual(["dir:content", "dir:data", "dir:static", "dir:themes"]);
    expect(names).toContain("file:site.yaml");
    expect(names).not.toContain("file:.env");
    const statics = await s.get<TreeResponse>(s.api("/tree?path=static"));
    expect(statics.body.entries.find((e) => e.name === "link")).toMatchObject({ kind: "symlink", path: "static/link" });
    expect(statics.body.entries.find((e) => e.name === "img")?.kind).toBe("dir");
  });

  it("caps a directory with more entries than the panel can show", async () => {
    const ctx = await siteWithFiles("huge");
    const huge = path.join(ctx.dir, "huge");
    fs.mkdirSync(huge);
    for (let i = 0; i < 2001; i++) fs.writeFileSync(path.join(huge, `f${i}.txt`), "");
    raw(ctx.dir, "add", "-A");
    raw(ctx.dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "huge");
    const tree = await ctx.get<TreeResponse>(ctx.api("/tree?path=huge"));
    expect(tree.body.entries).toHaveLength(2000);
    expect(tree.body.truncated).toBe(true);
  });

  it("refuses bad paths and explains missing ones", async () => {
    expect((await s.get(s.api("/tree?path=site.yaml"))).body).toEqual({ code: "panel.not_directory" });
    expect((await s.get(s.api("/tree?path=nope"))).body).toEqual({ code: "panel.not_found" });
    for (const bad of ["../x", "./static", "static/", "/etc", "a//b", "static/\0"]) {
      expect((await s.get(s.api(`/tree?path=${encodeURIComponent(bad)}`))).body).toEqual({
        code: "request.invalid_query",
      });
    }
    expect((await s.get(s.api("/tree?ref=change"))).body).toEqual({ code: "change.not_found" });
    expect((await s.get(s.api("/tree?ref=HEAD"))).status).toBe(400);
    expect((await s.get("/api/sites/0000000000000000/tree")).body).toEqual({ code: "site.not_found" });
  });

  it("returns text from the commit, not the working tree", async () => {
    const res = await s.get<FileResponse>(s.api("/file?path=site.yaml"));
    expect(res.body).toMatchObject({ kind: "text", path: "site.yaml" });
    expect(res.body.kind === "text" && res.body.content).toContain("title: Panel Site");
    expect((await s.get(s.api("/file?path=.env"))).body).toEqual({ code: "panel.not_found" });
  });

  it("describes images, binaries, large files, symlinks and directories", async () => {
    const kind = async (p: string) => (await s.get<FileResponse>(s.api(`/file?path=${encodeURIComponent(p)}`))).body;
    expect(await kind("static/img/dot.png")).toMatchObject({ kind: "image", mime: "image/png", size: PNG.length });
    expect(await kind("static/img/logo.svg")).toMatchObject({ kind: "text" });
    expect(await kind("static/blob.bin")).toMatchObject({ kind: "binary", size: 5 });
    expect(await kind("static/big.txt")).toMatchObject({ kind: "too_large", size: 1024 * 1024 + 1 });
    expect(await kind("static/img/big.png")).toMatchObject({ kind: "image", mime: "image/png" });
    expect(await kind("static/big.bin")).toMatchObject({ kind: "too_large", size: 2 * 1024 * 1024 });
    expect(await kind("static/link")).toMatchObject({ kind: "symlink", target: "../site.yaml" });
    expect(await kind("static")).toEqual({ code: "panel.not_file" });
    expect((await s.get(s.api("/file?path="))).body).toEqual({ code: "request.invalid_query" });
  });

  it("serves only bitmaps inline, sandboxed and never sniffed", async () => {
    const png = await s.get<Buffer>(s.api("/file?path=static/img/dot.png&as=raw"));
    expect(png.status).toBe(200);
    expect(png.headers.get("content-type")).toBe("image/png");
    expect(png.headers.get("x-content-type-options")).toBe("nosniff");
    expect(png.headers.get("content-security-policy")).toMatch(/default-src 'self'.*; sandbox$/);
    expect(png.body.equals(PNG)).toBe(true);
    expect((await s.get(s.api("/file?path=static/img/logo.svg&as=raw"))).body).toEqual({ code: "panel.not_file" });
    expect((await s.get(s.api("/file?path=static/link&as=raw"))).body).toEqual({ code: "panel.not_file" });
  });

  it("downloads any file as an attachment", async () => {
    const svg = await s.get<Buffer>(s.api("/file?path=static/img/logo.svg&as=download"));
    expect(svg.headers.get("content-type")).toBe("application/octet-stream");
    expect(svg.headers.get("content-disposition")).toBe(`attachment; filename="logo.svg"; filename*=UTF-8''logo.svg`);
    expect(svg.body.toString()).toContain("<script>");
    const named = await s.get<Buffer>(s.api(`/file?path=${encodeURIComponent('static/名字 "q".txt')}&as=download`));
    expect(named.headers.get("content-disposition")).toBe(
      `attachment; filename="__ _q_.txt"; filename*=UTF-8''${encodeURIComponent('名字 "q".txt')}`,
    );
    const quoted = await s.get<Buffer>(s.api(`/file?path=${encodeURIComponent("static/it's (1).txt")}&as=download`));
    expect(quoted.headers.get("content-disposition")).toBe(
      `attachment; filename="it's (1).txt"; filename*=UTF-8''it%27s%20%281%29.txt`,
    );
    // JSON responses are not sandboxed; only site content is.
    const json = await s.get(s.api("/file?path=site.yaml"));
    expect(json.headers.get("content-security-policy")).not.toMatch(/sandbox/);
  });
});

describe("config, theme and data panels (plan 5.3)", () => {
  let s: Awaited<ReturnType<typeof siteWithFiles>>;
  beforeAll(async () => {
    s = await siteWithFiles("panels");
  });

  it("shows site.yaml structured and as text", async () => {
    const { body } = await s.get<ConfigResponse>(s.api("/config"));
    expect(body.error).toBeNull();
    expect(body.raw).toContain("collections:");
    expect(body.summary).toMatchObject({
      site: { title: "Panel Site", language: "en-US", baseUrl: "/", url: null },
      collections: [
        { name: "post", permalink: "/blog/{year}/{month}/{slug}/", listRoute: "/blog/" },
        { name: "page", permalink: "/pages/{slug}/", listRoute: "/pages/" },
      ],
      sources: [
        { name: "posts", type: "markdown", mode: "content", collection: "post" },
        { name: "pages", type: "markdown", mode: "content", collection: "page" },
        { name: "modules", type: "markdown", mode: "data", collection: null },
      ],
      build: { output: "dist", clean: false, draft: null },
      theme: { name: "starter" },
      plugins: [],
      otherSections: ["logging"],
    });
  });

  it("lists the theme manifest and files", async () => {
    const { body } = await s.get<ThemeResponse>(s.api("/theme"));
    expect(body).toMatchObject({ name: "starter", dir: "themes/starter", error: null, truncated: false });
    expect(body.manifest).toMatchObject({ name: "starter", engine: "bukit" });
    expect(body.layouts).toContain("layouts/pages/index.html");
    expect(body.assets).toContain("assets/style.css");
    expect(body.static.length).toBeGreaterThan(0);
    expect(body.params).toMatchObject({ brand: "Panel Site" });
  });

  it("summarizes each content source", async () => {
    const { body } = await s.get<DataResponse>(s.api("/data"));
    expect(body.truncated).toBe(false);
    const [posts, pages, modules] = body.sources;
    expect(posts).toMatchObject({ type: "markdown", dir: "content/posts", fileCount: 2, items: [] });
    if (posts?.type !== "markdown" || modules?.type !== "markdown") throw new Error("expected markdown sources");
    expect(posts.fields.slice(0, 2).map((f) => f.name)).toEqual(["categories", "collection"]);
    expect(posts.invalid).toEqual(["content/posts/broken.md"]);
    expect(pages).toMatchObject({ fileCount: 1, invalid: [] });
    expect(modules.itemsTruncated).toBe(false);
    expect(modules.items).toEqual([
      {
        file: "data/features-10.md",
        data: expect.objectContaining({ type: "features", order: 10, enabled: true }),
      },
    ]);
  });

  it("shows Notion sources by their configuration only", async () => {
    const ctx = await siteWithFiles("notion");
    raw(ctx.dir, "checkout", "-q", "--", "site.yaml"); // drop the working tree change
    const committed = fs.readFileSync(path.join(ctx.dir, "site.yaml"), "utf8");
    fs.writeFileSync(
      path.join(ctx.dir, "site.yaml"),
      committed.replace(
        "content:\n  sources:\n",
        "content:\n  sources:\n    - type: notion\n      name: db\n      notion:\n        databaseId: abc123\n        cacheMode: readonly\n",
      ),
    );
    raw(ctx.dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-am", "notion");
    const { body } = await ctx.get<DataResponse>(ctx.api("/data"));
    expect(body.sources[0]).toEqual({
      index: 0,
      name: "db",
      mode: null,
      collection: null,
      type: "notion",
      databaseId: "abc123",
      cacheMode: "readonly",
    });
  });
});

describe("data panel paths", () => {
  it("reads source directories written with a trailing slash or ./", async () => {
    const ctx = await siteWithFiles("dirs");
    raw(ctx.dir, "checkout", "-q", "--", "site.yaml");
    const committed = fs.readFileSync(path.join(ctx.dir, "site.yaml"), "utf8");
    fs.writeFileSync(
      path.join(ctx.dir, "site.yaml"),
      committed.replace("dir: content/posts", "dir: content/posts/").replace("dir: data", "dir: ./data"),
    );
    raw(ctx.dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-am", "dirs");
    const { body } = await ctx.get<DataResponse>(ctx.api("/data"));
    const [posts, , modules] = body.sources;
    expect(posts).toMatchObject({ dir: "content/posts/", fileCount: 2, invalid: ["content/posts/broken.md"] });
    expect(modules).toMatchObject({ dir: "./data", fileCount: 1 });
    if (modules?.type !== "markdown") throw new Error("expected a markdown source");
    expect(modules.items[0]?.file).toBe("data/features-10.md");
  });
});

describe("panels refuse unusable repositories", () => {
  it("says when the site folder is no longer a git repository", async () => {
    const s = await siteWithFiles("norepo");
    fs.rmSync(path.join(s.dir, ".git"), { recursive: true, force: true });
    expect((await s.get(s.api("/tree"))).body).toEqual({ code: "site.not_repo" });
  });

  it("does not read a repository whose config is not allowed", async () => {
    const s = await siteWithFiles("unsafe");
    raw(s.dir, "config", "core.fsmonitor", "/bin/false");
    expect((await s.get(s.api("/tree"))).body).toEqual({ code: "site.repo_unsafe" });
  });

  it("explains a missing default branch", async () => {
    const s = await siteWithFiles("nobranch");
    raw(s.dir, "branch", "-q", "-m", "main", "other");
    expect((await s.get(s.api("/config"))).body).toEqual({ code: "site.branch_missing", params: { branch: "main" } });
  });
});

describe("panel helpers", () => {
  it("recognizes bitmaps by their bytes only", () => {
    expect(imageMime(PNG)).toBe("image/png");
    expect(imageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(imageMime(Buffer.from("GIF89a..."))).toBe("image/gif");
    expect(imageMime(Buffer.from("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(imageMime(Buffer.from("<svg/>"))).toBeNull();
    expect(imageMime(Buffer.from("%PDF-1.7"))).toBeNull();
  });

  it("decodes UTF-8 text only", () => {
    expect(decodeText(Buffer.from("héllo"))).toBe("héllo");
    expect(decodeText(Buffer.from([0x68, 0, 0x69]))).toBeNull();
    expect(decodeText(Buffer.from([0xc3, 0x28]))).toBeNull();
  });

  it("reads front matter", () => {
    expect(parseFrontMatter("---\ntitle: A\n---\nbody")).toEqual({ value: { title: "A" }, error: null });
    expect(parseFrontMatter("﻿---\r\ntitle: B\r\n...\r\n")).toEqual({ value: { title: "B" }, error: null });
    expect(parseFrontMatter("# no front matter")).toEqual({ value: {}, error: null });
    expect(parseFrontMatter("---\n---\n")).toEqual({ value: {}, error: null });
    expect(parseFrontMatter("---\ntitle: A\n").error).toMatch(/not closed/);
    expect(parseFrontMatter("---\n- a\n---\n").error).toMatch(/mapping/);
    expect(parseFrontMatter("---\na: 1\na: 2\n---\n").error).not.toBeNull();
    const bomb = `---\na: &a [x,x,x,x,x,x,x,x,x]\n${Array.from(
      { length: 8 },
      (_, i) =>
        `${"b".repeat(i + 1)}: &${"b".repeat(i + 1)} [${Array(9)
          .fill(i === 0 ? "*a" : `*${"b".repeat(i)}`)
          .join(",")}]`,
    ).join("\n")}\n---\n`;
    expect(parseFrontMatter(bomb).error).not.toBeNull();
  });
});
