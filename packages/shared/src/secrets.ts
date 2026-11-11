import { z } from "zod";

/** Tokens the user can set in the UI (plan 6.5). The Notion token is only read from the environment for now. */
export const secretNames = ["github"] as const;
export type SecretName = (typeof secretNames)[number];

export interface SecretStatus {
  configured: boolean;
  /** "environment": from BUKITJALIL_GITHUB_TOKEN, read-only in the UI. */
  source: "stored" | "environment" | null;
  /** The last four characters; never the token itself. */
  last4: string | null;
  /** The environment variable the token can come from. */
  label: string;
}

/** GET /api/secrets. */
export type SecretsResponse = Record<SecretName, SecretStatus>;

/** PUT /api/secrets/:name. */
export const SecretRequest = z.object({
  value: z
    .string()
    .trim()
    .min(1)
    .max(4096)
    .refine((s) => !/[\s\p{Cc}]/u.test(s), "must not contain spaces or control characters"),
});
export type SecretRequest = z.infer<typeof SecretRequest>;
