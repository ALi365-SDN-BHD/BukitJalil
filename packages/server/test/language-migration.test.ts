import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LanguageMigrationResponse } from "@bukitjalil/shared";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { planLanguageMigration } from "../src/sites/language-migration.ts";
import { ADMIN, commitAllAs, makeApp, rawGit, req } from "./helpers.ts";

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bj-language-")));
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

const ready = (text: string) => {
  const plan = planLanguageMigration(text);
  if (!plan.needed || !plan.ok) throw new Error(`expected a migration, got ${JSON.stringify(plan)}`);
  return plan;
};

describe("planLanguageMigration (plan 8.7)", () => {
  it("turns site.language into a one-entry list in its place, keeping comments", () => {
    const text = "site:\n  title: A # the title\n  language: en-US # the language\n  timezone: UTC\n";
    const plan = ready(text);
    expect(plan.text).toBe("site:\n  title: A # the title\n  languages: [ en-US ] # the language\n  timezone: UTC\n");
    expect(plan.movesToRoot).toBe(false);
  });

  it("drops site.language next to a list, and keeps multilingual addresses", () => {
    const plan = ready("site:\n  language: en\n  languages: [en, zh-CN]\n  defaultLanguage: zh-CN\n");
    expect(parse(plan.text).site).toEqual({
      languages: ["en", "zh-CN"],
      defaultLanguage: "zh-CN",
      defaultLanguageInSubdir: true,
    });
    // An explicit layout is the user's choice; only site.language goes.
    const chosen = ready("site:\n  language: en\n  languages: [en, zh-CN]\n  defaultLanguageInSubdir: false\n");
    expect(parse(chosen.text).site).toEqual({ languages: ["en", "zh-CN"], defaultLanguageInSubdir: false });
    // A multilingual site without site.language still needs the layout setting.
    expect(parse(ready("site:\n  languages: [en, de]\n").text).site.defaultLanguageInSubdir).toBe(true);
  });

  it("removes a blank site.language, which meant Bukit's default", () => {
    expect(parse(ready("site:\n  title: A\n  language: ''\n").text).site).toEqual({ title: "A" });
    expect(parse(ready("site:\n  title: A\n  language:\n").text).site).toEqual({ title: "A" });
  });

  it("replaces an empty or broken languages key instead of adding a second one", () => {
    for (const list of ["[]", "", "en"]) {
      const plan = ready(`site:\n  language: en\n  languages: ${list}\n  title: A\n`);
      expect(parse(plan.text, { uniqueKeys: true }).site).toEqual({ languages: ["en"], title: "A" });
    }
  });

  it("keeps the comment of the removed site.language line", () => {
    expect(ready("site:\n  language: en # main\n  title: A\n").text).toContain("languages: [ en ] # main");
    expect(ready("site:\n  language: en # old\n  languages: [en, de]\n").text).toContain("# old");
  });

  it("matches defaultLanguage without case, like Bukit", () => {
    expect(
      parse(ready("site:\n  language: en\n  languages: [en, de]\n  defaultLanguage: EN\n").text).site.language,
    ).toBeUndefined();
  });

  it("keeps a comment line written above site.language", () => {
    expect(ready("site:\n  title: A\n  # the language\n  language: en\n").text).toContain(
      "  # the language\n  languages: [ en ]",
    );
  });

  it("says when a one-entry list moves to the root", () => {
    expect(ready("site:\n  language: en\n  languages: [en]\n").movesToRoot).toBe(true);
  });

  it("needs nothing for migrated or unreadable files", () => {
    for (const text of [
      "site:\n  languages: [en]\n",
      "site:\n  languages: [en, de]\n  defaultLanguageInSubdir: true\n",
      "site:\n  title: A\n",
      "site: [\n",
      "site: 1\n",
      "site:\n  title: A\n  title: B\n  language: en\n",
    ]) {
      expect(planLanguageMigration(text)).toEqual({ needed: false });
    }
  });

  it("refuses what it cannot decide for the user", () => {
    expect(planLanguageMigration("site:\n  language: [en]\n")).toEqual({
      needed: true,
      ok: false,
      reason: "bad_language",
    });
    // Bukit 2.1 takes only plain, distinct codes in site.languages.
    for (const list of ["\n    - code: en\n    - code: de", "[en, en]", "[en, EN]", "[' en', en]", "[en, 3]"]) {
      expect(planLanguageMigration(`site:\n  language: en\n  languages: ${list}\n`)).toEqual({
        needed: true,
        ok: false,
        reason: "bad_languages",
      });
    }
    expect(planLanguageMigration("site:\n  language: en\n  defaultLanguage: de\n")).toEqual({
      needed: true,
      ok: false,
      reason: "default_not_listed",
    });
  });
});

describe("language migration API", () => {
  const contexts: ReturnType<typeof makeApp>[] = [];
  afterEach(async () => {
    await Promise.all(contexts.splice(0).map((c) => c.builds.shutdown()));
  });

  let counter = 0;
  async function siteWith(yaml: string) {
    const name = `lang${++counter}`;
    const ctx = makeApp({ appHome: path.join(base, `${name}-app`), userHome: base });
    contexts.push(ctx);
    const dir = path.join(base, name);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "site.yaml"), yaml);
    rawGit(base, dir, "init", "-q", "-b", "main");
    commitAllAs(base, dir, "init");
    const site = await ctx.sites.import({ path: dir });
    await ctx.builds.settled();
    ctx.db
      .prepare("INSERT OR REPLACE INTO settings (key, value_json) VALUES ('commitName', ?), ('commitEmail', ?)")
      .run(JSON.stringify("Site Owner"), JSON.stringify("owner@example.com"));
    const call = async (method: string, body?: unknown) => {
      const res = await ctx.app.fetch(
        req(`/api/sites/${site.id}/language-migration`, {
          method,
          ...(method === "GET" ? {} : { body: JSON.stringify(body ?? {}) }),
          headers: { "content-type": "application/json", "x-bukitjalil": "1", origin: ADMIN },
        }),
      );
      return { status: res.status, json: (await res.json()) as LanguageMigrationResponse & { code?: string } };
    };
    const head = () => rawGit(base, dir, "rev-parse", "HEAD").trim();
    return { dir, call, head };
  }

  it("shows the patch, then commits it as the user", async () => {
    const s = await siteWith("site:\n  title: A\n  language: en-US\n");
    const before = s.head();
    const shown = await s.call("GET");
    expect(shown.status).toBe(200);
    expect(shown.json).toMatchObject({ commit: before, state: "ready", reason: null, movesToRoot: false });
    expect(shown.json.patch).toMatch(/^@@ /);
    expect(shown.json.patch).toContain("-  language: en-US\n+  languages: [ en-US ]");

    const applied = await s.call("POST", { commit: before });
    expect(applied.status).toBe(200);
    expect(applied.json).toMatchObject({ state: "none", patch: null });
    expect(rawGit(base, s.dir, "rev-parse", "HEAD~1").trim()).toBe(before);
    expect(rawGit(base, s.dir, "log", "-1", "--format=%s|%an|%ae").trim()).toBe(
      "Migrate language settings for Bukit 2.1|Site Owner|owner@example.com",
    );
    expect(fs.readFileSync(path.join(s.dir, "site.yaml"), "utf8")).toBe("site:\n  title: A\n  languages: [ en-US ]\n");
    expect(rawGit(base, s.dir, "status", "--porcelain").trim()).toBe("");
  });

  it("refuses a stale commit, a dirty folder and a migrated file", async () => {
    const s = await siteWith("site:\n  title: A\n  language: en-US\n");
    const head = s.head();
    expect((await s.call("POST", { commit: "0".repeat(40) })).json.code).toBe("language.commit_changed");
    fs.writeFileSync(path.join(s.dir, "site.yaml"), "site:\n  title: B\n  language: en-US\n");
    expect((await s.call("POST", { commit: head })).json.code).toBe("language.dirty");
    rawGit(base, s.dir, "checkout", "-q", "--", "site.yaml");
    expect(s.head()).toBe(head);
    expect((await s.call("POST", { commit: head })).status).toBe(200);
    expect((await s.call("POST", { commit: s.head() })).json.code).toBe("language.not_needed");
    expect((await s.call("POST", { commit: "nope" })).status).toBe(400);
  });

  it("explains a file it cannot migrate and changes nothing", async () => {
    const s = await siteWith("site:\n  language: en\n  defaultLanguage: de\n");
    const shown = await s.call("GET");
    expect(shown.json).toMatchObject({ state: "blocked", reason: "default_not_listed", patch: null });
    expect((await s.call("POST", { commit: s.head() })).json.code).toBe("language.not_needed");
  });
});
