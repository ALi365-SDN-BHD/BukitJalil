import type { CustomModelProvider, CustomModelRequest, CustomModelsResponse } from "@bukitjalil/shared";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { isRecord } from "../bukit/guard.ts";
import { SiteError } from "../sites/location.ts";
import { JsonFile, JsonFileError } from "../store/json-file.ts";

/** What is stored on disk; the response type hides the key. */
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

/**
 * Local and self-hosted OpenAI-compatible models (Ollama, LM Studio, vLLM, llama.cpp, ...). The config
 * lives in the app's Pi directory (mode 600) and is registered into Pi's runtime on startup and after
 * every change. A local server usually needs no key; a dummy one lets Pi's auth layer make requests.
 */
export class CustomModelStore {
  private readonly json: JsonFile;

  constructor(file: string) {
    this.json = new JsonFile(file);
  }

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
    this.write([...providers, provider]);
    return view(provider);
  }

  update(id: string, req: CustomModelRequest, beforeWrite?: (provider: StoredProvider) => void): CustomModelProvider {
    const providers = this.read();
    const index = providers.findIndex((provider) => provider.id === id);
    if (index < 0) throw new SiteError("custom.not_found", 404);
    const previous = providers[index];
    if (!previous) throw new SiteError("custom.not_found", 404);
    const provider: StoredProvider = {
      ...previous,
      name: req.name,
      baseUrl: req.baseUrl,
      api: req.api,
      // An omitted key keeps the stored one; an empty field removes it.
      apiKey: req.apiKey === undefined ? previous.apiKey : req.apiKey.trim() || null,
      model: modelOf(req),
    };
    // Register first: if the runtime rejects the provider, the old file stays in place.
    beforeWrite?.(provider);
    providers[index] = provider;
    this.write(providers);
    return view(provider);
  }

  remove(id: string): void {
    const providers = this.read();
    if (!providers.some((provider) => provider.id === id)) throw new SiteError("custom.not_found", 404);
    this.write(providers.filter((provider) => provider.id !== id));
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
      // An unreadable file is reported when the settings page asks for it; startup still works.
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

  /** Remove temporary files left by a killed write; returns the number removed. */
  cleanupTempFiles(): number {
    return this.json.cleanupTempFiles();
  }

  private read(): StoredProvider[] {
    let raw: unknown;
    try {
      raw = this.json.read();
    } catch (err) {
      if (err instanceof JsonFileError) throw new SiteError("storage.unreadable", 500);
      throw err;
    }
    if (raw === undefined) return [];
    if (!isRecord(raw) || !Array.isArray(raw.providers)) throw new SiteError("storage.unreadable", 500);
    const ids = new Set<string>();
    return raw.providers.map((entry) => {
      if (!isRecord(entry)) throw new SiteError("storage.unreadable", 500);
      const model = entry.model;
      if (
        typeof entry.id !== "string" ||
        entry.id === "" ||
        ids.has(entry.id) ||
        typeof entry.name !== "string" ||
        typeof entry.baseUrl !== "string" ||
        (entry.api !== "openai-completions" &&
          entry.api !== "openai-responses" &&
          entry.api !== "anthropic-messages") ||
        !isRecord(model) ||
        typeof model.id !== "string" ||
        model.id === "" ||
        typeof model.name !== "string" ||
        (entry.apiKey !== undefined && entry.apiKey !== null && typeof entry.apiKey !== "string")
      ) {
        throw new SiteError("storage.unreadable", 500);
      }
      const contextWindow = count(model.contextWindow, DEFAULT_CONTEXT);
      const maxTokens = count(model.maxTokens, DEFAULT_MAX_TOKENS);
      if (model.reasoning !== undefined && typeof model.reasoning !== "boolean") {
        throw new SiteError("storage.unreadable", 500);
      }
      ids.add(entry.id);
      return {
        id: entry.id,
        name: entry.name,
        baseUrl: entry.baseUrl,
        api: entry.api,
        apiKey: entry.apiKey ?? null,
        model: {
          id: model.id,
          name: model.name,
          contextWindow,
          maxTokens,
          reasoning: model.reasoning ?? false,
        },
      };
    });
  }

  private write(providers: StoredProvider[]): void {
    try {
      this.json.write({ providers });
    } catch (err) {
      if (err instanceof JsonFileError) throw new SiteError(err.code, 500);
      throw err;
    }
  }
}

/** A positive integer from the file, or the default when the field is absent. */
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
