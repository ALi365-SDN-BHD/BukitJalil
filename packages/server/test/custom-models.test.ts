import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CustomModelProvider, CustomModelsResponse, ModelsResponse } from "@bukitjalil/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { preparePiEnvironment } from "../src/agent/env.ts";
import { ADMIN, makeApp, req } from "./helpers.ts";

// Local and self-hosted OpenAI-compatible models (Ollama, LM Studio, vLLM, llama.cpp). Nothing connects
// to a local server here; the tests check the stored config and Pi's registered catalog.

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bj-custom-models-")));
let ctx: ReturnType<typeof makeApp>;
beforeAll(() => {
  ctx = makeApp({ appHome: path.join(base, "app") });
  preparePiEnvironment(ctx.paths.pi);
});
afterAll(() => {
  ctx.db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

const call = (ctx: ReturnType<typeof makeApp>, method: string, p: string, body?: unknown) =>
  ctx.app.fetch(
    req(p, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: { "content-type": "application/json", "x-bukitjalil": "1", origin: ADMIN },
    }),
  );

const request = {
  name: "Ollama",
  baseUrl: "http://127.0.0.1:11434/v1",
  api: "openai-completions" as const,
  modelId: "llama3.1:8b",
  modelName: "Llama Local",
  contextWindow: 32_768,
  maxTokens: 4_096,
  reasoning: false,
};

describe("/api/custom-models", () => {
  it("creates, lists, updates and removes a local model", async () => {
    const createdRes = await call(ctx, "POST", "/api/custom-models", request);
    expect(createdRes.status).toBe(200);
    const created = (await createdRes.json()) as CustomModelProvider;
    expect(created).toMatchObject({
      name: "Ollama",
      baseUrl: "http://127.0.0.1:11434/v1",
      api: "openai-completions",
      hasApiKey: false,
      model: { id: "llama3.1:8b", name: "Llama Local", contextWindow: 32_768, maxTokens: 4_096 },
    });
    expect(created.id).toMatch(/^local-ollama-llama3-1-8b/);
    expect(fs.existsSync(path.join(ctx.paths.pi, "custom-models.json"))).toBe(false);

    const list = (await (await call(ctx, "GET", "/api/custom-models")).json()) as CustomModelsResponse;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: created.id, hasApiKey: false });

    const models = (await (await call(ctx, "GET", "/api/models")).json()) as ModelsResponse;
    const custom = models.providers.find((provider) => provider.id === created.id);
    expect(custom).toMatchObject({
      custom: true,
      oauth: null,
      models: [{ id: "llama3.1:8b", name: "Llama Local" }],
    });
    expect(custom?.auth.configured).toBe(true);

    const updatedRes = await call(ctx, "PUT", `/api/custom-models/${created.id}`, {
      ...request,
      name: "Ollama Qwen",
      api: "anthropic-messages",
      modelId: "qwen2.5:7b",
      modelName: "Qwen Local",
      contextWindow: 65_536,
      reasoning: true,
    });
    expect(updatedRes.status).toBe(200);
    const updated = (await updatedRes.json()) as CustomModelProvider;
    expect(updated).toMatchObject({
      id: created.id,
      name: "Ollama Qwen",
      api: "anthropic-messages",
      model: { id: "qwen2.5:7b", name: "Qwen Local", contextWindow: 65_536, reasoning: true },
    });

    const afterUpdate = (await (await call(ctx, "GET", "/api/models")).json()) as ModelsResponse;
    const changed = afterUpdate.providers.find((provider) => provider.id === created.id);
    expect(changed?.models.map((model) => model.id)).toEqual(["qwen2.5:7b"]);

    expect((await call(ctx, "DELETE", `/api/custom-models/${created.id}`)).status).toBe(204);
    expect((await (await call(ctx, "GET", "/api/custom-models")).json()) as CustomModelsResponse).toEqual([]);
    const afterDelete = (await (await call(ctx, "GET", "/api/models")).json()) as ModelsResponse;
    expect(afterDelete.providers.find((provider) => provider.id === created.id)).toBeUndefined();
  });

  it("keeps a stored key when the edit leaves the key empty, and removes it when cleared", async () => {
    const created = (await (
      await call(ctx, "POST", "/api/custom-models", { ...request, apiKey: "local-secret" })
    ).json()) as CustomModelProvider;
    expect(created.hasApiKey).toBe(true);
    const sealed = () =>
      (
        ctx.db.prepare("SELECT api_key_ciphertext AS c FROM custom_models WHERE id = ?").get(created.id) as {
          c: string | null;
        }
      ).c;
    expect(sealed()).not.toContain("local-secret");
    expect(ctx.customModels.get(created.id).apiKey).toBe("local-secret");

    const kept = (await (
      await call(ctx, "PUT", `/api/custom-models/${created.id}`, { ...request, modelId: "llama3.2:3b" })
    ).json()) as CustomModelProvider;
    expect(kept.hasApiKey).toBe(true);
    expect(ctx.customModels.get(created.id).apiKey).toBe("local-secret");

    const cleared = (await (
      await call(ctx, "PUT", `/api/custom-models/${created.id}`, { ...request, apiKey: "" })
    ).json()) as CustomModelProvider;
    expect(cleared.hasApiKey).toBe(false);
    expect(sealed()).toBeNull();
  });

  it("does not save the edit when registering the edited provider fails", async () => {
    const created = (await (await call(ctx, "POST", "/api/custom-models", request)).json()) as CustomModelProvider;
    const before = ctx.customModels.get(created.id);
    expect(() =>
      ctx.customModels.update(created.id, { ...request, name: "Rejected" }, () => {
        throw new Error("register failed");
      }),
    ).toThrow("register failed");
    expect(ctx.customModels.get(created.id)).toEqual(before);
  });

  it("reports a malformed row instead of guessing", () => {
    const broken = makeApp({ appHome: path.join(base, "app-broken-entry") });
    broken.db
      .prepare(
        "INSERT INTO custom_models (id, name, base_url, api, model_json, created_at) VALUES ('broken', 'B', 'http://x', 'openai-completions', '{}', '')",
      )
      .run();

    expect(() => broken.customModels.list()).toThrow("storage.unreadable");
    expect(() => broken.customModels.create(request)).toThrow("storage.unreadable");
    broken.db.close();
  });

  it("rejects a non-http URL or an over-long URL", async () => {
    const nonHttp = await call(ctx, "POST", "/api/custom-models", { ...request, baseUrl: "file:///etc/passwd" });
    expect(nonHttp.status).toBe(400);
    const tooLong = await call(ctx, "POST", "/api/custom-models", {
      ...request,
      baseUrl: `https://example.com/${"a".repeat(2048)}`,
    });
    expect(tooLong.status).toBe(400);
  });
});
