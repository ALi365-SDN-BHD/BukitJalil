import { SiteError } from "./location.ts";

/**
 * Site operation lock (plan 7.2): one in-process mutex per site. An operation that finds the site busy
 * fails at once with 409 site.busy and the name of the running operation; only AI runs wait for it
 * (`waitFree`), because their messages are already queued.
 */
export class SiteLocks {
  private readonly held = new Map<string, string>();
  private readonly waiters = new Map<string, (() => void)[]>();

  async run<T>(siteId: string, operation: string, fn: () => Promise<T>): Promise<T> {
    const release = this.acquire(siteId, operation);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /**
   * Take the lock now and return its release function, for an operation that outlives the request that
   * started it (a build answers 202 and keeps running). Throws site.busy like `run`.
   */
  acquire(siteId: string, operation: string): () => void {
    const current = this.held.get(siteId);
    if (current !== undefined) throw new SiteError("site.busy", 409, { operation: current });
    this.held.set(siteId, operation);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.held.delete(siteId);
      const waiting = this.waiters.get(siteId) ?? [];
      this.waiters.delete(siteId);
      for (const wake of waiting) wake();
    };
  }

  /** The operation holding the site's lock, or null. */
  holder(siteId: string): string | null {
    return this.held.get(siteId) ?? null;
  }

  /**
   * Resolves once the site's lock is free (at once when it is). Another operation may take it before the
   * waiter runs, so the waiter tries `acquire` again and waits once more if needed.
   */
  waitFree(siteId: string): Promise<void> {
    if (!this.held.has(siteId)) return Promise.resolve();
    return new Promise((resolve) => {
      const list = this.waiters.get(siteId) ?? [];
      list.push(resolve);
      this.waiters.set(siteId, list);
    });
  }
}
