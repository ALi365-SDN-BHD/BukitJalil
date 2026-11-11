import crypto from "node:crypto";

/** Random URL-safe secret (256 bits). */
export function randomSecret(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Login token from the printed URL (plan 11). It works once: a token copied from the terminal, browser
 * history or another user's process list is useless after the browser has used it. `issue()` makes a new
 * one (the terminal prints it when the user presses Enter) and invalidates the previous one.
 */
export class LoginToken {
  private value: string;

  constructor(initial: string = randomSecret()) {
    this.value = initial;
  }

  issue(): string {
    this.value = randomSecret();
    return this.value;
  }

  /** True once for the current token; afterwards the token is replaced by an unprinted one. */
  consume(candidate: string): boolean {
    if (!safeEqual(candidate, this.value)) return false;
    this.value = randomSecret();
    return true;
  }
}
