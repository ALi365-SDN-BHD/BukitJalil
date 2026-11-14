import type { AuthOperationOptions, Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";
import { isRecord } from "../bukit/guard.ts";
import { SiteError } from "../sites/location.ts";
import type { StoredJson } from "../store/json-file.ts";

/**
 * Pi's model keys in BukitJalil's secret file instead of Pi's auth.json (plan 6.7). Pi 1.5.2 takes any
 * CredentialStore: `modify` is its only write path and must be serialized; one server owns the data
 * directory, so a lock inside this process is enough. Keys are returned as saved: unlike Pi's own
 * auth.json store, values are never resolved as commands (`!cmd`) or environment references; keys entered
 * in BukitJalil are literal, and a migrated auth.json that used them needs the key entered again.
 */
export class SecretCredentialStore implements CredentialStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly file: StoredJson) {}

  /** The saved credential, read straight from the file (for showing the key's last characters). */
  readNow(providerId: string): Credential | undefined {
    return this.data()[providerId];
  }

  async read(providerId: string, options?: AuthOperationOptions): Promise<Credential | undefined> {
    options?.signal?.throwIfAborted();
    return this.readNow(providerId);
  }

  async list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
    options?.signal?.throwIfAborted();
    return Object.entries(this.data()).map(([providerId, c]) => ({ providerId, type: c.type }));
  }

  modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    options?: AuthOperationOptions,
  ): Promise<Credential | undefined> {
    return this.locked(options, async () => {
      const data = this.data();
      const current = data[providerId];
      const next = await fn(current);
      if (next === undefined) return current;
      this.file.write({ ...data, [providerId]: next });
      return next;
    });
  }

  delete(providerId: string, options?: AuthOperationOptions): Promise<void> {
    return this.locked(options, async () => {
      const data = this.data();
      if (!(providerId in data)) return;
      const { [providerId]: _removed, ...rest } = data;
      this.file.write(rest);
    });
  }

  private data(): Record<string, Credential> {
    const value = this.file.read();
    if (value === undefined) return {};
    if (!isRecord(value)) throw new Error("the model key file is not an object");
    const out: Record<string, Credential> = {};
    for (const [id, c] of Object.entries(value)) {
      if (isRecord(c) && (c.type === "api_key" || c.type === "oauth")) out[id] = c as unknown as Credential;
    }
    return out;
  }

  private locked<T>(options: AuthOperationOptions | undefined, fn: () => Promise<T>): Promise<T> {
    options?.signal?.throwIfAborted();
    // Refused before `fn` runs: an OAuth refresh inside it spends a one-time refresh token that could
    // then not be saved (plan 6.7).
    if (this.file.writable?.() === false)
      return Promise.reject(new SiteError(this.file.refusal?.() ?? "secrets.unavailable", 503));
    const step = () => {
      options?.signal?.throwIfAborted();
      // Again when its turn comes: a reset may have happened while it waited.
      if (this.file.writable?.() === false) throw new SiteError(this.file.refusal?.() ?? "secrets.unavailable", 503);
      return fn();
    };
    const run = this.queue.then(step, step);
    this.queue = run.catch(() => undefined);
    return run;
  }
}
