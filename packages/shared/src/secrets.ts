/**
 * How tokens and model keys are kept (plan 6.7):
 * - encrypted: with a key held by the system keychain (desktop app);
 * - plain: 0600 files, for `pnpm dev` and tests;
 * - unavailable: the desktop app has no safe keychain, or cannot unlock its key; nothing can be saved.
 */
export type SecretsMode = "encrypted" | "plain" | "unavailable";

/** Why secrets are unavailable. */
export type SecretsUnavailableReason = "no_keyring" | "locked" | "no_answer" | "reset";

export interface SecretsStatus {
  mode: SecretsMode;
  reason: SecretsUnavailableReason | null;
  /** Unencrypted token or key files are still on disk (unavailable mode reads them; migration failed). */
  plainFiles: boolean;
}
