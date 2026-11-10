import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ModelsResponse, ProviderKey, ProviderTestResult, ServerEvent, SessionDetail } from "@bukitjalil/shared";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { preparePiEnvironment } from "../src/agent/env.ts";
import { redact, settingsModel } from "../src/agent/models.ts";
import { loadPi, type PiModules } from "../src/agent/pi.ts";
import { copyStarter } from "../src/sites/template.ts";
import { SettingsStore } from "../src/store/settings.ts";
import { ADMIN, commitAllAs, makeApp, rawGit, req } from "./helpers.ts";

// M3 layer 7 (plan 6.5, 9.1): model settings. No request leaves the machine: connection tests and runs
// use Pi's faux provider; keys are saved for real providers but never used.

const STARTER = path.resolve(import.meta.dirname, "../../../templates/starter");
// Providers whose environment variables this file sets or clears.
const ENV_KEYS = ["CEREBRAS_API_KEY", "GROQ_API_KEY"];

let base: string;
let ctx: ReturnType<typeof makeApp>;
let pi: PiModules;
let faux: ReturnType<PiModules["ai"]["fauxProvider"]>;
const savedEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bj-models-")));
  fs.mkdirSync(path.join(base, "home"));
  let settings: SettingsStore | null = null;
  ctx = makeApp({
    userHome: path.join(base, "home"),
    appHome: path.join(base, "app"),
    agent: {
      // As in main.ts: the model chosen in the settings, looked up before every run.
      resolveModel: (runtime) => settingsModel(settings as SettingsStore)(runtime),
      thinkingLevel: () => (settings as SettingsStore).get().thinkingLevel,
      setupRuntime: (runtime) => runtime.registerNativeProvider(faux.provider),
    },
    modelTestTimeoutMs: 300,
  });
  settings = new SettingsStore(ctx.db);
  preparePiEnvironment(ctx.paths.pi);
  pi = await loadPi(ctx.paths.pi);
  faux = pi.ai.fauxProvider({
    provider: "faux",
    models: [
      { id: "faux-1", name: "Faux 1", reasoning: true },
      { id: "faux-2", name: "Faux 2" },
    ],
  });
});
afterEach(async () => {
  for (const k of ENV_KEYS) delete process.env[k];
  await call("PUT", "/api/settings", { model: null, thinkingLevel: "medium" });
});
afterAll(async () => {
  await ctx.agent.shutdown();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  fs.rmSync(base, { recursive: true, force: true });
});

const headers = { origin: ADMIN, "x-bukitjalil": "1", "content-type": "application/json" };
const call = (method: string, url: string, body?: unknown) =>
  ctx.app.fetch(req(url, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
const get = (url: string) => ctx.app.fetch(req(url));
const models = async () => (await (await get("/api/models")).json()) as ModelsResponse;
const provider = async (id: string) => (await models()).providers.find((p) => p.id === id);

describe("model catalog and keys", () => {
  it("lists Pi's providers with their models and key state, never a key", async () => {
    const list = await models();
    expect(list).toMatchObject({ selected: null, selectedMissing: false, thinkingLevel: "medium" });
    const anthropic = list.providers.find((p) => p.id === "anthropic");
    expect(anthropic?.models.length).toBeGreaterThan(0);
    expect(anthropic?.models[0]).toEqual({
      id: expect.any(String),
      name: expect.any(String),
      reasoning: expect.any(Boolean),
      contextWindow: expect.any(Number),
    });
    expect(list.providers.find((p) => p.id === "cerebras")).toMatchObject({
      keyEditable: true,
      envKey: true,
      key: { configured: false, source: null, last4: null, label: null },
    });
    // Needs a choice of method and more than one value: not set up here.
    expect(list.providers.find((p) => p.id === "amazon-bedrock")?.keyEditable).toBe(false);
    // Sign-in only: no key here or in the environment, so the UI leaves it out.
    expect(list.providers.find((p) => p.id === "openai-codex")).toMatchObject({ keyEditable: false, envKey: false });
    // The faux provider needs no key; also after Pi's availability check has seen it.
    await new Promise((r) => setTimeout(r, 200));
    expect((await provider("faux"))?.key).toMatchObject({ configured: true, source: "other", label: null });
    expect(list.providers.find((p) => p.id === "faux")).toMatchObject({
      keyEditable: false,
      key: { configured: true, source: "other" },
    });
    // A provider without models is left out.
    expect(list.providers.every((p) => p.models.length > 0)).toBe(true);
  });

  it("saves a key in Pi's auth.json, shows only its last four characters, and removes it", async () => {
    const secret = "csk-test-secret-value-9f3a";
    const res = await call("PUT", "/api/providers/cerebras/key", { apiKey: `  ${secret}  ` });
    expect(res.status).toBe(200);
    expect((await res.json()) as ProviderKey).toEqual({
      configured: true,
      source: "stored",
      last4: "9f3a",
      label: null,
    });

    const auth = path.join(ctx.paths.pi, "auth.json");
    expect(JSON.parse(fs.readFileSync(auth, "utf8")).cerebras).toEqual({ type: "api_key", key: secret });
    expect(fs.statSync(auth).mode & 0o777).toBe(0o600);
    const listed = await (await get("/api/models")).text();
    expect(listed).not.toContain(secret);
    expect((await provider("cerebras"))?.key).toMatchObject({ source: "stored", last4: "9f3a" });

    const removed = await call("DELETE", "/api/providers/cerebras/key");
    expect(((await removed.json()) as ProviderKey).configured).toBe(false);
    expect(JSON.parse(fs.readFileSync(auth, "utf8")).cerebras).toBeUndefined();
  });

  it("refuses keys it cannot save: several values needed, unknown provider, bad key", async () => {
    const bedrock = await call("PUT", "/api/providers/amazon-bedrock/key", { apiKey: "abcdefghijkl" });
    expect(bedrock.status).toBe(400);
    expect(await bedrock.json()).toEqual({ code: "model.key_unsupported" });
    const unknown = await call("PUT", "/api/providers/nope/key", { apiKey: "abcdefghijkl" });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ code: "model.provider_not_found" });
    for (const apiKey of ["", "two words", "line\nbreak"]) {
      expect((await call("PUT", "/api/providers/cerebras/key", { apiKey })).status).toBe(400);
    }
  });

  it("shows a key from the environment by its variable and does not let the UI change it", async () => {
    process.env.GROQ_API_KEY = "gsk_from_the_environment_1234";
    expect((await provider("groq"))?.key).toEqual({
      configured: true,
      source: "environment",
      last4: null,
      label: "GROQ_API_KEY",
    });
    const put = await call("PUT", "/api/providers/groq/key", { apiKey: "gsk_other_value_5678" });
    expect(put.status).toBe(409);
    expect(await put.json()).toEqual({ code: "model.key_from_environment" });
    expect((await call("DELETE", "/api/providers/groq/key")).status).toBe(409);
    expect(
      fs.existsSync(path.join(ctx.paths.pi, "auth.json"))
        ? fs.readFileSync(path.join(ctx.paths.pi, "auth.json"), "utf8")
        : "",
    ).not.toContain("gsk_");
  });
});

describe("connection test", () => {
  it("asks the model once and reports how it went", async () => {
    faux.setResponses([pi.ai.fauxAssistantMessage("OK")]);
    const res = await call("POST", "/api/providers/faux/test", { model: "faux-2" });
    expect(res.status).toBe(200);
    const result = (await res.json()) as ProviderTestResult;
    expect(result).toMatchObject({ ok: true, model: "faux-2", timedOut: false, error: null });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(faux.getPendingResponseCount()).toBe(0);

    faux.setResponses([pi.ai.fauxAssistantMessage("", { stopReason: "error", errorMessage: "401 invalid x-api-key" })]);
    const failed = (await (await call("POST", "/api/providers/faux/test", {})).json()) as ProviderTestResult;
    expect(failed).toMatchObject({ ok: false, model: "faux-1", error: "401 invalid x-api-key" });
  });

  it("uses the chosen model of the provider, and gives up after the timeout", async () => {
    await call("PUT", "/api/settings", { model: { provider: "faux", id: "faux-2" } });
    faux.setResponses([() => new Promise(() => {})]);
    const slow = (await (await call("POST", "/api/providers/faux/test", {})).json()) as ProviderTestResult;
    // The UI words the timeout itself, so no English text comes with it.
    expect(slow).toMatchObject({ ok: false, model: "faux-2", timedOut: true, error: null });
  });

  it("refuses a provider without a key, an unknown model or provider", async () => {
    const noKey = await call("POST", "/api/providers/cerebras/test", {});
    expect(noKey.status).toBe(409);
    expect(await noKey.json()).toEqual({ code: "model.no_key" });
    expect((await call("POST", "/api/providers/faux/test", { model: "nope" })).status).toBe(404);
    expect((await call("POST", "/api/providers/nope/test", {})).status).toBe(404);
  });

  it("keeps keys out of error messages", () => {
    expect(redact("bad key sk-secret-123456 for sk-secret-123456", ["sk-secret-123456"])).toBe("bad key *** for ***");
    expect(redact("x".repeat(5000), []).length).toBe(2000);
  });
});

describe("the chosen model in conversations", () => {
  let siteCount = 0;
  async function session() {
    const dir = path.join(base, "home", `site${++siteCount}`);
    copyStarter(STARTER, dir, { title: `Site ${siteCount}`, language: "en-US" });
    rawGit(base, dir, "init", "-q", "-b", "main");
    commitAllAs(base, dir);
    const site = await ctx.sites.import({ path: dir });
    return ctx.agent.create(site.id).id;
  }
  const send = (id: string, text: string) => call("POST", `/api/sessions/${id}/messages`, { text });
  async function settle(id: string) {
    const events: ServerEvent[] = [];
    const end = Date.now() + 5000;
    while (ctx.agent.status(id) !== "idle") {
      if (Date.now() > end) throw new Error("run did not settle");
      await new Promise((r) => setTimeout(r, 10));
    }
    return events;
  }

  it("answers with the error for each missing piece, then runs with the chosen model", async () => {
    const id = await session();
    const noModel = await send(id, "hello");
    expect(noModel.status).toBe(409);
    expect(await noModel.json()).toEqual({ code: "agent.no_model" });

    await call("PUT", "/api/settings", { model: { provider: "faux", id: "gone" } });
    const missing = await send(id, "hello");
    expect(await missing.json()).toEqual({
      code: "agent.model_not_found",
      params: { provider: "faux", model: "gone" },
    });
    expect((await models()).selectedMissing).toBe(true);

    await call("PUT", "/api/settings", {
      model: { provider: "cerebras", id: (await provider("cerebras"))?.models[0]?.id },
    });
    const noKey = await send(id, "hello");
    expect(await noKey.json()).toEqual({ code: "agent.no_api_key", params: { provider: "cerebras" } });

    await call("PUT", "/api/settings", { model: { provider: "faux", id: "faux-1" }, thinkingLevel: "high" });
    faux.setResponses([pi.ai.fauxAssistantMessage("first")]);
    expect((await send(id, "hello")).status).toBe(202);
    await settle(id);

    // A change in the settings applies to the next message of a session that is still open.
    await call("PUT", "/api/settings", { model: { provider: "faux", id: "faux-2" } });
    faux.setResponses([pi.ai.fauxAssistantMessage("second")]);
    expect((await send(id, "again")).status).toBe(202);
    await settle(id);
    const detail = (await (await get(`/api/sessions/${id}`)).json()) as SessionDetail;
    const replies = detail.messages.map((m) => m.message).filter((m) => m.role === "assistant");
    expect(replies.map((m) => m.model)).toEqual(["faux-1", "faux-2"]);
  });
});
