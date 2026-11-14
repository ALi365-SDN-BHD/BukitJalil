import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** The stored form of an encrypted file (plan 6.7). */
export interface SealedText {
  v: 1;
  iv: string;
  tag: string;
  data: string;
}

export class SecretBoxError extends Error {}

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * AES-256-GCM with the key the desktop app keeps in the system keychain. The purpose (which file it is)
 * is authenticated, so one encrypted file cannot stand in for another.
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(key: Buffer) {
    if (key.length !== KEY_BYTES) throw new SecretBoxError("the secret key must be 32 bytes");
    this.key = Buffer.from(key);
  }

  seal(text: string, purpose: string): SealedText {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(Buffer.from(purpose, "utf8"));
    const data = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
    return {
      v: 1,
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: data.toString("base64"),
    };
  }

  /** Throws SecretBoxError for anything that is not this box's sealing of this purpose. */
  open(sealed: unknown, purpose: string): string {
    if (!isSealed(sealed)) throw new SecretBoxError("not an encrypted file");
    const iv = Buffer.from(sealed.iv, "base64");
    const tag = Buffer.from(sealed.tag, "base64");
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new SecretBoxError("not an encrypted file");
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.key, iv, { authTagLength: TAG_BYTES });
      decipher.setAAD(Buffer.from(purpose, "utf8"));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(Buffer.from(sealed.data, "base64")), decipher.final()]).toString("utf8");
    } catch {
      throw new SecretBoxError("cannot decrypt");
    }
  }
}

function isSealed(value: unknown): value is SealedText {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.v === 1 && typeof v.iv === "string" && typeof v.tag === "string" && typeof v.data === "string";
}
