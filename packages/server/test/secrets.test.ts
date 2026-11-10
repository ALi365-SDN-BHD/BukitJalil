import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SecretsResponse } from "@bukitjalil/shared";
import { afterAll, describe, expect, it } from "vitest";
import { SecretStore } from "../src/settings/secrets.ts";
import { ADMIN, makeApp, req } from "./helpers.ts";

// M6 layer 1 (plan 6.5): the GitHub token for publishing. Environment first, else secrets.json (0600);
// the variables leave the environment once read, and only the source and last four ever leave the server.

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bj-secrets-")));
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));
const TOKEN = "ghp_exampleexampleexample1234";

const send = (ctx: ReturnType<typeof makeApp>, method: string, p: string, body?: unknown) =>
  ctx.app.fetch(
    req(p, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: { "content-type": "application/json", "x-bukitjalil": "1", origin: ADMIN },
    }),
  );

describe("SecretStore", () => {
  it("takes the variables out of the environment and prefers them", () => {
    const env: NodeJS.ProcessEnv = { BUKITJALIL_GITHUB_TOKEN: ` ${TOKEN} `, BUKITJALIL_NOTION_TOKEN: "ntn", KEEP: "1" };
    const file = path.join(base, "env.json");
    const store = new SecretStore(file, env);
    expect(env).toEqual({ KEEP: "1" });
    expect(store.get("github")).toBe(TOKEN);
    expect(store.get("notion")).toBe("ntn");
    expect(store.status().github).toEqual({
      configured: true,
      source: "environment",
      last4: null,
      label: "BUKITJALIL_GITHUB_TOKEN",
    });
    expect(() => store.set("github", "other")).toThrow(expect.objectContaining({ code: "secret.from_environment" }));
    expect(() => store.remove("github")).toThrow(expect.objectContaining({ code: "secret.from_environment" }));
    expect(fs.existsSync(file)).toBe(false);
    // An empty variable counts as not set, and is still removed.
    const empty: NodeJS.ProcessEnv = { BUKITJALIL_GITHUB_TOKEN: "  " };
    expect(new SecretStore(path.join(base, "empty.json"), empty).get("github")).toBeNull();
    expect(empty).toEqual({});
  });

  it("stores a token in a 0600 file, replaced whole, and removes it", () => {
    const file = path.join(base, "stored.json");
    const store = new SecretStore(file, {});
    expect(store.status().github).toMatchObject({ configured: false, source: null });
    expect(store.set("github", TOKEN).github).toMatchObject({ configured: true, source: "stored", last4: "1234" });
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ github: TOKEN });
    expect(new SecretStore(file, {}).get("github")).toBe(TOKEN);
    // No temporary file is left next to it.
    expect(fs.readdirSync(base).filter((n) => n.endsWith(".tmp"))).toEqual([]);
    expect(store.remove("github").github.configured).toBe(false);
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({});
    expect(store.set("github", "abcd1234").github).toMatchObject({ configured: true, last4: null });
    expect(() => store.set("notion", "x")).toThrow(expect.objectContaining({ code: "secret.not_found" }));
  });

  it("ignores a linked, broken or oversized file", () => {
    const target = path.join(base, "target.json");
    fs.writeFileSync(target, JSON.stringify({ github: TOKEN }));
    const link = path.join(base, "link.json");
    fs.symlinkSync(target, link);
    expect(new SecretStore(link, {}).get("github")).toBeNull();
    const broken = path.join(base, "broken.json");
    fs.writeFileSync(broken, "{");
    expect(new SecretStore(broken, {}).get("github")).toBeNull();
    const big = path.join(base, "big.json");
    fs.writeFileSync(big, JSON.stringify({ github: TOKEN, pad: "x".repeat(70_000) }));
    expect(new SecretStore(big, {}).get("github")).toBeNull();
    // Saving over the link replaces the link itself; the file it pointed to stays as it was.
    new SecretStore(link, {}).set("github", "new-token");
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(false);
    expect(JSON.parse(fs.readFileSync(target, "utf8"))).toEqual({ github: TOKEN });
  });
});

describe("/api/secrets", () => {
  it("never returns the token", async () => {
    const ctx = makeApp({ appHome: path.join(base, "app") });
    const empty = (await (await ctx.app.fetch(req("/api/secrets"))).json()) as SecretsResponse;
    expect(empty.github).toMatchObject({ configured: false });

    expect((await send(ctx, "PUT", "/api/secrets/github", { value: "has space" })).status).toBe(400);
    expect((await send(ctx, "PUT", "/api/secrets/other", { value: TOKEN })).status).toBe(404);
    const saved = await send(ctx, "PUT", "/api/secrets/github", { value: `  ${TOKEN}\n` });
    const text = await saved.text();
    expect(saved.status).toBe(200);
    expect(text).not.toContain(TOKEN.slice(0, 8));
    expect(JSON.parse(text).github).toMatchObject({ source: "stored", last4: "1234" });
    expect(ctx.secrets.get("github")).toBe(TOKEN);
    expect(fs.statSync(ctx.paths.secrets).mode & 0o777).toBe(0o600);

    const removed = (await (await send(ctx, "DELETE", "/api/secrets/github")).json()) as SecretsResponse;
    expect(removed.github.configured).toBe(false);
  });

  it("refuses to change a token from the environment", async () => {
    const ctx = makeApp({ appHome: path.join(base, "app-env"), secretEnv: { BUKITJALIL_GITHUB_TOKEN: TOKEN } });
    const res = await send(ctx, "PUT", "/api/secrets/github", { value: "x1234" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "secret.from_environment" });
    expect((await send(ctx, "DELETE", "/api/secrets/github")).status).toBe(409);
  });
});
