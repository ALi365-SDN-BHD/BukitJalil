import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  KeySource,
  ModelInfo,
  ModelsResponse,
  ProviderAuth,
  ProviderInfo,
  ProviderKey,
  ProviderLoginEvent,
  ProviderLoginPrompt,
  ProviderLoginStatus,
  ProviderOAuth,
  ProviderTestResult,
} from "@bukitjalil/shared";
import type { Api, AuthEvent, AuthInteraction, AuthPrompt, Model, Provider } from "@earendil-works/pi-ai";
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
const LOGIN_TIMEOUT_MS = 10 * 60_000;
const LOGIN_KEEP_MS = 5 * 60_000;

interface PendingPrompt {
  value: ProviderLoginPrompt;
  answer: (value: string) => void;
  reject: (err: Error) => void;
}

interface LoginJob {
  id: string;
  providerId: string;
  state: ProviderLoginStatus["state"];
  events: ProviderLoginEvent[];
  prompt: PendingPrompt | null;
  error: string | null;
  controller: AbortController;
}

export interface ModelServiceOptions {
  runtime: () => Promise<ModelRuntime>;
  pi: () => Promise<PiModules>;
  settings: SettingsStore;
  /** Pi's directory, holding auth.json. */
  piDir: string;
  testTimeoutMs?: number;
  /** Provider ids created by the local/self-hosted model settings. */
  customProviderIds?: () => Set<string>;
}

/**
 * Model settings (plan 6.5): Pi's catalog of providers and models, API keys stored in Pi's auth.json
 * through Pi's own login flow, and a connection test. Keys never leave the server: the UI sees whether a
 * key is set, where it comes from, and its last four characters.
 */
export class ModelService {
  private readonly logins = new Map<string, LoginJob>();

  constructor(private readonly opts: ModelServiceOptions) {}

  async list(): Promise<ModelsResponse> {
    const [runtime, { pi }] = await Promise.all([this.opts.runtime(), this.opts.pi()]);
    const authPath = path.join(this.opts.piDir, "auth.json");
    const customIds = this.opts.customProviderIds?.() ?? new Set<string>();
    // Checked side by side: a provider without a key in Pi's snapshot is asked directly.
    const withModels = runtime.getProviders().filter((p) => runtime.getModels(p.id).length > 0 || !!p.auth.oauth);
    const providers: ProviderInfo[] = await Promise.all(
      withModels.map(async (provider) => {
        const auth = await runtime.checkAuth(provider.id).catch(() => undefined);
        return {
          id: provider.id,
          name: provider.name,
          keyEditable: keyEditable(provider),
          envKey: !!provider.auth.apiKey,
          key: await keyOf(runtime, provider.id, () => pi.readStoredCredential(provider.id, authPath)),
          oauth: oauthOf(provider),
          auth: { configured: !!auth, type: auth?.type ?? null, source: auth?.source ?? null } as ProviderAuth,
          custom: customIds.has(provider.id),
          models: runtime.getModels(provider.id).map(modelInfo),
        };
      }),
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
      if (err instanceof SiteError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      throw new SiteError("model.key_invalid", 400, { message: redact(message, [apiKey]) });
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

  /** Start Pi's native OAuth login (Claude Pro/Max, GitHub Copilot, Kimi, OpenRouter, xAI, ...). */
  async startLogin(providerId: string): Promise<{ id: string }> {
    const runtime = await this.opts.runtime();
    const provider = this.provider(runtime, providerId);
    if (!provider.auth.oauth) throw new SiteError("model.oauth_not_supported", 400);
    const running = [...this.logins.values()].find((job) => job.providerId === providerId && job.state === "running");
    if (running) return { id: running.id };

    const id = randomUUID();
    const controller = new AbortController();
    const job: LoginJob = { id, providerId, state: "running", events: [], prompt: null, error: null, controller };
    this.logins.set(id, job);

    let timeout: NodeJS.Timeout;
    const finish = (state: LoginJob["state"], error: string | null) => {
      clearTimeout(timeout);
      if (job.state !== "running") return;
      job.state = state;
      job.error = error;
      const pending = job.prompt;
      job.prompt = null;
      pending?.reject(new Error("sign-in ended"));
      const cleanup = setTimeout(() => this.logins.delete(id), LOGIN_KEEP_MS);
      cleanup.unref?.();
    };
    timeout = setTimeout(() => {
      controller.abort();
      finish("cancelled", null);
    }, LOGIN_TIMEOUT_MS);
    timeout.unref?.();

    const interaction: AuthInteraction = {
      signal: controller.signal,
      notify: (event) => {
        if (job.state === "running") job.events.push(sharedEvent(event));
      },
      prompt: (prompt) =>
        new Promise<string>((resolve, reject) => {
          if (job.state !== "running") {
            reject(new Error("sign-in is not running"));
            return;
          }
          job.prompt?.reject(new Error("sign-in prompt replaced"));
          const pending: PendingPrompt = {
            value: sharedPrompt(prompt),
            answer: (value) => {
              if (job.prompt === pending) job.prompt = null;
              resolve(value);
            },
            reject: (err) => {
              if (job.prompt === pending) job.prompt = null;
              reject(err);
            },
          };
          job.prompt = pending;
          prompt.signal?.addEventListener("abort", () => pending.reject(new Error("sign-in prompt cancelled")), {
            once: true,
          });
        }),
    };

    void runtime
      .login(providerId, "oauth", interaction, { agentName: "BukitJalil", getDeviceId: () => this.deviceId() })
      .then(
        () => finish("done", null),
        (err: unknown) => {
          if (controller.signal.aborted) finish("cancelled", null);
          else finish("error", err instanceof Error ? err.message : String(err));
        },
      );
    return { id };
  }

  loginStatus(providerId: string, id: string): ProviderLoginStatus {
    return this.loginView(this.loginJob(providerId, id));
  }

  answerLogin(providerId: string, id: string, value: string): ProviderLoginStatus {
    const job = this.loginJob(providerId, id);
    const prompt = job.prompt;
    if (!prompt) throw new SiteError("model.login_prompt_missing", 409);
    prompt.answer(value);
    return this.loginView(job);
  }

  cancelLogin(providerId: string, id: string): ProviderLoginStatus {
    const job = this.loginJob(providerId, id);
    job.controller.abort();
    if (job.state === "running") {
      job.state = "cancelled";
      const pending = job.prompt;
      job.prompt = null;
      pending?.reject(new Error("sign-in cancelled"));
      const cleanup = setTimeout(() => this.logins.delete(id), LOGIN_KEEP_MS);
      cleanup.unref?.();
    }
    return this.loginView(job);
  }

  async logoutOAuth(providerId: string): Promise<void> {
    const runtime = await this.opts.runtime();
    this.provider(runtime, providerId);
    await runtime.logout(providerId);
  }

  private loginJob(providerId: string, id: string): LoginJob {
    const job = this.logins.get(id);
    if (!job || job.providerId !== providerId) throw new SiteError("model.login_not_found", 404);
    return job;
  }

  private loginView(job: LoginJob): ProviderLoginStatus {
    return {
      id: job.id,
      provider: job.providerId,
      state: job.state,
      events: [...job.events],
      prompt: job.prompt?.value ?? null,
      error: job.error,
    };
  }

  /** A stable installation id for OpenAI's "Sign in with ChatGPT" flow, kept next to Pi's auth file. */
  private deviceId(): string {
    const file = path.join(this.opts.piDir, "device-id");
    const valid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
    const read = () => fs.readFileSync(file, "utf8").trim();
    try {
      const existing = read();
      if (valid(existing)) return existing;
    } catch {
      // create it below
    }
    const id = randomUUID();
    try {
      fs.writeFileSync(file, `${id}\n`, { mode: 0o600, flag: "wx" });
      return id;
    } catch {
      try {
        const existing = read();
        if (valid(existing)) return existing;
      } catch {
        // fall through: the login may still work, just without a stable id across restarts
      }
      return id;
    }
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

function oauthOf(provider: Provider): ProviderOAuth | null {
  const oauth = provider.auth.oauth;
  return oauth ? { loginLabel: oauth.loginLabel ?? oauth.name, isSubscription: !!oauth.isSubscription } : null;
}

function sharedEvent(event: AuthEvent): ProviderLoginEvent {
  switch (event.type) {
    case "info":
      return {
        type: "info",
        message: event.message,
        links: event.links?.map((link) => ({ url: link.url, label: link.label })),
      };
    case "auth_url":
      return { type: "auth_url", url: event.url, instructions: event.instructions };
    case "device_code":
      return {
        type: "device_code",
        userCode: event.userCode,
        verificationUri: event.verificationUri,
        expiresInSeconds: event.expiresInSeconds,
      };
    case "progress":
      return { type: "progress", message: event.message };
  }
}

function sharedPrompt(prompt: AuthPrompt): ProviderLoginPrompt {
  switch (prompt.type) {
    case "text":
    case "secret":
    case "manual_code":
      return { type: prompt.type, message: prompt.message, placeholder: prompt.placeholder };
    case "select":
      return {
        type: "select",
        message: prompt.message,
        options: prompt.options.map((option) => ({
          id: option.id,
          label: option.label,
          description: option.description,
        })),
      };
  }
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
