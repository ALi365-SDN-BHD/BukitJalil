import { z } from "zod";

/** 4–8 digits (plan 6.9): the SQLCipher passphrase of the desktop app's database. */
export const PIN_PATTERN = /^[0-9]{4,8}$/;
export const Pin = z.string().regex(PIN_PATTERN);

/**
 * The app lock (plan 6.9):
 * - pin: the desktop app; the database is encrypted with the PIN and opened only once it is entered;
 * - dev: `pnpm dev` and tests; no PIN, never locked.
 */
export const SecurityStatus = z.object({
  mode: z.enum(["pin", "dev"]),
  /** A PIN exists (the encrypted database has been created). */
  pinSet: z.boolean(),
  locked: z.boolean(),
  /** Seconds until PIN entry is allowed again after too many wrong PINs; 0 when it is allowed. */
  retryAfterSeconds: z.number().int().nonnegative(),
});
export type SecurityStatus = z.infer<typeof SecurityStatus>;

export const PinRequest = z.object({ pin: Pin });
export type PinRequest = z.infer<typeof PinRequest>;

export const ChangePinRequest = z.object({ currentPin: Pin, nextPin: Pin });
export type ChangePinRequest = z.infer<typeof ChangePinRequest>;
