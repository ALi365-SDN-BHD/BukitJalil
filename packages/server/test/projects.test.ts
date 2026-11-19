import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CurrentChange, SessionInfo, Theme, ThemeResponse, TreeResponse } from "@bukitjalil/shared";
import { strToU8, unzipSync, zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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

    // A tokens file larger than a template may be (256 KiB) still shows its colors.
    fs.writeFileSync(path.join(dir, "themes", "panel", "tokens.yaml"), `${tokens}# ${"x".repeat(300 * 1024)}\n`);
    commitAllAs(base, dir);
    const big = (await (await call("GET", `/api/themes/${t.id}/theme?ref=main`)).json()) as ThemeResponse;
    expect(big.colors?.map((c) => c.name)).toEqual(["bg", "text"]);

    // A site's theme panel has none of them.
    const s = await ctx.sites.import({ path: repo("site") });
    await ctx.builds.settled();
    const site = (await (await call("GET", `/api/sites/${s.id}/theme?ref=main`)).json()) as ThemeResponse;
    expect(site).toMatchObject({ coverage: null, colors: null, siteTheme: null });
  });

  it("applies a theme to a site as a user change set and exports only the theme as a zip", async () => {
    const dir = path.join(base, "home", `new-theme-${++count}`);
    const created = await create({ name: "Deliver", themeName: "deliver", path: dir, language: "en-US" });
    const t = (await created.json()) as Theme;
    await ctx.builds.settled();
    const s = await ctx.sites.import({ path: repo("site") });
    await ctx.builds.settled();

    // The plan compares the site's default branch: nothing there yet, and its theme is still the starter.
    const plan = await call("GET", `/api/themes/${t.id}/apply?siteId=${s.id}`);
    expect(plan.status).toBe(200);
    expect(await plan.json()).toMatchObject({
      site: { id: s.id },
      theme: { name: "deliver", dir: "themes/deliver" },
      existing: false,
      removed: [],
      configTheme: "starter",
    });
    const planBody = (await (await call("GET", `/api/themes/${t.id}/apply?siteId=${s.id}`)).json()) as {
      added: string[];
    };
    expect(planBody.added).toEqual(expect.arrayContaining(["theme.yaml", "layouts/pages/index.html"]));

    const applied = await call("POST", `/api/themes/${t.id}/apply`, { siteId: s.id, setConfig: true });
    expect(applied.status).toBe(201);
    const result = (await applied.json()) as { siteId: string; changeId: string };
    expect(result.siteId).toBe(s.id);
    const change = (await (await call("GET", `/api/sites/${s.id}/changes/current`)).json()) as CurrentChange;
    expect(change.change).toMatchObject({ id: result.changeId, status: "open" });
    expect(change.change?.files.map((f) => f.path)).toEqual(
      expect.arrayContaining(["site.yaml", "themes/deliver/theme.yaml"]),
    );
    expect(change.change?.summary).toContain("Applied theme deliver from Deliver");
    // Sample content is not part of the deliverable, and the default branch is untouched until review.
    expect(change.change?.files.some((f) => f.path.startsWith("content/"))).toBe(false);
    expect(rawGit(base, s.path, "show", "main:site.yaml")).not.toMatch(/name: deliver/);

    // Apply through the normal review flow, then the site has the theme and names it.
    const view = change.change;
    if (!view) throw new Error("no change set");
    await ctx.changes.apply(view.id, { treeHash: view.treeHash, force: true });
    await ctx.builds.settled();
    expect(fs.existsSync(path.join(s.path, "themes", "deliver", "theme.yaml"))).toBe(true);
    expect(rawGit(base, s.path, "show", "main:site.yaml")).toMatch(/name: deliver/);

    // The site already has it: apply refuses without `overwrite`, and the same files make no new change set.
    expect(await (await call("GET", `/api/themes/${t.id}/apply?siteId=${s.id}`)).json()).toMatchObject({
      existing: true,
      configTheme: "deliver",
      added: [],
      modified: [],
      removed: [],
    });
    const refused = await call("POST", `/api/themes/${t.id}/apply`, { siteId: s.id });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: "theme.exists" });
    const again = await call("POST", `/api/themes/${t.id}/apply`, {
      siteId: s.id,
      overwrite: true,
      setConfig: true,
    });
    expect(again.status).toBe(201);
    expect(await again.json()).toMatchObject({ siteId: s.id, changeId: null });

    // A change set with content waiting for review is not stepped over.
    const session = ctx.agent.create(s.id);
    const work = await ctx.changes.begin(s.id, session.id);
    fs.writeFileSync(path.join(work.cwd, "content", "pages", "waiting.md"), "---\ntitle: Waiting\n---\n");
    await ctx.changes.snapshot(s.id, work.cwd);
    const blocked = await call("POST", `/api/themes/${t.id}/apply`, {
      siteId: s.id,
      overwrite: true,
    });
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({ code: "change.open_exists" });
    const waiting = ctx.changes.store.open(s.id);
    if (!waiting) throw new Error("no open change set");
    await ctx.changes.discard(waiting.id);

    // The zip holds themes/deliver/ alone, not the sample site.
    const zip = await call("GET", `/api/themes/${t.id}/export`);
    expect(zip.status).toBe(200);
    expect(zip.headers.get("content-type")).toBe("application/zip");
    expect(zip.headers.get("content-disposition")).toContain('filename="deliver.zip"');
    const entries = unzipSync(new Uint8Array(await zip.arrayBuffer()));
    expect(Object.keys(entries)).toEqual(expect.arrayContaining(["theme.yaml", "layouts/pages/index.html"]));
    expect(Object.keys(entries).some((p) => p.startsWith("content/"))).toBe(false);
    expect(new TextDecoder().decode(entries["theme.yaml"])).toMatch(/^name: deliver$/m);
  });

  it("keeps the site's uploads, leaves an existing change set open, and waits for a running conversation", async () => {
    const siteDir = repo("site");
    const uploads = path.join(siteDir, "themes", "starter", "static", "uploads");
    fs.mkdirSync(uploads, { recursive: true });
    fs.writeFileSync(path.join(uploads, "logo.png"), tinyPng());
    commitAllAs(base, siteDir);
    const s = await ctx.sites.import({ path: siteDir });
    await ctx.builds.settled();
    const make = async (name: string) => {
      const res = await create({
        name,
        themeName: name,
        path: path.join(base, "home", `t-${++count}`),
        language: "en-US",
      });
      await ctx.builds.settled();
      return (await res.json()) as Theme;
    };
    const files = async () =>
      ((await (await call("GET", `/api/sites/${s.id}/changes/current`)).json()) as CurrentChange).change?.files ?? [];
    const discardOpen = async () => {
      const open = ctx.changes.store.open(s.id);
      if (open) await ctx.changes.discard(open.id);
    };

    // Switching the site to another theme brings the uploads along, and they win over the theme's own.
    const aurora = await make("aurora");
    const auroraUploads = path.join(aurora.path, "themes", "aurora", "static", "uploads");
    fs.mkdirSync(auroraUploads, { recursive: true });
    fs.writeFileSync(path.join(auroraUploads, "logo.png"), "theme's own logo");
    commitAllAs(base, aurora.path);
    expect((await call("POST", `/api/themes/${aurora.id}/apply`, { siteId: s.id, setConfig: true })).status).toBe(201);
    expect((await files()).map((f) => f.path)).toContain("themes/aurora/static/uploads/logo.png");
    const siteCwd = path.join(ctx.paths.worktrees, s.id, "ai");
    expect(
      fs.readFileSync(path.join(siteCwd, "themes", "aurora", "static", "uploads", "logo.png")).equals(tinyPng()),
    ).toBe(true);
    const switched = await ctx.changes.current(s.id, false);
    if (!switched) throw new Error("no change set");
    await ctx.changes.apply(switched.id, { treeHash: switched.treeHash, force: true });
    await ctx.builds.settled();

    // Replacing the site's copy of the same theme keeps them, and the plan does not list them as removed.
    const starter = await make("starter");
    const plan = (await (await call("GET", `/api/themes/${starter.id}/apply?siteId=${s.id}`)).json()) as {
      removed: string[];
    };
    expect(plan.removed).not.toContain("static/uploads/logo.png");
    expect(plan).not.toMatchObject({ modified: expect.arrayContaining(["static/uploads/logo.png"]) });
    const replaced = await call("POST", `/api/themes/${starter.id}/apply`, { siteId: s.id, overwrite: true });
    expect(replaced.status).toBe(201);
    expect((await files()).some((f) => f.path.includes("static/uploads"))).toBe(false);
    await discardOpen();

    // Applying what the site already has changes nothing, and leaves a change set it did not open alone.
    const session = ctx.agent.create(s.id);
    await ctx.changes.begin(s.id, session.id);
    const opened = ctx.changes.store.open(s.id);
    expect(opened).not.toBeNull();
    const same = await call("POST", `/api/themes/${aurora.id}/apply`, { siteId: s.id, overwrite: true });
    expect(await same.json()).toMatchObject({ changeId: null });
    expect(ctx.changes.store.open(s.id)?.id).toBe(opened?.id);
    await discardOpen();

    // A running conversation writes the same checkout: apply waits for it.
    const busy = vi.spyOn(ctx.agent, "busy").mockReturnValue(true);
    try {
      const refused = await call("POST", `/api/themes/${aurora.id}/apply`, { siteId: s.id, overwrite: true });
      expect(refused.status).toBe(409);
      expect(await refused.json()).toMatchObject({ code: "site.busy" });
    } finally {
      busy.mockRestore();
    }
  });

  it("keeps the snapshot and files together when reading the change set back fails", async () => {
    const dir = path.join(base, "home", `new-theme-${++count}`);
    const t = (await (
      await create({ name: "Rollback", themeName: "rollback", path: dir, language: "en-US" })
    ).json()) as Theme;
    await ctx.builds.settled();
    const s = await ctx.sites.import({ path: repo("rollback-site") });
    await ctx.builds.settled();

    const original = ctx.changes.current.bind(ctx.changes);
    let calls = 0;
    ctx.changes.current = (async (...args: Parameters<typeof original>) => {
      calls += 1;
      if (calls === 2) throw new Error("read failed");
      return original(...args);
    }) as typeof ctx.changes.current;
    let res: Response;
    try {
      res = await call("POST", `/api/themes/${t.id}/apply`, { siteId: s.id, overwrite: true });
    } finally {
      ctx.changes.current = original;
    }
    expect(res.status).toBe(201);
    // The snapshot is the point of no return: the theme is still in the change set and the checkout.
    const view = await ctx.changes.current(s.id, false);
    expect(view?.files.map((f) => f.path)).toEqual(expect.arrayContaining(["themes/rollback/theme.yaml"]));
    expect(fs.existsSync(path.join(ctx.paths.worktrees, s.id, "ai", "themes", "rollback", "theme.yaml"))).toBe(true);
  });

  it("refuses a theme directory the site's .gitignore keeps out", async () => {
    const siteDir = repo("ignored-site");
    fs.appendFileSync(path.join(siteDir, ".gitignore"), "themes/\n");
    commitAllAs(base, siteDir);
    const s = await ctx.sites.import({ path: siteDir });
    await ctx.builds.settled();
    const dir = path.join(base, "home", `new-theme-${++count}`);
    const t = (await (
      await create({ name: "Ignored", themeName: "ignored", path: dir, language: "en-US" })
    ).json()) as Theme;
    await ctx.builds.settled();

    const res = await call("POST", `/api/themes/${t.id}/apply`, { siteId: s.id, overwrite: true });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "theme.ignored" });
    // The empty change set this request opened is closed again.
    expect(ctx.changes.store.open(s.id)).toBeNull();
  });

  it("keeps an earlier user summary when a theme is applied", async () => {
    const s = await ctx.sites.import({ path: repo("summary-site") });
    await ctx.builds.settled();
    const dir = path.join(base, "home", `new-theme-${++count}`);
    const t = (await (
      await create({ name: "Summary", themeName: "summary", path: dir, language: "en-US" })
    ).json()) as Theme;
    await ctx.builds.settled();
    const { change } = await ctx.changes.beginUserChange(s.id);
    ctx.changes.store.setUserSummary(change.id, "User upload");

    const res = await call("POST", `/api/themes/${t.id}/apply`, { siteId: s.id, setConfig: true });
    expect(res.status).toBe(201);
    const view = await ctx.changes.current(s.id, false);
    expect(view?.summary).toContain("User upload");
    expect(view?.summary).toContain("Applied theme summary");
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

describe("importing theme projects (T2)", () => {
  beforeAll(() => {
    new SettingsStore(ctx.db).update({ commitName: "Theme Owner", commitEmail: "owner@example.com" });
  });

  const inspect = (p: string) => call("POST", "/api/themes/import/inspect", { path: p });
  const importTheme = (body: unknown) => call("POST", "/api/themes/import", body);

  /** A theme directory `root/<name>/` with a valid manifest and one layout; returns its path. */
  function themeDir(root: string, name: string, extra: Record<string, string> = {}): string {
    const dir = path.join(root, name);
    fs.mkdirSync(path.join(dir, "layouts"), { recursive: true });
    const lines = [
      `name: ${name}`,
      `display_name: ${name} Theme`,
      ...Object.entries(extra).map(([k, v]) => `${k}: ${v}`),
    ];
    fs.writeFileSync(path.join(dir, "theme.yaml"), `${lines.join("\n")}\n`);
    fs.writeFileSync(path.join(dir, "layouts", "index.html"), `<h1>{{ site.title }}</h1>`);
    return dir;
  }

  it("imports a single theme folder, then a zip of one, with the sample site and content", async () => {
    const root = path.join(base, "sources", `single-${++count}`);
    const source = themeDir(root, "aurora");
    const inspected = await inspect(source);
    expect(inspected.status).toBe(200);
    expect(await inspected.json()).toMatchObject({
      site: null,
      themes: [{ id: "aurora", dir: "aurora", includes: ["aurora"], missingParent: null }],
    });

    const target = path.join(base, "home", `imported-${++count}`);
    const res = await importTheme({
      source,
      theme: "aurora",
      path: target,
      name: "Imported Aurora",
      language: "en-US",
    });
    expect(res.status).toBe(201);
    const theme = (await res.json()) as Theme;
    await ctx.builds.settled();
    expect(theme).toMatchObject({ name: "Imported Aurora", themeName: "aurora", origin: "import", readOnly: null });
    expect(fs.readFileSync(path.join(target, "themes", "aurora", "theme.yaml"), "utf8")).toMatch(
      /^display_name: aurora Theme$/m,
    );
    expect(fs.readFileSync(path.join(target, "site.yaml"), "utf8")).toMatch(/^theme:\n {2}name: aurora$/m);
    expect(fs.readdirSync(path.join(target, "content", "posts"))).toHaveLength(12);
    expect(rawGit(base, target, "rev-list", "--count", "HEAD").trim()).toBe("1");

    // A zip of the folder (a single wrapper directory) is the same theme.
    const zipped = path.join(base, "sources", `zip-${++count}.zip`);
    fs.writeFileSync(
      zipped,
      Buffer.from(
        zipSync({
          "wrapped/theme.yaml": strToU8("name: zip-theme\ndisplay_name: Zip Theme\n"),
          "wrapped/layouts/index.html": strToU8("<h1>Zip</h1>"),
        }),
      ),
    );
    expect(await (await inspect(zipped)).json()).toMatchObject({
      themes: [{ id: ".", dir: "zip-theme", includes: ["zip-theme"], missingParent: null }],
    });
    const zipTarget = path.join(base, "home", `imported-${++count}`);
    const zipRes = await importTheme({
      source: zipped,
      theme: ".",
      path: zipTarget,
      name: "Zip Theme",
      language: "en-US",
    });
    expect(zipRes.status).toBe(201);
    await ctx.builds.settled();
    expect(fs.existsSync(path.join(zipTarget, "themes", "zip-theme", "layouts", "index.html"))).toBe(true);
  });

  it("skips a manifest larger than 1 MiB without reading it, and still offers the other themes", async () => {
    const root = path.join(base, "sources", `huge-manifest-${++count}`);
    themeDir(path.join(root, "themes"), "ok");
    const huge = themeDir(path.join(root, "themes"), "huge");
    fs.writeFileSync(path.join(huge, "theme.yaml"), "x".repeat(1024 * 1024 + 1));
    const res = await inspect(root);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { themes: { dir: string }[] }).themes.map((t) => t.dir)).toEqual(["ok"]);
    const single = await inspect(huge);
    expect(single.status).toBe(200);
    expect(await single.json()).toMatchObject({ themes: [] });
  });

  it("ignores macOS archive metadata when a zip wraps one theme", async () => {
    const zipped = path.join(base, "sources", `mac-${++count}.zip`);
    fs.writeFileSync(
      zipped,
      Buffer.from(
        zipSync({
          "__MACOSX/._wrapped": strToU8("metadata"),
          ".DS_Store": strToU8("metadata"),
          "wrapped/theme.yaml": strToU8("name: mac-theme\ndisplay_name: Mac Theme\n"),
          "wrapped/layouts/index.html": strToU8("<h1>Mac</h1>"),
        }),
      ),
    );
    expect(await (await inspect(zipped)).json()).toMatchObject({
      themes: [{ id: ".", dir: "mac-theme", includes: ["mac-theme"], missingParent: null }],
    });
    const target = path.join(base, "home", `imported-${++count}`);
    const res = await importTheme({ source: zipped, theme: ".", path: target, name: "Mac Theme", language: "en-US" });
    expect(res.status).toBe(201);
    await ctx.builds.settled();
    expect(fs.existsSync(path.join(target, "themes", "mac-theme", "theme.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(target, "themes", "mac-theme", ".DS_Store"))).toBe(false);
    expect(fs.existsSync(path.join(target, "themes", "mac-theme", "__MACOSX"))).toBe(false);
  });

  it("takes a theme from a site folder, brings its parent, and filters .env and node_modules", async () => {
    const root = path.join(base, "sources", `chain-${++count}`);
    themeDir(root, "base");
    const child = themeDir(root, "child", { extends: "base" });
    fs.writeFileSync(path.join(child, ".env"), "SECRET=1");
    fs.mkdirSync(path.join(child, "node_modules", "x"), { recursive: true });
    fs.writeFileSync(path.join(child, "node_modules", "x", "y.js"), "x");

    const inspected = (await (await inspect(child)).json()) as {
      themes: { includes: string[]; missingParent: string | null }[];
    };
    expect(inspected.themes[0]).toMatchObject({ includes: ["base", "child"], missingParent: null });
    const target = path.join(base, "home", `imported-${++count}`);
    expect(
      await (await importTheme({ source: child, theme: "child", path: target, name: "Child", language: "en-US" }))
        .status,
    ).toBe(201);
    await ctx.builds.settled();
    expect(fs.existsSync(path.join(target, "themes", "base", "theme.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(target, "themes", "child", "theme.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(target, "themes", "child", ".env"))).toBe(false);
    expect(fs.existsSync(path.join(target, "themes", "child", "node_modules"))).toBe(false);

    // A full site folder is offered to both importers.
    const siteDir = repo("import-site");
    expect(await (await inspect(siteDir)).json()).toMatchObject({
      site: { configFile: "site.yaml" },
      themes: [{ dir: "starter" }],
    });
  });

  it("refuses a missing parent, plugin files, links and an unreadable zip", async () => {
    const root = path.join(base, "sources", `bad-${++count}`);
    const orphan = themeDir(root, "orphan", { extends: "missing" });
    const inspected = (await (await inspect(orphan)).json()) as {
      themes: { missingParent: string | null }[];
    };
    expect(inspected.themes[0]?.missingParent).toBe("missing");
    const target = path.join(base, "home", `bad-import-${++count}`);
    const missing = await importTheme({
      source: orphan,
      theme: "orphan",
      path: target,
      name: "Orphan",
      language: "en-US",
    });
    expect(missing.status).toBe(409);
    expect(await missing.json()).toMatchObject({ code: "theme.parent_missing", params: { parent: "missing" } });
    expect(fs.existsSync(target)).toBe(false);

    // A folder called plugins is an ordinary theme folder; a plugin.yaml is a plugin file.
    const plugin = themeDir(root, "plugin");
    fs.mkdirSync(path.join(plugin, "assets", "plugins"), { recursive: true });
    fs.writeFileSync(path.join(plugin, "assets", "plugins", "lightbox.js"), "");
    expect((await inspect(plugin)).status).toBe(200);
    fs.mkdirSync(path.join(plugin, "plugins", "x"), { recursive: true });
    fs.writeFileSync(path.join(plugin, "plugins", "x", "plugin.yaml"), "name: x\n");
    const plugged = await importTheme({
      source: plugin,
      theme: "plugin",
      path: target,
      name: "Plugin",
      language: "en-US",
    });
    expect(plugged.status).toBe(409);
    expect(await plugged.json()).toMatchObject({ code: "theme.import_unsafe" });

    const linked = themeDir(root, "linked");
    fs.symlinkSync("theme.yaml", path.join(linked, "alias.yaml"));
    const linkRes = await importTheme({
      source: linked,
      theme: "linked",
      path: target,
      name: "Linked",
      language: "en-US",
    });
    expect(linkRes.status).toBe(409);
    expect(await linkRes.json()).toMatchObject({ code: "theme.import_unsafe" });

    // A linked folder on the way to a theme is not followed either.
    const siteRoot = path.join(base, "sources", `linked-site-${++count}`);
    fs.mkdirSync(siteRoot, { recursive: true });
    themeDir(path.join(root, "elsewhere"), "outside");
    fs.symlinkSync(path.join(root, "elsewhere"), path.join(siteRoot, "themes"));
    expect(await (await inspect(siteRoot)).json()).toMatchObject({ themes: [] });

    const badZip = path.join(base, "sources", `bad-${++count}.zip`);
    fs.writeFileSync(badZip, "not a zip");
    const zipRes = await inspect(badZip);
    expect(zipRes.status).toBe(400);
    expect(await zipRes.json()).toMatchObject({ code: "theme.import_invalid" });
    expect(fs.existsSync(target)).toBe(false);
  });
});

describe("cloning a site from a desktop capture (T3)", () => {
  beforeAll(() => {
    new SettingsStore(ctx.db).update({ commitName: "Theme Owner", commitEmail: "owner@example.com" });
  });

  /** A capture directory as the desktop writes it; returns its id. */
  function capture(options: { svg?: string; authorized?: boolean } = {}): string {
    const id = "abcdef0123456789abcdef0123456789";
    const dir = path.join(ctx.paths.captures, id);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(path.join(dir, "pages", "1"), { recursive: true });
    fs.mkdirSync(path.join(dir, "reference"), { recursive: true });
    fs.writeFileSync(path.join(dir, "pages", "1", "index.html"), "<!doctype html><h1>Captured</h1>");
    fs.writeFileSync(path.join(dir, "pages", "1", "styles.css"), "h1 { color: #123456 }");
    fs.writeFileSync(
      path.join(dir, "pages", "1", "meta.json"),
      JSON.stringify({ url: "https://example.com/", title: "Example", images: [], resources: [] }),
    );
    fs.writeFileSync(
      path.join(dir, "pages", "1", "logo.svg"),
      options.svg ?? '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>',
    );
    fs.writeFileSync(path.join(dir, "reference", "1-375.png"), tinyPng());
    fs.writeFileSync(
      path.join(dir, "manifest.json"),
      JSON.stringify({
        format: 1,
        id,
        origin: "https://example.com",
        title: "Example",
        pages: [
          {
            url: "https://example.com/",
            title: "Example",
            html: "pages/1/index.html",
            css: "pages/1/styles.css",
            meta: "pages/1/meta.json",
            screenshots: ["reference/1-375.png"],
          },
        ],
        reference: ["reference/1-375.png"],
        assets: [{ path: "pages/1/logo.svg", source: "https://example.com/logo.svg" }],
      }),
    );
    return id;
  }

  it("validates the capture again and makes a theme project with _capture and _reference", async () => {
    const captureId = capture({
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect fill="red"/><image href="https://evil.example/x.png"/></svg>',
    });
    const target = path.join(base, "home", `clone-${++count}`);
    const res = await call("POST", "/api/themes", {
      name: "Captured Theme",
      themeName: "captured",
      path: target,
      language: "en-US",
      origin: "clone",
      captureId,
      authorized: true,
    });
    expect(res.status).toBe(201);
    const theme = (await res.json()) as Theme;
    await ctx.builds.settled();
    expect(theme).toMatchObject({ themeName: "captured", origin: "clone", readOnly: null });
    expect(fs.readFileSync(path.join(target, "_capture", "pages", "1", "index.html"), "utf8")).toContain("Captured");
    expect(fs.readFileSync(path.join(target, "_capture", "pages", "1", "styles.css"), "utf8")).toContain("#123456");
    expect(fs.existsSync(path.join(target, "_reference", "capture-1-375.png"))).toBe(true);
    // SVG scripts and external references are removed; the drawing stays.
    const svg = fs.readFileSync(path.join(target, "_capture", "pages", "1", "logo.svg"), "utf8");
    expect(svg).not.toContain("<script");
    expect(svg).not.toContain("evil.example");
    expect(svg).toContain("<rect");
    // The capture is gone after its first commit.
    expect(fs.existsSync(path.join(ctx.paths.captures, captureId))).toBe(false);
  });

  it("keeps the capture when registration fails", async () => {
    const captureId = capture();
    const target = path.join(base, "home", `clone-${++count}`);
    const original = ctx.themes.register.bind(ctx.themes);
    ctx.themes.register = (async () => {
      throw new Error("register failed");
    }) as typeof ctx.themes.register;
    let res: Response;
    try {
      res = await call("POST", "/api/themes", {
        name: "Register Fails",
        themeName: "register-fails",
        path: target,
        language: "en-US",
        origin: "clone",
        captureId,
        authorized: true,
      });
    } finally {
      ctx.themes.register = original;
    }
    expect(res.status).toBe(500);
    expect(fs.existsSync(path.join(ctx.paths.captures, captureId))).toBe(true);
    fs.rmSync(path.join(ctx.paths.captures, captureId), { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  });

  it("refuses an unauthorized clone, a missing capture, a bad manifest and a symlink", async () => {
    const captureId = capture();
    const target = path.join(base, "home", `clone-${++count}`);
    const unauthorized = await call("POST", "/api/themes", {
      name: "No",
      themeName: "no",
      path: target,
      language: "en-US",
      origin: "clone",
      captureId,
      authorized: false,
    });
    expect(unauthorized.status).toBe(400);
    expect(await unauthorized.json()).toMatchObject({ code: "theme.clone_unauthorized" });
    expect(fs.existsSync(path.join(ctx.paths.captures, captureId))).toBe(true);

    const missing = await call("POST", "/api/themes", {
      name: "Missing",
      themeName: "missing",
      path: target,
      language: "en-US",
      origin: "clone",
      captureId: "ffffffffffffffffffffffffffffffff",
      authorized: true,
    });
    expect(missing.status).toBe(409);
    expect(await missing.json()).toMatchObject({ code: "theme.capture_missing" });

    const dir = path.join(ctx.paths.captures, captureId);
    fs.rmSync(path.join(dir, "reference", "1-375.png"));
    fs.symlinkSync(path.join(dir, "pages", "1", "index.html"), path.join(dir, "reference", "1-375.png"));
    const linked = await call("POST", "/api/themes", {
      name: "Linked",
      themeName: "linked",
      path: target,
      language: "en-US",
      origin: "clone",
      captureId,
      authorized: true,
    });
    expect(linked.status).toBe(400);
    expect(await linked.json()).toMatchObject({ code: "theme.capture_invalid" });
    expect(fs.existsSync(target)).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
