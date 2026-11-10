import path from "node:path";
import type {
  KeySource,
  ModelInfo,
  ModelsResponse,
  ProviderInfo,
  ProviderKey,
  ProviderTestResult,
} from "@bukitjalil/shared";
import type { Api, Model, Provider } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { SiteError } from "../sites/location.ts";
import type { SettingsStore } from "../store/settings.ts";
import type { PiModules } from "./pi.ts";

/**
 * Providers whose API-key setup asks for more than one key (a choice of method, an account id), which the
 * settings page does not ask for. Pi still uses them when the key comes from the environment. Any other
 * provider that asks for more is refused when the key is saved (model.key_unsupported).
 */
const MULTI_FIELD = new Set(["amazon-bedrock", "google-vertex", "cloudflare-ai-gateway", "cloudflare-workers-ai"]);

const TEST_TIMEOUT_MS = 30_000;
const TEST_PROMPT = "Reply with the single word OK.";

export interface ModelServiceOptions {
  runtime: () => Promise<ModelRuntime>;
  pi: () => Promise<PiModules>;
  settings: SettingsStore;
  /** Pi's directory, holding auth.json. */
  piDir: string;
  testTimeoutMs?: number;
}

/**
 * Model settings (plan 6.5): Pi's catalog of providers and models, API keys stored in Pi's auth.json
 * through Pi's own login flow, and a connection test. Keys never leave the server: the UI sees whether a
 * key is set, where it comes from, and its last four characters.
 */
export class ModelService {
  constructor(private readonly opts: ModelServiceOptions) {}

  async list(): Promise<ModelsResponse> {
    const [runtime, { pi }] = await Promise.all([this.opts.runtime(), this.opts.pi()]);
    const authPath = path.join(this.opts.piDir, "auth.json");
    // Checked side by side: a provider without a key in Pi's snapshot is asked directly.
    const withModels = runtime.getProviders().filter((p) => runtime.getModels(p.id).length > 0);
    const providers: ProviderInfo[] = await Promise.all(
      withModels.map(async (provider) => ({
        id: provider.id,
        name: provider.name,
        keyEditable: keyEditable(provider),
        envKey: !!provider.auth.apiKey,
        key: await keyOf(runtime, provider.id, () => pi.readStoredCredential(provider.id, authPath)),
        models: runtime.getModels(provider.id).map(modelInfo),
      })),
    );
    const { model: selected, thinkingLevel } = this.opts.settings.get();
    return {
      providers,
      selected,
      selectedMissing: selected !== null && !runtime.getModel(selected.provider, selected.id),
      thinkingLevel,
    };
  }

  /** Save a key in auth.json through Pi's API-key login, which also refreshes Pi's view of the provider. */
  async setKey(providerId: string, apiKey: string): Promise<ProviderKey> {
    const runtime = await this.opts.runtime();
    const provider = this.provider(runtime, providerId);
    if (!keyEditable(provider)) throw new SiteError("model.key_unsupported", 400);
    if ((await this.key(runtime, providerId)).source === "environment") {
      throw new SiteError("model.key_from_environment", 409);
    }
    let asked = 0;
    try {
      await runtime.login(providerId, "api_key", {
        prompt: async (p) => {
          asked++;
          if (asked === 1 && p.type === "secret") return apiKey;
          throw new UnsupportedLogin();
        },
        notify: () => {},
      });
    } catch (err) {
      if (asked > 1 || err instanceof UnsupportedLogin) throw new SiteError("model.key_unsupported", 400);
      throw err;
    }
    return this.key(runtime, providerId);
  }

  /** Remove a key saved in the UI; one from the environment cannot be removed here. */
  async removeKey(providerId: string): Promise<ProviderKey> {
    const runtime = await this.opts.runtime();
    this.provider(runtime, providerId);
    const { source } = await this.key(runtime, providerId);
    if (source === "environment") throw new SiteError("model.key_from_environment", 409);
    if (source === "stored") await runtime.logout(providerId);
    return this.key(runtime, providerId);
  }

  /** One short request to a model of the provider: the given one, the selected one, or its first. */
  async test(providerId: string, modelId?: string): Promise<ProviderTestResult> {
    const runtime = await this.opts.runtime();
    const provider = this.provider(runtime, providerId);
    const selected = this.opts.settings.get().model;
    const id = modelId ?? (selected?.provider === providerId ? selected.id : runtime.getModels(provider.id)[0]?.id);
    const model = id ? runtime.getModel(providerId, id) : undefined;
    if (!model) throw new SiteError("model.not_found", 404);
    if (!(await hasAuth(runtime, providerId))) throw new SiteError("model.no_key", 409);

    const started = Date.now();
    const timeoutMs = this.opts.testTimeoutMs ?? TEST_TIMEOUT_MS;
    const secrets = await this.secrets(runtime, model);
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    // The request is aborted on timeout, and the answer does not wait for a provider that ignores that.
    const timedOut = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve("timeout");
      }, timeoutMs);
    });
    const result = (ok: boolean, error: string | null, timedOut = false): ProviderTestResult => ({
      ok,
      model: model.id,
      latencyMs: Date.now() - started,
      timedOut,
      error: error === null ? null : redact(error, secrets),
    });
    try {
      const reply = await Promise.race([
        runtime.completeSimple(
          model,
          { messages: [{ role: "user", content: TEST_PROMPT, timestamp: Date.now() }] },
          { maxTokens: 64, signal: controller.signal },
        ),
        timedOut,
      ]);
      if (reply === "timeout") return result(false, null, true);
      const failed = reply.stopReason === "error" || reply.stopReason === "aborted";
      return result(!failed, failed ? (reply.errorMessage ?? reply.stopReason) : null);
    } catch (err) {
      return result(false, err instanceof Error ? err.message : String(err));
    } finally {
      clearTimeout(timer);
    }
  }

  private provider(runtime: ModelRuntime, providerId: string): Provider {
    const provider = runtime.getProvider(providerId);
    if (!provider || runtime.getModels(providerId).length === 0) throw new SiteError("model.provider_not_found", 404);
    return provider;
  }

  private async key(runtime: ModelRuntime, providerId: string): Promise<ProviderKey> {
    const { pi } = await this.opts.pi();
    const authPath = path.join(this.opts.piDir, "auth.json");
    return keyOf(runtime, providerId, () => pi.readStoredCredential(providerId, authPath));
  }

  /** The key a request to this model would use, to keep it out of error messages. */
  private async secrets(runtime: ModelRuntime, model: Model<Api>): Promise<string[]> {
    try {
      const auth = await runtime.getAuth(model);
      return [auth?.auth.apiKey, ...Object.values(auth?.auth.headers ?? {})].filter(
        (s): s is string => typeof s === "string" && s.length >= 8,
      );
    } catch {
      return [];
    }
  }
}

class UnsupportedLogin extends Error {}

/**
 * The model chosen in the settings, for AgentService's resolveModel: undefined when none is chosen, and
 * agent.model_not_found when it is no longer in the catalog.
 */
export function settingsModel(settings: SettingsStore) {
  return (runtime: ModelRuntime): Model<Api> | undefined => {
    const ref = settings.get().model;
    if (!ref) return undefined;
    const model = runtime.getModel(ref.provider, ref.id);
    if (!model) throw new SiteError("agent.model_not_found", 409, { provider: ref.provider, model: ref.id });
    return model;
  };
}

function keyEditable(provider: Provider): boolean {
  return !!provider.auth.apiKey?.login && !MULTI_FIELD.has(provider.id);
}

function modelInfo(model: Model<Api>): ModelInfo {
  return { id: model.id, name: model.name, reasoning: !!model.reasoning, contextWindow: model.contextWindow };
}

/**
 * Whether requests to the provider have auth. Pi's status comes from a snapshot that its availability
 * check fills in the background, so a provider it does not list yet is asked directly. Pi then uses the
 * provider's own check, or else resolves its auth, which can run a key command from models.json (that
 * file is BukitJalil's own, in the app's Pi directory) or refresh an OAuth token.
 */
export async function hasAuth(runtime: ModelRuntime, providerId: string): Promise<boolean> {
  if (runtime.getProviderAuthStatus(providerId).configured) return true;
  return (await runtime.checkAuth(providerId).catch(() => undefined)) !== undefined;
}

async function keyOf(runtime: ModelRuntime, providerId: string, stored: () => unknown): Promise<ProviderKey> {
  const status = runtime.getProviderAuthStatus(providerId);
  if (!status.configured) {
    const check = await runtime.checkAuth(providerId).catch(() => undefined);
    if (!check) return { configured: false, source: null, last4: null, label: null };
    // An environment variable Pi found before its snapshot did, or a provider without keys.
    const fromEnv = !!check.source && /^[A-Z][A-Z0-9_]*$/.test(check.source);
    return {
      configured: true,
      source: fromEnv ? "environment" : "other",
      last4: null,
      label: fromEnv ? (check.source ?? null) : null,
    };
  }
  // Pi reports providers that need no key (local servers, the fake model) as "environment" without a
  // variable; only a named variable is a key from the environment.
  const source: KeySource =
    status.source === "stored" ? "stored" : status.source === "environment" && status.label ? "environment" : "other";
  let last4: string | null = null;
  if (source === "stored") {
    const credential = stored() as { type?: string; key?: unknown } | undefined;
    if (credential?.type === "api_key" && typeof credential.key === "string" && credential.key.length >= 8) {
      last4 = credential.key.slice(-4);
    }
  }
  return { configured: true, source, last4, label: source === "environment" ? (status.label ?? null) : null };
}

export function redact(text: string, secrets: string[]): string {
  let out = text;
  for (const s of secrets) out = out.split(s).join("***");
  return out.slice(0, 2000);
}
