import type { AuthOperationOptions, Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";
import { isRecord } from "../bukit/guard.ts";
import type { FieldVault } from "../security/vault.ts";
import type { Db } from "../store/db.ts";

const TABLE = "pi_credentials";

interface Row {
  provider: string;
  credential_ciphertext: string;
}

/**
 * Pi's model keys in the database instead of Pi's auth.json (plan 6.9): one row per provider, encrypted
 * with the field key. Pi 1.5.2 takes any CredentialStore: `modify` is its only write path and must be
 * serialized; one server owns the data directory, so a queue inside this process is enough. Keys are
 * returned as saved: unlike Pi's own auth.json store, values are never resolved as commands (`!cmd`) or
 * environment references; keys entered in BukitJalil are literal.
 */
export class SecretCredentialStore implements CredentialStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly opts: { db: Db; vault: FieldVault }) {}

  /** The saved credential (for showing the key's last characters). */
  readNow(providerId: string): Credential | undefined {
    const row = this.opts.db.prepare("SELECT * FROM pi_credentials WHERE provider = ?").get(providerId) as
      | Row
      | undefined;
    return row ? this.credentialOf(row) : undefined;
  }

  async read(providerId: string, options?: AuthOperationOptions): Promise<Credential | undefined> {
    options?.signal?.throwIfAborted();
    return this.readNow(providerId);
  }

  async list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
    options?.signal?.throwIfAborted();
    const rows = this.opts.db.prepare("SELECT * FROM pi_credentials ORDER BY provider").all() as Row[];
    return rows.flatMap((row) => {
      const c = this.credentialOf(row);
      return c ? [{ providerId: row.provider, type: c.type }] : [];
    });
  }

  modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    options?: AuthOperationOptions,
  ): Promise<Credential | undefined> {
    return this.locked(options, async () => {
      const current = this.readNow(providerId);
      const next = await fn(current);
      if (next === undefined) return current;
      this.opts.db
        .prepare(
          "INSERT INTO pi_credentials (provider, credential_ciphertext) VALUES (?, ?) ON CONFLICT (provider) DO UPDATE SET credential_ciphertext = excluded.credential_ciphertext",
        )
        .run(providerId, this.opts.vault.seal(JSON.stringify(next), TABLE, providerId));
      return next;
    });
  }

  delete(providerId: string, options?: AuthOperationOptions): Promise<void> {
    return this.locked(options, async () => {
      this.opts.db.prepare("DELETE FROM pi_credentials WHERE provider = ?").run(providerId);
    });
  }

  /** A row that decrypts to something other than a credential is skipped, as Pi skips one in auth.json. */
  private credentialOf(row: Row): Credential | undefined {
    let value: unknown;
    try {
      value = JSON.parse(this.opts.vault.open(row.credential_ciphertext, TABLE, row.provider));
    } catch (err) {
      if (err instanceof SyntaxError) return undefined;
      throw err;
    }
    return isRecord(value) && (value.type === "api_key" || value.type === "oauth")
      ? (value as unknown as Credential)
      : undefined;
  }

  private locked<T>(options: AuthOperationOptions | undefined, fn: () => Promise<T>): Promise<T> {
    options?.signal?.throwIfAborted();
    const step = () => {
      options?.signal?.throwIfAborted();
      return fn();
    };
    const run = this.queue.then(step, step);
    this.queue = run.catch(() => undefined);
    return run;
  }
}
