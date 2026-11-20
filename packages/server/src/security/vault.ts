import { randomBytes } from "node:crypto";
import { SecretBox, SecretBoxError } from "../secrets/box.ts";
import { SiteError } from "../sites/location.ts";
import type { Db } from "../store/db.ts";

const FIELD_KEY = "field";

/**
 * Tokens and model keys in the database (plan 6.9): the whole database is encrypted with the PIN, and each
 * secret is encrypted again with a random field key kept in `vault_keys`, made the first time the database
 * opens. The table and row id are authenticated with the value, so a ciphertext cannot be moved to another
 * row or table. The key never leaves this class; changing the PIN rekeys the database, not the fields.
 */
export class FieldVault {
  private readonly box: SecretBox;

  constructor(db: Db) {
    db.prepare("INSERT OR IGNORE INTO vault_keys (id, key, created_at) VALUES (?, ?, ?)").run(
      FIELD_KEY,
      randomBytes(32),
      new Date().toISOString(),
    );
    const row = db.prepare("SELECT key FROM vault_keys WHERE id = ?").get(FIELD_KEY) as { key: Buffer };
    this.box = new SecretBox(row.key);
    row.key.fill(0);
  }

  seal(value: string, table: string, id: string): string {
    return JSON.stringify(this.box.seal(value, `${table}:${id}`));
  }

  /** The value sealed for this row; a ciphertext that is not is unreadable storage, never a wrong value. */
  open(stored: string, table: string, id: string): string {
    try {
      return this.box.open(JSON.parse(stored), `${table}:${id}`);
    } catch (err) {
      if (err instanceof SecretBoxError || err instanceof SyntaxError) throw new SiteError("storage.unreadable", 500);
      throw err;
    }
  }
}
