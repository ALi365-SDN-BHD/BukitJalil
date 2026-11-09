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
