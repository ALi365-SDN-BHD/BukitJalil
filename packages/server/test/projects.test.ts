import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CurrentChange, SessionInfo, Theme, ThemeResponse, TreeResponse } from "@bukitjalil/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PathGate } from "../src/agent/gate.ts";
import { workingCopyFiles } from "../src/agent/site-tools.ts";
import { parseYaml } from "../src/panels/yaml.ts";
import { SettingsStore } from "../src/store/settings.ts";
import { themeCoverage } from "../src/themes/coverage.ts";
import { themeKey } from "../src/themes/service.ts";
import { pngChunk, tinyPng } from "./fixtures/images.ts";
import { writeStarter } from "./fixtures/starter.ts";
import { ADMIN, commitAllAs, jsonPut, makeApp, rawGit, req } from "./helpers.ts";

// Theme development design 3.2, 3.3 (T0): theme projects share the project routes and services.
let base: string;
let ctx: ReturnType<typeof makeApp>;

beforeAll(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bj-projects-")));
  fs.mkdirSync(path.join(base, "home"));
  ctx = makeApp({ userHome: path.join(base, "home"), appHome: path.join(base, "app") });
});
afterAll(async () => {
  await ctx.agent.shutdown();
  await ctx.builds.settled();
  fs.rmSync(base, { recursive: true, force: true });
});

let count = 0;
function repo(name: string): string {
  const dir = path.join(base, "home", `${name}${++count}`);
  writeStarter(dir, { title: `Project ${count}`, language: "en-US" });
  rawGit(base, dir, "init", "-q", "-b", "main");
  commitAllAs(base, dir);
  return dir;
}

/** Register a theme project the way T1–T3 will, after making its repository. */
async function theme(): Promise<Theme> {
  const real = fs.realpathSync(repo("theme"));
  return ctx.repos.reserved(real, () =>
    ctx.themes.register(real, {
      name: "Theme",
      themeName: "starter",
      defaultBranch: "main",
      configFile: "site.yaml",
      origin: "new",
    }),
  );
}

const call = (method: string, url: string, body?: unknown) =>
  ctx.app.fetch(
    req(url, {
      ...(body === undefined
        ? { headers: { origin: ADMIN, "x-bukitjalil": "1", "content-type": "application/json" } }
        : jsonPut(body)),
      method,
    }),
  );

describe("theme projects (T0)", () => {
  it("registers a usable theme project and lists it apart from sites", async () => {
    const t = await theme();
    expect(t).toMatchObject({ readOnly: null, origin: "new", themeName: "starter" });
    const list = (await (await call("GET", "/api/themes")).json()) as Theme[];
    expect(list.map((x) => x.id)).toContain(t.id);
    expect(((await (await call("GET", "/api/sites")).json()) as { id: string }[]).map((x) => x.id)).not.toContain(t.id);
    expect((await call("GET", `/api/themes/${t.id}`)).status).toBe(200);
    // A theme id is not a site id, and the other way round.
    const asSite = await call("GET", `/api/sites/${t.id}`);
    expect(asSite.status).toBe(404);
    expect(await asSite.json()).toMatchObject({ code: "site.not_found" });
    const bad = await call("GET", "/api/themes/nothex/sessions");
    expect(bad.status).toBe(404);
    expect(await bad.json()).toMatchObject({ code: "theme.not_found" });
    // The main checkout lives under worktrees/themes/<id>.
    expect(fs.existsSync(path.join(ctx.paths.worktrees, "themes", t.id, "main", "site.yaml"))).toBe(true);
  });

  it("gives a theme project its own sessions, change set, panels and builds", async () => {
    const t = await theme();
    const s = await ctx.sites.import({ path: repo("site") });
    await ctx.builds.settled();
    const key = themeKey(t.id);

    const created = await call("POST", `/api/themes/${t.id}/sessions`);
    expect(created.status).toBe(201);
    const session = (await created.json()) as SessionInfo;
    expect(session.project).toBe(key);
    const listed = (await (await call("GET", `/api/themes/${t.id}/sessions`)).json()) as SessionInfo[];
    expect(listed.map((x) => x.id)).toEqual([session.id]);
    expect(await (await call("GET", `/api/sites/${s.id}/sessions`)).json()).toEqual([]);

    const { cwd } = await ctx.changes.begin(key, session.id);
    expect(cwd).toBe(path.join(ctx.paths.worktrees, "themes", t.id, "ai"));
    fs.writeFileSync(path.join(cwd, "content", "posts", "new.md"), "---\ntitle: New\n---\nHello\n");
    await ctx.changes.snapshot(key, cwd);
    const current = (await (await call("GET", `/api/themes/${t.id}/changes/current`)).json()) as CurrentChange;
    expect(current.change).toMatchObject({ project: key, status: "open" });
    // The site's change set is its own.
    expect(await (await call("GET", `/api/sites/${s.id}/changes/current`)).json()).toEqual({ change: null });

    const tree = (await (
      await call("GET", `/api/themes/${t.id}/tree?ref=change&path=content/posts`)
    ).json()) as TreeResponse;
    expect(tree.entries.map((e) => e.name)).toContain("new.md");
    expect((await call("GET", `/api/themes/${t.id}/config?ref=main`)).status).toBe(200);
    expect((await call("GET", `/api/themes/${t.id}/theme?ref=main`)).status).toBe(200);
    expect((await call("GET", `/api/themes/${t.id}/builds`)).status).toBe(200);
    expect((await call("GET", `/api/themes/${t.id}/history`)).status).toBe(200);
  });

  it("keeps site-only features away from theme projects", async () => {
    const t = await theme();
    for (const [method, url, body] of [
      ["PUT", `/api/themes/${t.id}/plugins/rss`, { enabled: true }],
      ["GET", `/api/themes/${t.id}/audit?ref=main`],
      ["GET", `/api/themes/${t.id}/deploy`],
      ["PUT", `/api/themes/${t.id}/notion-source`, { dataSourceId: null }],
    ] as const) {
      const res = await call(method, url, body);
      expect(res.status, url).toBe(404);
    }
    expect(() => ctx.projects.site(themeKey(t.id))).toThrow(expect.objectContaining({ code: "site.not_found" }));
    expect(ctx.projects.notionToken(themeKey(t.id))).toBeNull();
  });

  it("refuses a site inside a theme project and a theme project inside a site", async () => {
    const t = await theme();
    const inner = path.join(t.path, "nested");
    fs.mkdirSync(inner);
    await expect(ctx.sites.inspectImport(inner)).rejects.toMatchObject({
      code: "site.path_overlaps_theme",
      params: { theme: "Theme" },
    });
    const s = await ctx.sites.import({ path: repo("site") });
    await ctx.builds.settled();
    const real = fs.realpathSync(s.path);
    await expect(
      ctx.repos.reserved(real, () =>
        ctx.themes.register(real, {
          name: "Again",
          themeName: "starter",
          defaultBranch: "main",
          configFile: "site.yaml",
          origin: "new",
        }),
      ),
    ).rejects.toMatchObject({ code: "site.already_registered" });
    await expect(ctx.sites.inspectImport(t.path)).rejects.toMatchObject({ code: "theme.already_registered" });
  });

  it("removes a theme project's checkouts, sessions and row, and nothing of a site", async () => {
    const t = await theme();
    const s = await ctx.sites.import({ path: repo("site") });
    await ctx.builds.settled();
    const created = (await (await call("POST", `/api/themes/${t.id}/sessions`)).json()) as SessionInfo;
    await ctx.changes.begin(themeKey(t.id), created.id);
    const removed = await call("DELETE", `/api/themes/${t.id}`);
    expect(removed.status).toBe(200);
    expect(fs.existsSync(path.join(ctx.paths.worktrees, "themes", t.id))).toBe(false);
    expect(fs.existsSync(path.join(ctx.paths.sessions, "themes", t.id))).toBe(false);
    expect((await call("GET", `/api/themes/${t.id}`)).status).toBe(404);
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE theme_id = ?").get(t.id)).toEqual({ n: 0 });
    // The theme project's folder stays, and so does the site.
    expect(fs.existsSync(path.join(t.path, "site.yaml"))).toBe(true);
    expect((await call("GET", `/api/sites/${s.id}`)).status).toBe(200);
  });
});

describe("new theme projects (T1)", () => {
  const create = (body: unknown) => call("POST", "/api/themes", body);
  beforeAll(() => {
    new SettingsStore(ctx.db).update({ commitName: "Theme Owner", commitEmail: "owner@example.com" });
  });

  it("makes a theme project from the starter with the theme renamed and the sample content", async () => {
    const dir = path.join(base, "home", `new-theme-${++count}`);
    const res = await create({ name: "Aurora", themeName: "aurora", path: dir, language: "en-US" });
    expect(res.status).toBe(201);
    const t = (await res.json()) as Theme;
    await ctx.builds.settled();
    expect(t).toMatchObject({ name: "Aurora", themeName: "aurora", origin: "new", defaultBranch: "main" });
    expect(fs.existsSync(path.join(dir, "themes", "starter"))).toBe(false);
    const manifest = fs.readFileSync(path.join(dir, "themes", "aurora", "theme.yaml"), "utf8");
    expect(manifest).toMatch(/^name: aurora$/m);
    expect(manifest).toMatch(/^display_name: Aurora$/m);
    expect(fs.readFileSync(path.join(dir, "site.yaml"), "utf8")).toMatch(/^theme:\n {2}name: aurora$/m);
    // The bundled sample content replaced the starter's: posts for a second list page, and the pages.
    expect(fs.readdirSync(path.join(dir, "content", "posts"))).toHaveLength(12);
    expect(fs.readdirSync(path.join(dir, "content", "pages")).sort()).toEqual([
      "about.md",
      "contact.md",
      "style-guide.md",
    ]);
    // One commit with everything in it, and a usable project.
    expect(rawGit(base, dir, "rev-list", "--count", "HEAD").trim()).toBe("1");
    expect(rawGit(base, dir, "status", "--porcelain").trim()).toBe("");
    expect(ctx.themes.get(t.id).readOnly).toBeNull();
  });

  it("puts reference images, cleaned, into _reference/ with the first commit, and refuses a bad one first", async () => {
    const dir = path.join(base, "home", `new-theme-${++count}`);
    const withText = tinyPng([pngChunk("tEXt", Buffer.from("Location\0Home"))]);
    const images = [{ mimeType: "image/png", data: withText.toString("base64") }];
    const res = await create({ name: "Refs", themeName: "refs", path: dir, language: "en-US", images });
    expect(res.status).toBe(201);
    await ctx.builds.settled();
    const refs = fs.readdirSync(path.join(dir, "_reference"));
    expect(refs).toHaveLength(1);
    expect(fs.readFileSync(path.join(dir, "_reference", refs[0] as string)).equals(tinyPng())).toBe(true);
    expect(rawGit(base, dir, "ls-files", "_reference").trim()).toBe(`_reference/${refs[0]}`);
    expect(rawGit(base, dir, "status", "--porcelain").trim()).toBe("");

    const other = path.join(base, "home", `new-theme-${++count}`);
    const gif = [{ mimeType: "image/png", data: Buffer.from("GIF89a\x01\0\x01\0", "latin1").toString("base64") }];
    const bad = await create({ name: "Bad", themeName: "bad", path: other, language: "en-US", images: gif });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: "image.unsupported_type" });
    expect(fs.existsSync(other)).toBe(false);
  });

  it.skipIf(process.platform === "win32")(
    "does not count reference images in _reference/ as the AI's files in a theme project",
    async () => {
      const dir = path.join(base, "home", `new-theme-${++count}`);
      const res = await create({ name: "Count", themeName: "count", path: dir, language: "en-US" });
      const key = themeKey(((await res.json()) as Theme).id);
      await ctx.builds.settled();
      const session = ctx.agent.create(key);
      const first = await ctx.changes.begin(key, session.id);
      fs.writeFileSync(path.join(first.cwd, "content", "pages", "faq.md"), "---\ntitle: FAQ\n---\n");
      await ctx.changes.snapshot(key, first.cwd);
      ctx.changes.setSummary(key, "Added an FAQ page.");
      const applied = await ctx.changes.current(key, false);
      if (!applied) throw new Error("no change set");
      // No Bukit in this app: the check cannot pass, so both applies are forced.
      await ctx.changes.apply(applied.id, { treeHash: applied.treeHash, force: true });
      await ctx.builds.settled();
      const init = rawGit(base, dir, "rev-parse", "HEAD^").trim();

      // A restore (a user action), joined by a conversation that brought an image and changed a page.
      await ctx.changes.restore(key, init);
      const { cwd } = await ctx.changes.begin(key, session.id);
      fs.mkdirSync(path.join(cwd, "_reference"));
      fs.writeFileSync(path.join(cwd, "_reference", "ref-1.png"), tinyPng());
      fs.writeFileSync(path.join(cwd, "content", "pages", "extra.md"), "---\ntitle: Extra\n---\n");
      await ctx.changes.snapshot(key, cwd);
      const view = await ctx.changes.current(key, false);
      if (!view) throw new Error("no change set");
      await ctx.changes.apply(view.id, { treeHash: view.treeHash, force: true });
      const body = rawGit(base, dir, "log", "-1", "--format=%b");
      expect(body).toContain("AI changes: Add 1 file: content/pages/extra.md");
      expect(body).not.toContain("_reference");
    },
  );

  it("reports what a theme lacks: page types, template files and includes (theme_coverage)", async () => {
    const dir = path.join(base, "home", `new-theme-${++count}`);
    const res = await create({ name: "Gaps", themeName: "gaps", path: dir, language: "en-US" });
    expect(res.status).toBe(201);
    await ctx.builds.settled();
    const root = path.join(dir, "themes", "gaps");
    fs.rmSync(path.join(root, "layouts", "partials", "footer.html"));
    fs.rmSync(path.join(root, "layouts", "pages", "pagination.html"));
    const manifest = path.join(root, "theme.yaml");
    fs.writeFileSync(manifest, fs.readFileSync(manifest, "utf8").replace(/^ {2}archive:\n(?: {4}.*\n)+/m, ""));
    fs.mkdirSync(path.join(root, "static"), { recursive: true });
    fs.writeFileSync(path.join(root, "static", "404.html"), "<!doctype html><title>Not found</title>");
    const config = parseYaml(fs.readFileSync(path.join(dir, "site.yaml"), "utf8")).value as Record<string, unknown>;
    const files = workingCopyFiles(dir, new PathGate(dir));
    const report = await themeCoverage(config, "gaps", files);
    expect(report).toMatchObject({
      missingPageTypes: ["archive"],
      missingTemplateFiles: ["pages/pagination.html"],
      notFoundPage: true,
      tokens: false,
    });
    expect("missingIncludes" in report && report.missingIncludes.map((m) => m.include)).toContain(
      "partials/footer.html",
    );
    expect(await themeCoverage(config, "missing", files)).toMatchObject({
      error: expect.stringContaining("themes/missing/theme.yaml"),
    });
  });

  it("gives a theme project's theme panel the coverage, token colors and sample site's theme section", async () => {
    const dir = path.join(base, "home", `new-theme-${++count}`);
    const res = await create({ name: "Panel", themeName: "panel", path: dir, language: "en-US" });
    const t = (await res.json()) as Theme;
    await ctx.builds.settled();
    const tokens = [
      "colors:",
      "  bg: '#f5efe6'",
      "  text: rgb(20 20 20)",
      "  bad: 'red; background: url(x)'",
      "font:",
      "  body: Georgia, serif",
      "",
    ].join("\n");
    fs.writeFileSync(path.join(dir, "themes", "panel", "tokens.yaml"), tokens);
    commitAllAs(base, dir);

    const panel = (await (await call("GET", `/api/themes/${t.id}/theme?ref=main`)).json()) as ThemeResponse;
    expect(panel.coverage).toMatchObject({
      theme: "themes/panel",
      missingPageTypes: [],
      tokens: true,
      notFoundPage: false,
    });
    // Only values that are plain CSS colors become swatches.
    expect(panel.colors).toEqual([
      { name: "bg", value: "#f5efe6" },
      { name: "text", value: "rgb(20 20 20)" },
    ]);
    expect(panel.siteTheme).toMatchObject({ name: "panel" });

    // A site's theme panel has none of them.
    const s = await ctx.sites.import({ path: repo("site") });
    await ctx.builds.settled();
    const site = (await (await call("GET", `/api/sites/${s.id}/theme?ref=main`)).json()) as ThemeResponse;
    expect(site).toMatchObject({ coverage: null, colors: null, siteTheme: null });
  });

  it("keeps the starter directory when the theme is called starter", async () => {
    const dir = path.join(base, "home", `new-theme-${++count}`);
    const res = await create({ name: "Plain", themeName: "starter", path: dir, language: "en-US" });
    expect(res.status).toBe(201);
    await ctx.builds.settled();
    expect(fs.existsSync(path.join(dir, "themes", "starter", "theme.yaml"))).toBe(true);
  });

  it("refuses a bad theme name, a used folder and a folder inside a site, and leaves nothing behind", async () => {
    const dir = path.join(base, "home", `new-theme-${++count}`);
    for (const themeName of ["../x", ".hidden", "-opt", "con", "a/b", "a..b", ""]) {
      const res = await create({ name: "Bad", themeName, path: dir, language: "en-US" });
      expect(res.status, themeName).toBe(400);
    }
    expect(fs.existsSync(dir)).toBe(false);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "keep.txt"), "mine");
    const used = await create({ name: "Used", themeName: "used", path: dir, language: "en-US" });
    expect(used.status).toBe(409);
    expect(await used.json()).toMatchObject({ code: "site.path_not_empty" });
    expect(fs.readdirSync(dir)).toEqual(["keep.txt"]);
    const s = await ctx.sites.import({ path: repo("site") });
    await ctx.builds.settled();
    const inside = await create({
      name: "Inside",
      themeName: "inside",
      path: path.join(s.path, "t"),
      language: "en-US",
    });
    expect(inside.status).toBe(409);
    expect(await inside.json()).toMatchObject({ code: "site.path_overlaps_site" });
  });
});
