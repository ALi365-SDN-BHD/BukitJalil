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
