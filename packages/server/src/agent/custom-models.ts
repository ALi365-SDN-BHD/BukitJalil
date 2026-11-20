import type { CustomModelProvider, CustomModelRequest, CustomModelsResponse } from "@bukitjalil/shared";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { isRecord } from "../bukit/guard.ts";
import type { FieldVault } from "../security/vault.ts";
import { SiteError } from "../sites/location.ts";
import type { Db } from "../store/db.ts";

/** What is stored; the response type hides the key. */
export interface StoredProvider {
  id: string;
  name: string;
  baseUrl: string;
  api: CustomModelProvider["api"];
  apiKey: string | null;
  model: CustomModelProvider["model"];
}

const DEFAULT_CONTEXT = 32_768;
const DEFAULT_MAX_TOKENS = 4_096;
const TABLE = "custom_models";

interface Row {
  id: string;
  name: string;
  base_url: string;
  api: string;
  model_json: string;
  api_key_ciphertext: string | null;
}

/**
 * Local and self-hosted OpenAI-compatible models (Ollama, LM Studio, vLLM, llama.cpp, ...). One row per
 * provider in `custom_models`, the key encrypted with the field key (plan 6.9); registered into Pi's
 * runtime on startup and after every change. A local server usually needs no key; a dummy one lets Pi's
 * auth layer make requests.
 */
export class CustomModelStore {
  constructor(private readonly opts: { db: Db; vault: FieldVault }) {}

  list(): CustomModelsResponse {
    return this.read().map(view);
  }

  ids(): Set<string> {
    return new Set(this.read().map((provider) => provider.id));
  }

  get(id: string): StoredProvider {
    const provider = this.read().find((entry) => entry.id === id);
    if (!provider) throw new SiteError("custom.not_found", 404);
    return provider;
  }

  create(req: CustomModelRequest): CustomModelProvider {
    const providers = this.read();
    const provider: StoredProvider = {
      id: uniqueId(providers, req),
      name: req.name,
      baseUrl: req.baseUrl,
      api: req.api,
      apiKey: req.apiKey?.trim() || null,
      model: modelOf(req),
    };
    this.opts.db
      .prepare(
        "INSERT INTO custom_models (id, name, base_url, api, model_json, api_key_ciphertext, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(...this.columns(provider), new Date().toISOString());
    return view(provider);
  }

  update(id: string, req: CustomModelRequest, beforeWrite?: (provider: StoredProvider) => void): CustomModelProvider {
    const previous = this.get(id);
    const provider: StoredProvider = {
      ...previous,
      name: req.name,
      baseUrl: req.baseUrl,
      api: req.api,
      // An omitted key keeps the stored one; an empty field removes it.
      apiKey: req.apiKey === undefined ? previous.apiKey : req.apiKey.trim() || null,
      model: modelOf(req),
    };
    // Register first: if the runtime rejects the provider, the old row stays as it was.
    beforeWrite?.(provider);
    const [, ...rest] = this.columns(provider);
    this.opts.db
      .prepare(
        "UPDATE custom_models SET name = ?, base_url = ?, api = ?, model_json = ?, api_key_ciphertext = ? WHERE id = ?",
      )
      .run(...rest, id);
    return view(provider);
  }

  remove(id: string): void {
    const { changes } = this.opts.db.prepare("DELETE FROM custom_models WHERE id = ?").run(id);
    if (changes === 0) throw new SiteError("custom.not_found", 404);
  }

  registerAll(runtime: ModelRuntime): void {
    try {
      for (const provider of this.read()) {
        try {
          this.register(runtime, provider);
        } catch {
          // A broken hand-edited entry must not stop the app from starting.
        }
      }
    } catch {
      // An unreadable row is reported when the settings page asks for it; startup still works.
    }
  }

  register(runtime: ModelRuntime, provider: StoredProvider): void {
    runtime.registerProvider(provider.id, {
      name: provider.name,
      baseUrl: provider.baseUrl,
      api: provider.api,
      apiKey: provider.apiKey ?? "local",
      models: [
        {
          id: provider.model.id,
          name: provider.model.name,
          api: provider.api,
          reasoning: provider.model.reasoning,
          input: ["text"],
          contextWindow: provider.model.contextWindow,
          maxTokens: provider.model.maxTokens,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        },
      ],
    });
  }

  private columns(provider: StoredProvider): [string, string, string, string, string, string | null] {
    return [
      provider.id,
      provider.name,
      provider.baseUrl,
      provider.api,
      JSON.stringify(provider.model),
      provider.apiKey === null ? null : this.opts.vault.seal(provider.apiKey, TABLE, provider.id),
    ];
  }

  private read(): StoredProvider[] {
    const rows = this.opts.db.prepare("SELECT * FROM custom_models ORDER BY rowid").all() as Row[];
    return rows.map((row) => {
      let model: unknown;
      try {
        model = JSON.parse(row.model_json);
      } catch {
        throw new SiteError("storage.unreadable", 500);
      }
      if (
        (row.api !== "openai-completions" && row.api !== "openai-responses" && row.api !== "anthropic-messages") ||
        !isRecord(model) ||
        typeof model.id !== "string" ||
        model.id === "" ||
        typeof model.name !== "string" ||
        (model.reasoning !== undefined && typeof model.reasoning !== "boolean")
      ) {
        throw new SiteError("storage.unreadable", 500);
      }
      return {
        id: row.id,
        name: row.name,
        baseUrl: row.base_url,
        api: row.api,
        apiKey: row.api_key_ciphertext === null ? null : this.opts.vault.open(row.api_key_ciphertext, TABLE, row.id),
        model: {
          id: model.id,
          name: model.name,
          contextWindow: count(model.contextWindow, DEFAULT_CONTEXT),
          maxTokens: count(model.maxTokens, DEFAULT_MAX_TOKENS),
          reasoning: model.reasoning ?? false,
        },
      };
    });
  }
}

/** A positive integer from the stored model, or the default when the field is absent. */
function count(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new SiteError("storage.unreadable", 500);
  }
  return value;
}

function view(provider: StoredProvider): CustomModelProvider {
  return {
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    api: provider.api,
    hasApiKey: provider.apiKey !== null,
    model: provider.model,
  };
}

function modelOf(req: CustomModelRequest): CustomModelProvider["model"] {
  return {
    id: req.modelId,
    name: req.modelName,
    contextWindow: req.contextWindow ?? DEFAULT_CONTEXT,
    maxTokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
    reasoning: req.reasoning ?? false,
  };
}

function uniqueId(providers: StoredProvider[], req: CustomModelRequest): string {
  const base = `local-${slug(req.name)}-${slug(req.modelId)}`.slice(0, 56);
  let id = base;
  let suffix = 2;
  while (providers.some((provider) => provider.id === id)) id = `${base}-${suffix++}`;
  return id;
}

function slug(value: string): string {
  const out = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return out || "model";
}
