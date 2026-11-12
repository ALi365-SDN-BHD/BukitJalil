import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import type { Logger } from "../src/log.ts";
import { copyStarter } from "../src/sites/template.ts";
import { cleanupLegacyTempFiles, migrateLegacyTokens } from "../src/store/legacy-tokens.ts";
import { commitAllAs, makeApp, rawGit } from "./helpers.ts";

const STARTER = path.resolve(import.meta.dirname, "../../../templates/starter");
let base: string;
let seq = 0;

beforeAll(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bj-legacy-tokens-")));
});
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

const fakeLogger = () => {
  const lines: string[] = [];
  const logger: Logger = {
    log(level, event, fields) {
      lines.push(`${level} ${event} ${JSON.stringify(fields ?? {})}`);
    },
  };
  return { logger, lines };
};

/** An app with one site that has a deploy target and a Notion source. */
async function appWithSite(name: string) {
  const { logger, lines } = fakeLogger();
  const home = path.join(base, `home-${name}`);
  fs.mkdirSync(home, { recursive: true });
  const ctx = makeApp({ appHome: path.join(base, `app-${name}`), userHome: home, logger });
  const dir = path.join(home, `site-${++seq}`);
  copyStarter(STARTER, dir, { title: "Legacy", language: "en-US" });
  const config = parse(fs.readFileSync(path.join(dir, "site.yaml"), "utf8")) as Record<string, unknown>;
  config.deploy = { provider: "github-pages", repo: "owner/repo", branch: "gh-pages" };
  const content = config.content as { sources: unknown[] };
  content.sources.push({
    type: "notion",
    name: "db",
    mode: "content",
    collection: "post",
    notion: { databaseId: "db_legacy" },
  });
  fs.writeFileSync(path.join(dir, "site.yaml"), stringify(config));
  rawGit(base, dir, "init", "-q", "-b", "main");
  commitAllAs(base, dir);
  const site = await ctx.sites.import({ path: dir });
  return { ctx, site, logger, lines };
}

const writeOld = (file: string, value: Record<string, string>) =>
  fs.writeFileSync(file, JSON.stringify(value), { mode: 0o600 });

const tokenEntries = (file: string) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {});

const importStates = (db: ReturnType<typeof makeApp>["db"]) =>
  db.prepare("SELECT kind, row_id, status FROM legacy_token_imports ORDER BY kind").all();

const expectUnreadable = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    expect(err).toMatchObject({ code: "storage.unreadable" });
    return;
  }
  throw new Error("expected storage.unreadable");
};

const migrate = (
  app: Awaited<ReturnType<typeof appWithSite>>,
  env?: { github?: string; notion?: string },
  hook?: () => void,
) =>
  migrateLegacyTokens({
    db: app.ctx.db,
    paths: app.ctx.paths,
    sites: app.ctx.sites,
    panels: app.ctx.panels,
    publishAccounts: app.ctx.publishAccounts,
    dataSources: app.ctx.dataSources,
    logger: app.logger,
    env,
    beforeCommit: hook,
  });

describe("legacy token migration", () => {
  it("imports once, links the sites, removes the old file and logs no tokens", async () => {
    const app = await appWithSite("links");
    writeOld(app.ctx.paths.secrets, {
      github: "ghp_legacy_github_123456",
      notion: "ntn_legacy_notion_123456",
    });

    const result = await migrate(app);
    expect(result).toMatchObject({ accounts: 1, sources: 1, linkedSites: 1 });

    const accounts = app.ctx.publishAccounts.list();
    const sources = app.ctx.dataSources.list();
    expect(accounts).toHaveLength(1);
    expect(sources).toHaveLength(1);
    expect(app.ctx.publishAccounts.token(accounts[0]?.id ?? "")).toBe("ghp_legacy_github_123456");
    expect(app.ctx.dataSources.token(sources[0]?.id ?? "")).toBe("ntn_legacy_notion_123456");
    expect(app.ctx.sites.publishAccountId(app.site.id)).toBe(accounts[0]?.id);
    expect(app.ctx.sites.notionDataSourceId(app.site.id)).toBe(sources[0]?.id);
    expect(fs.existsSync(app.ctx.paths.secrets)).toBe(false);
    expect(app.lines.join("\n")).not.toContain("ghp_legacy_github");
    expect(app.lines.join("\n")).not.toContain("ntn_legacy_notion");
    expect(importStates(app.ctx.db)).toEqual([
      { kind: "github", row_id: accounts[0]?.id, status: "imported" },
      { kind: "notion", row_id: sources[0]?.id, status: "imported" },
    ]);

    const again = await migrate(app);
    expect(again).toMatchObject({ accounts: 0, sources: 0, linkedSites: 0 });
    expect(app.ctx.publishAccounts.list()).toHaveLength(1);
    expect(app.ctx.dataSources.list()).toHaveLength(1);
    expect(importStates(app.ctx.db)).toHaveLength(2);
    app.ctx.db.close();
  });

  it("uses the environment token first when both sources have one", async () => {
    const app = await appWithSite("precedence");
    writeOld(app.ctx.paths.secrets, { github: "ghp_file_github_123456", notion: "ntn_file_notion_123456" });

    await migrate(app, { github: "ghp_env_github_123456", notion: "ntn_env_notion_123456" });
    const account = app.ctx.publishAccounts.list()[0];
    const source = app.ctx.dataSources.list()[0];
    expect(app.ctx.publishAccounts.token(account?.id ?? "")).toBe("ghp_env_github_123456");
    expect(app.ctx.dataSources.token(source?.id ?? "")).toBe("ntn_env_notion_123456");
    app.ctx.db.close();
  });

  it("retries sites skipped when the first run could not read them", async () => {
    const app = await appWithSite("retry-links");
    app.ctx.sites.store.setState(app.site.id, {
      readOnly: [{ code: "missing_site_yaml" }],
      checkedCommit: null,
      configCheck: null,
    });
    writeOld(app.ctx.paths.secrets, {
      github: "ghp_retry_link_github_123456",
      notion: "ntn_retry_link_notion_123456",
    });

    const first = await migrate(app);
    expect(first).toMatchObject({ accounts: 1, sources: 1, linkedSites: 0, skippedSites: 1 });
    expect(app.ctx.sites.publishAccountId(app.site.id)).toBeNull();
    expect(app.ctx.sites.notionDataSourceId(app.site.id)).toBeNull();
    const account = app.ctx.publishAccounts.list()[0];
    const source = app.ctx.dataSources.list()[0];
    expect(account).toBeDefined();
    expect(source).toBeDefined();
    app.ctx.publishAccounts.update(account?.id ?? "", { platform: "github", name: "Renamed GitHub" });
    app.ctx.dataSources.update(source?.id ?? "", { platform: "notion", name: "Renamed Notion" });

    // The site is readable again. A failed retry must keep the existing account/source tokens.
    app.ctx.sites.store.setState(app.site.id, { readOnly: null, checkedCommit: null, configCheck: null });
    await expect(
      migrate(app, undefined, () => {
        throw new Error("retry failure");
      }),
    ).rejects.toThrow("retry failure");
    expect(app.ctx.publishAccounts.token(account?.id ?? "")).toBe("ghp_retry_link_github_123456");
    expect(app.ctx.dataSources.token(source?.id ?? "")).toBe("ntn_retry_link_notion_123456");

    const second = await migrate(app);
    expect(second).toMatchObject({ accounts: 0, sources: 0, linkedSites: 1, skippedSites: 0 });
    expect(app.ctx.sites.publishAccountId(app.site.id)).toBe(account?.id);
    expect(app.ctx.sites.notionDataSourceId(app.site.id)).toBe(source?.id);
    expect(importStates(app.ctx.db)).toEqual([
      { kind: "github", row_id: account?.id, status: "imported" },
      { kind: "notion", row_id: source?.id, status: "imported" },
    ]);
    app.ctx.db.close();
  });

  it("keeps the old file when the transaction fails, then retries", async () => {
    const app = await appWithSite("failure");
    writeOld(app.ctx.paths.secrets, {
      github: "ghp_retry_github_123456",
      notion: "ntn_retry_notion_123456",
    });

    await expect(
      migrate(app, undefined, () => {
        throw new Error("simulated failure");
      }),
    ).rejects.toThrow("simulated failure");
    expect(fs.existsSync(app.ctx.paths.secrets)).toBe(true);
    expect(app.ctx.publishAccounts.list()).toEqual([]);
    expect(app.ctx.dataSources.list()).toEqual([]);
    expect(tokenEntries(app.ctx.paths.publishAccountTokens)).toEqual({});
    expect(tokenEntries(app.ctx.paths.dataSourceTokens)).toEqual({});
    expect(importStates(app.ctx.db)).toEqual([]);
    expect(app.ctx.sites.publishAccountId(app.site.id)).toBeNull();
    expect(app.ctx.sites.notionDataSourceId(app.site.id)).toBeNull();

    const result = await migrate(app);
    expect(result).toMatchObject({ accounts: 1, sources: 1, linkedSites: 1 });
    expect(fs.existsSync(app.ctx.paths.secrets)).toBe(false);
    expect(importStates(app.ctx.db)).toHaveLength(2);
    app.ctx.db.close();
  });

  it("does not overwrite existing accounts or sources", async () => {
    const app = await appWithSite("existing");
    const account = app.ctx.publishAccounts.create({
      platform: "github",
      name: "Existing",
      token: "ghp_existing_123456",
    });
    const source = app.ctx.dataSources.create({
      platform: "notion",
      name: "Existing Notion",
      token: "ntn_existing_123456",
    });
    writeOld(app.ctx.paths.secrets, {
      github: "ghp_should_not_import_123456",
      notion: "ntn_should_not_import_123456",
    });

    const result = await migrate(app);
    expect(result).toMatchObject({ accounts: 0, sources: 0 });
    expect(app.ctx.publishAccounts.list()).toHaveLength(1);
    expect(app.ctx.dataSources.list()).toHaveLength(1);
    expect(app.ctx.publishAccounts.token(account.id)).toBe("ghp_existing_123456");
    expect(app.ctx.dataSources.token(source.id)).toBe("ntn_existing_123456");
    // Both existing stores have a token, so the old file is safe to remove.
    expect(fs.existsSync(app.ctx.paths.secrets)).toBe(false);
    expect(importStates(app.ctx.db)).toEqual([
      { kind: "github", row_id: account.id, status: "adopted" },
      { kind: "notion", row_id: source.id, status: "adopted" },
    ]);
    app.ctx.db.close();
  });

  it("fills one existing tokenless row instead of creating a second", async () => {
    const app = await appWithSite("tokenless");
    const now = new Date().toISOString();
    app.ctx.db
      .prepare("INSERT INTO publish_accounts (id, name, platform, created_at) VALUES (?, ?, ?, ?)")
      .run("pub_tokenless", "Imported GitHub account", "github", now);
    app.ctx.db
      .prepare("INSERT INTO data_sources (id, name, platform, config_json, created_at) VALUES (?, ?, ?, ?, ?)")
      .run("ds_tokenless", "Imported Notion source", "notion", "{}", now);
    writeOld(app.ctx.paths.secrets, {
      github: "ghp_fill_github_123456",
      notion: "ntn_fill_notion_123456",
    });

    // A failed fill must leave the existing rows tokenless and the old file in place.
    await expect(
      migrate(app, undefined, () => {
        throw new Error("fill failure");
      }),
    ).rejects.toThrow("fill failure");
    expect(app.ctx.publishAccounts.token("pub_tokenless")).toBeNull();
    expect(app.ctx.dataSources.token("ds_tokenless")).toBeNull();
    expect(importStates(app.ctx.db)).toEqual([]);
    expect(fs.existsSync(app.ctx.paths.secrets)).toBe(true);

    const result = await migrate(app);
    expect(result).toMatchObject({ accounts: 0, sources: 0, linkedSites: 1 });
    expect(app.ctx.publishAccounts.list()).toHaveLength(1);
    expect(app.ctx.dataSources.list()).toHaveLength(1);
    expect(app.ctx.publishAccounts.token("pub_tokenless")).toBe("ghp_fill_github_123456");
    expect(app.ctx.dataSources.token("ds_tokenless")).toBe("ntn_fill_notion_123456");
    expect(app.ctx.sites.publishAccountId(app.site.id)).toBe("pub_tokenless");
    expect(app.ctx.sites.notionDataSourceId(app.site.id)).toBe("ds_tokenless");
    expect(importStates(app.ctx.db)).toEqual([
      { kind: "github", row_id: "pub_tokenless", status: "imported" },
      { kind: "notion", row_id: "ds_tokenless", status: "imported" },
    ]);
    expect(fs.existsSync(app.ctx.paths.secrets)).toBe(false);
    app.ctx.db.close();
  });

  it("backfills a single existing row before the state table existed", async () => {
    const app = await appWithSite("backfill");
    const account = app.ctx.publishAccounts.create({
      platform: "github",
      name: "Renamed GitHub",
      token: "ghp_backfill_123456",
    });
    const source = app.ctx.dataSources.create({
      platform: "notion",
      name: "Renamed Notion",
      token: "ntn_backfill_123456",
    });

    const result = await migrate(app);
    expect(result).toMatchObject({ accounts: 0, sources: 0, linkedSites: 1 });
    expect(app.ctx.sites.publishAccountId(app.site.id)).toBe(account.id);
    expect(app.ctx.sites.notionDataSourceId(app.site.id)).toBe(source.id);
    expect(importStates(app.ctx.db)).toEqual([
      { kind: "github", row_id: account.id, status: "adopted" },
      { kind: "notion", row_id: source.id, status: "adopted" },
    ]);
    app.ctx.db.close();
  });

  it("does not re-import an environment token after the imported row is deleted", async () => {
    const { logger } = fakeLogger();
    const ctx = makeApp({ appHome: path.join(base, "app-env-once"), logger });
    const run = () =>
      migrateLegacyTokens({
        db: ctx.db,
        paths: ctx.paths,
        sites: ctx.sites,
        panels: ctx.panels,
        publishAccounts: ctx.publishAccounts,
        dataSources: ctx.dataSources,
        logger,
        env: { github: "ghp_env_once_123456", notion: "ntn_env_once_123456" },
      });

    const first = await run();
    expect(first).toMatchObject({ accounts: 1, sources: 1 });
    const account = ctx.publishAccounts.list()[0];
    const source = ctx.dataSources.list()[0];
    expect(account).toBeDefined();
    expect(source).toBeDefined();

    ctx.publishAccounts.remove(account?.id ?? "");
    ctx.dataSources.remove(source?.id ?? "");
    expect(ctx.publishAccounts.list()).toEqual([]);
    expect(ctx.dataSources.list()).toEqual([]);

    const second = await run();
    expect(second).toMatchObject({ accounts: 0, sources: 0 });
    expect(ctx.publishAccounts.list()).toEqual([]);
    expect(ctx.dataSources.list()).toEqual([]);
    expect(importStates(ctx.db)).toHaveLength(2);
    ctx.db.close();
  });

  it("refuses to write over an unreadable token or custom-model file", async () => {
    const { logger } = fakeLogger();
    const ctx = makeApp({ appHome: path.join(base, "app-corrupt"), logger });
    const account = ctx.publishAccounts.create({
      platform: "github",
      name: "Before",
      token: "ghp_before_123456",
    });
    const source = ctx.dataSources.create({
      platform: "notion",
      name: "Before",
      token: "ntn_before_123456",
    });
    const custom = ctx.customModels.create({
      name: "Before",
      baseUrl: "http://127.0.0.1:11434/v1",
      api: "openai-completions",
      modelId: "before",
      modelName: "Before",
    });
    const broken = "{";
    fs.writeFileSync(ctx.paths.publishAccountTokens, broken);
    fs.writeFileSync(ctx.paths.dataSourceTokens, broken);
    fs.writeFileSync(path.join(ctx.paths.pi, "custom-models.json"), broken);

    // Edits and deletes must be refused before they touch the database.
    expectUnreadable(() => ctx.publishAccounts.update(account.id, { platform: "github", name: "After" }));
    expectUnreadable(() => ctx.publishAccounts.remove(account.id));
    expectUnreadable(() => ctx.dataSources.update(source.id, { platform: "notion", name: "After" }));
    expectUnreadable(() => ctx.dataSources.remove(source.id));
    expectUnreadable(() =>
      ctx.customModels.update(custom.id, {
        name: "After",
        baseUrl: "http://127.0.0.1:11434/v1",
        api: "openai-completions",
        modelId: "after",
        modelName: "After",
      }),
    );
    expectUnreadable(() => ctx.customModels.remove(custom.id));

    // Creates must not leave rows behind either.
    expectUnreadable(() =>
      ctx.publishAccounts.create({ platform: "github", name: "No", token: "ghp_should_not_write_123456" }),
    );
    expectUnreadable(() =>
      ctx.dataSources.create({ platform: "notion", name: "No", token: "ntn_should_not_write_123456" }),
    );
    expectUnreadable(() =>
      ctx.customModels.create({
        name: "No",
        baseUrl: "http://127.0.0.1:11434/v1",
        api: "openai-completions",
        modelId: "no",
        modelName: "No",
      }),
    );

    expect(ctx.db.prepare("SELECT name FROM publish_accounts WHERE id = ?").get(account.id)).toMatchObject({
      name: "Before",
    });
    expect(ctx.db.prepare("SELECT COUNT(*) AS count FROM publish_accounts").get()).toMatchObject({ count: 1 });
    expect(ctx.db.prepare("SELECT name FROM data_sources WHERE id = ?").get(source.id)).toMatchObject({
      name: "Before",
    });
    expect(ctx.db.prepare("SELECT COUNT(*) AS count FROM data_sources").get()).toMatchObject({ count: 1 });
    expect(fs.readFileSync(ctx.paths.publishAccountTokens, "utf8")).toBe(broken);
    expect(fs.readFileSync(ctx.paths.dataSourceTokens, "utf8")).toBe(broken);
    expect(fs.readFileSync(path.join(ctx.paths.pi, "custom-models.json"), "utf8")).toBe(broken);
    ctx.db.close();
  });

  it("does not log a token from a corrupt old file", async () => {
    const app = await appWithSite("bad-old");
    fs.writeFileSync(app.ctx.paths.secrets, '{"github":"ghp_secret_in_bad_file_123456"');
    const result = await migrate(app);
    expect(result.accounts).toBe(0);
    expect(app.lines.join("\n")).not.toContain("ghp_secret_in_bad_file");
    expect(fs.existsSync(app.ctx.paths.secrets)).toBe(true);
    app.ctx.db.close();
  });

  it("removes temp files left by the old secret store", () => {
    const dir = path.join(base, "legacy-temps");
    fs.mkdirSync(dir);
    const stale = path.join(dir, ".secrets-abcdef123456.tmp");
    const unrelated = path.join(dir, "other.tmp");
    fs.writeFileSync(stale, "{}");
    fs.writeFileSync(unrelated, "{}");

    expect(cleanupLegacyTempFiles(dir)).toBe(1);
    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(unrelated)).toBe(true);
  });

  it("writes token files with 0600 and leaves no temporary file", async () => {
    const { logger } = fakeLogger();
    const ctx = makeApp({ appHome: path.join(base, "app-mode"), logger });
    const account = ctx.publishAccounts.create({
      platform: "github",
      name: "Mode",
      token: "ghp_mode_1234567890",
    });
    expect(ctx.publishAccounts.token(account.id)).toBe("ghp_mode_1234567890");
    const tokenFile = ctx.paths.publishAccountTokens;
    expect(fs.statSync(tokenFile).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(path.dirname(tokenFile)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    ctx.db.close();
  });
});
