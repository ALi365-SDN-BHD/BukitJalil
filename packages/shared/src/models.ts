import { z } from "zod";
import type { ModelRef, ThinkingLevel } from "./settings.ts";

/** Where a provider's key comes from (plan 6.5): set in the UI, or an environment variable Pi reads. */
export type KeySource = "stored" | "environment" | "other";

export interface ProviderKey {
  configured: boolean;
  source: KeySource | null;
  /** The last four characters of a key set in the UI; never the key itself. */
  last4: string | null;
  /** For a key from the environment: the variable, e.g. ANTHROPIC_API_KEY. */
  label: string | null;
}

/** A provider's OAuth subscription login (Claude Pro/Max, GitHub Copilot, Kimi, OpenRouter, xAI, ...). */
export interface ProviderOAuth {
  /** Pi's label for the login option, e.g. "Sign in with Claude Pro/Max". */
  loginLabel: string;
  /** The login is backed by a subscription rather than an API key. */
  isSubscription: boolean;
}

/** Which credential is currently active for a provider. */
export interface ProviderAuth {
  configured: boolean;
  type: "api_key" | "oauth" | null;
  /** Human-readable source, e.g. "OAuth" or "ANTHROPIC_API_KEY". */
  source: string | null;
}

export interface ModelInfo {
  id: string;
  name: string;
  /** Supports thinking levels. */
  reasoning: boolean;
  contextWindow: number;
}

export interface ProviderInfo {
  id: string;
  name: string;
  /** A key can be set in the UI (one API key is all the provider needs). */
  keyEditable: boolean;
  /** A key can come from an environment variable (providers with OAuth only cannot). */
  envKey: boolean;
  key: ProviderKey;
  /** Present when Pi supports signing in with an account instead of an API key. */
  oauth: ProviderOAuth | null;
  auth: ProviderAuth;
  /** Created in the settings page for a local or self-hosted OpenAI-compatible endpoint. */
  custom: boolean;
  models: ModelInfo[];
}

/** GET /api/models (plan 9.1). */
export interface ModelsResponse {
  providers: ProviderInfo[];
  selected: ModelRef | null;
  /** The selected model is not in the catalog (any more). */
  selectedMissing: boolean;
  thinkingLevel: ThinkingLevel;
}

export const ProviderKeyRequest = z.object({
  apiKey: z
    .string()
    .trim()
    .min(1)
    .max(4096)
    .refine((s) => !/[\s\p{Cc}]/u.test(s), "must not contain spaces or control characters"),
});
export type ProviderKeyRequest = z.infer<typeof ProviderKeyRequest>;

export const ProviderTestRequest = z.object({ model: z.string().min(1).max(200).optional() });
export type ProviderTestRequest = z.infer<typeof ProviderTestRequest>;

/** POST /api/providers/:provider/test: one short request to the model. */
export interface ProviderTestResult {
  ok: boolean;
  model: string;
  latencyMs: number;
  /** No answer within the time limit; the UI words it. */
  timedOut: boolean;
  /** The provider's error message, with the key removed; null on success or timeout. */
  error: string | null;
}

export interface ProviderLoginLink {
  url: string;
  label?: string;
}

/** Events Pi's OAuth login sends while it runs: a URL to open, a device code, or progress. */
export type ProviderLoginEvent =
  | { type: "info"; message: string; links?: ProviderLoginLink[] }
  | { type: "auth_url"; url: string; instructions?: string }
  | { type: "device_code"; userCode: string; verificationUri: string; expiresInSeconds?: number }
  | { type: "progress"; message: string };

export type ProviderLoginPrompt =
  | { type: "text"; message: string; placeholder?: string }
  | { type: "secret"; message: string; placeholder?: string }
  | { type: "select"; message: string; options: { id: string; label: string; description?: string }[] }
  | { type: "manual_code"; message: string; placeholder?: string };

export type ProviderLoginState = "running" | "done" | "error" | "cancelled";

/** GET /api/providers/:provider/oauth/:id while an OAuth login runs. */
export interface ProviderLoginStatus {
  id: string;
  provider: string;
  state: ProviderLoginState;
  events: ProviderLoginEvent[];
  prompt: ProviderLoginPrompt | null;
  error: string | null;
}

/** POST /api/providers/:provider/oauth/:id/answer: the answer to the current prompt. */
export const ProviderLoginAnswer = z.object({ value: z.string().trim().min(1).max(8192) });
export type ProviderLoginAnswer = z.infer<typeof ProviderLoginAnswer>;

/** API formats that local OpenAI-compatible servers use. */
export const CustomModelApi = z.enum(["openai-completions", "openai-responses", "anthropic-messages"]);
export type CustomModelApi = z.infer<typeof CustomModelApi>;

/** PUT/POST /api/custom-models: one local or self-hosted model served by a provider. */
export const CustomModelRequest = z.object({
  name: z.string().trim().min(1).max(100),
  baseUrl: z
    .string()
    .trim()
    .max(2048)
    .url()
    .refine((s) => /^https?:\/\//i.test(s), "must be an http(s) URL"),
  api: CustomModelApi,
  /** Omitted on edit to keep the stored key; empty means no key. */
  apiKey: z.string().trim().max(4096).optional(),
  modelId: z.string().trim().min(1).max(200),
  modelName: z.string().trim().min(1).max(100),
  contextWindow: z.number().int().min(1).max(2_000_000).optional(),
  maxTokens: z.number().int().min(1).max(1_000_000).optional(),
  reasoning: z.boolean().optional(),
});
export type CustomModelRequest = z.infer<typeof CustomModelRequest>;

export interface CustomModelProvider {
  id: string;
  name: string;
  baseUrl: string;
  api: CustomModelApi;
  /** Whether a key is stored; the key itself never leaves the server. */
  hasApiKey: boolean;
  model: {
    id: string;
    name: string;
    contextWindow: number;
    maxTokens: number;
    reasoning: boolean;
  };
}

/** GET /api/custom-models. */
export type CustomModelsResponse = CustomModelProvider[];
