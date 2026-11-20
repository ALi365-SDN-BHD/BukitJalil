import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DeployStatusResponse, PublishAccount } from "@bukitjalil/shared";
import { afterAll, describe, expect, it } from "vitest";
import { pagesSiteAddress } from "../src/deploys/target.ts";
import { FieldVault } from "../src/security/vault.ts";
import { ADMIN, makeApp, req } from "./helpers.ts";

// Saved GitHub publishing accounts and the deploy settings form. No request leaves the machine.

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bj-publish-")));
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

const call = (ctx: ReturnType<typeof makeApp>, method: string, p: string, body?: unknown) =>
  ctx.app.fetch(
    req(p, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: { "content-type": "application/json", "x-bukitjalil": "1", origin: ADMIN },
    }),
  );

const list = async (ctx: ReturnType<typeof makeApp>) =>
  (await (await call(ctx, "GET", "/api/publish-accounts")).json()) as PublishAccount[];

const identity = (ctx: ReturnType<typeof makeApp>) =>
  ctx.db
    .prepare("INSERT OR REPLACE INTO settings (key, value_json) VALUES ('commitName', ?), ('commitEmail', ?)")
    .run(JSON.stringify("Site Owner"), JSON.stringify("owner@example.com"));

describe("/api/publish-accounts", () => {
  it("adds, edits and removes named accounts without returning the token", async () => {
    const ctx = makeApp({ appHome: path.join(base, "app-accounts") });
    expect(await list(ctx)).toEqual([]);
    const createdRes = await call(ctx, "POST", "/api/publish-accounts", {
      platform: "github",
      name: "Company GitHub",
      token: "ghp_exampleexample1234",
    });
    expect(createdRes.status).toBe(200);
    const created = (await createdRes.json()) as PublishAccount;
    expect(created).toMatchObject({ name: "Company GitHub", platform: "github", hasToken: true, tokenLast4: "1234" });
    expect(created.id).toMatch(/^pub_[0-9a-f]{12}$/);
    expect(JSON.stringify(created)).not.toContain("ghp_example");
    expect(ctx.publishAccounts.token(created.id)).toBe("ghp_exampleexample1234");

    expect(
      (await call(ctx, "POST", "/api/publish-accounts", { platform: "github", name: "company github", token: "x" }))
        .status,
    ).toBe(409);
    const updated = (await (
      await call(ctx, "PUT", `/api/publish-accounts/${created.id}`, { platform: "github", name: "Personal GitHub" })
    ).json()) as PublishAccount;
    expect(updated).toMatchObject({ id: created.id, name: "Personal GitHub", hasToken: true });
    expect(ctx.publishAccounts.token(created.id)).toBe("ghp_exampleexample1234");

    const second = (await (
      await call(ctx, "POST", "/api/publish-accounts", {
        platform: "github",
        name: "Another GitHub",
        token: "ghp_anotherexample1234",
      })
    ).json()) as PublishAccount;
    expect((await list(ctx)).map((account) => account.name)).toEqual(["Personal GitHub", "Another GitHub"]);

    expect((await call(ctx, "DELETE", `/api/publish-accounts/${created.id}`)).status).toBe(204);
    expect((await call(ctx, "DELETE", `/api/publish-accounts/${second.id}`)).status).toBe(204);
    expect(await list(ctx)).toEqual([]);
    ctx.db.close();
  });

  it("keeps the token encrypted in its row, which another table or a new field key cannot read", () => {
    const ctx = makeApp({ appHome: path.join(base, "app-vault") });
    const account = ctx.publishAccounts.create({ platform: "github", name: "Kept", token: "ghp_kept123456" });
    const sealed = (
      ctx.db.prepare("SELECT token_ciphertext AS c FROM publish_accounts WHERE id = ?").get(account.id) as {
        c: string;
      }
    ).c;
    expect(sealed).not.toContain("ghp_kept");

    // The same ciphertext in another table's row of the same id is refused.
    ctx.db
      .prepare(
        "INSERT INTO data_sources (id, name, platform, config_json, created_at, token_ciphertext) VALUES (?, 'X', 'notion', '{}', '', ?)",
      )
      .run(account.id, sealed);
    expect(() => ctx.dataSources.token(account.id)).toThrow("storage.unreadable");

    // Another field key cannot open it; the row goes with the account.
    ctx.db.prepare("UPDATE vault_keys SET key = randomblob(32)").run();
    expect(() => new FieldVault(ctx.db).open(sealed, "publish_accounts", account.id)).toThrow("storage.unreadable");
    ctx.db.prepare("DELETE FROM data_sources").run();
    ctx.publishAccounts.remove(account.id);
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM publish_accounts").get()).toEqual({ n: 0 });
    ctx.db.close();
  });

  it("checks repository write access with the saved token", async () => {
    let status = 200;
    let push = true;
    const seen: string[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      seen.push(`${String(init?.headers ? (init.headers as Record<string, string>).Authorization : "")} ${url}`);
      return new Response(JSON.stringify({ permissions: { push } }), {
        status,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    const ctx = makeApp({ appHome: path.join(base, "app-access"), publishFetch: fetchImpl });
    const account = ctx.publishAccounts.create({
      platform: "github",
      name: "Access",
      token: "ghp_access1234",
    });

    await expect(ctx.publishAccounts.verifyRepo(account.id, "someone/blog")).resolves.toBeUndefined();
    expect(seen[0]).toBe("Bearer ghp_access1234 https://api.github.com/repos/someone/blog");

    push = false;
    await expect(ctx.publishAccounts.verifyRepo(account.id, "someone/blog")).rejects.toMatchObject({
      code: "publish.repo_access",
    });
    push = true;
    status = 404;
    await expect(ctx.publishAccounts.verifyRepo(account.id, "someone/blog")).rejects.toMatchObject({
      code: "publish.repo_access",
    });
    status = 500;
    await expect(ctx.publishAccounts.verifyRepo(account.id, "someone/blog")).rejects.toMatchObject({
      code: "publish.github_failed",
    });
    ctx.db.close();
  });

  it("cannot delete an account a site is using", async () => {
    const ctx = makeApp({ appHome: path.join(base, "app-in-use") });
    identity(ctx);
    const account = ctx.publishAccounts.create({ platform: "github", name: "Used", token: "ghp_used1234" });
    const site = await ctx.sites.create({
      name: "Site",
      path: path.join(base, "site-used"),
      language: "en-US",
    });
    await ctx.builds.settled();
    ctx.sites.setPublishAccountId(site.id, account.id);
    const res = await call(ctx, "DELETE", `/api/publish-accounts/${account.id}`);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "publish.in_use", params: { count: "1" } });
    ctx.db.close();
  });
});

describe("PUT /api/sites/:id/deploy", () => {
  it("writes the account and target into site.yaml and sets the site address", async () => {
    const ctx = makeApp({ appHome: path.join(base, "app-config") });
    identity(ctx);
    const account = ctx.publishAccounts.create({ platform: "github", name: "Deploy", token: "ghp_deploy1234" });
    const dir = path.join(base, "site-config");
    const site = await ctx.sites.create({ name: "Config", path: dir, language: "en-US" });
    await ctx.builds.settled();
    const res = await call(ctx, "PUT", `/api/sites/${site.id}/deploy`, {
      accountId: account.id,
      repo: "someone/blog",
      branch: "gh-pages",
      cname: "www.example.com",
    });
    expect(res.status).toBe(200);
    const status = (await res.json()) as DeployStatusResponse;
    expect(status).toMatchObject({
      target: { repo: "someone/blog", branch: "gh-pages", cname: "www.example.com", problem: null },
      account: { id: account.id, name: "Deploy", hasToken: true },
      ready: true,
    });
    expect(status.target.url).toBe("https://www.example.com/");

    const yaml = fs.readFileSync(path.join(dir, "site.yaml"), "utf8");
    expect(yaml).toContain("provider: github-pages");
    expect(yaml).toContain("repo: someone/blog");
    expect(yaml).toContain("branch: gh-pages");
    expect(yaml).toContain("cname: www.example.com");
    expect(yaml).toContain("url: https://www.example.com");
    expect(yaml).toContain("baseUrl: /");
    // The commit was applied to the user's default branch, not left in the app's checkout.
    expect(fs.existsSync(path.join(dir, ".bukitjalil-deploy"))).toBe(false);
    ctx.db.close();
  });

  it("refuses a token that cannot push to the repository", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ permissions: { push: false } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    const ctx = makeApp({ appHome: path.join(base, "app-denied"), publishFetch: fetchImpl });
    identity(ctx);
    const account = ctx.publishAccounts.create({ platform: "github", name: "Denied", token: "ghp_denied1234" });
    const dir = path.join(base, "site-denied");
    const site = await ctx.sites.create({ name: "Denied", path: dir, language: "en-US" });
    await ctx.builds.settled();
    const res = await call(ctx, "PUT", `/api/sites/${site.id}/deploy`, {
      accountId: account.id,
      repo: "someone/blog",
      branch: "gh-pages",
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "publish.repo_access" });
    expect(fs.readFileSync(path.join(dir, "site.yaml"), "utf8")).not.toContain("deploy:");
    ctx.db.close();
  });

  it("refuses a dirty checkout and a config that cannot be written", async () => {
    const ctx = makeApp({ appHome: path.join(base, "app-dirty") });
    identity(ctx);
    const account = ctx.publishAccounts.create({ platform: "github", name: "Dirty", token: "ghp_dirty1234" });
    const dir = path.join(base, "site-dirty");
    const site = await ctx.sites.create({ name: "Dirty", path: dir, language: "en-US" });
    await ctx.builds.settled();

    const bad = await call(ctx, "PUT", `/api/sites/${site.id}/deploy`, {
      accountId: account.id,
      repo: "not a repo",
      branch: "gh-pages",
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: "deploy.config_invalid" });

    fs.appendFileSync(path.join(dir, "site.yaml"), "\n# local change\n");
    const dirty = await call(ctx, "PUT", `/api/sites/${site.id}/deploy`, {
      accountId: account.id,
      repo: "someone/blog",
      branch: "gh-pages",
    });
    expect(dirty.status).toBe(409);
    expect(await dirty.json()).toMatchObject({ code: "deploy.config_dirty" });
    ctx.db.close();
  });
});

describe("pagesSiteAddress", () => {
  it("gives a base path only for project sites", () => {
    expect(pagesSiteAddress("someone/blog", null)).toEqual({
      url: "https://someone.github.io/blog",
      baseUrl: "/blog/",
    });
    expect(pagesSiteAddress("someone/someone.github.io", null)).toEqual({
      url: "https://someone.github.io",
      baseUrl: "/",
    });
    expect(pagesSiteAddress("someone/blog", "www.example.com")).toEqual({
      url: "https://www.example.com",
      baseUrl: "/",
    });
  });
});
