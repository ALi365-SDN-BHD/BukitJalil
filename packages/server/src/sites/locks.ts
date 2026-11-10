import { SiteError } from "./location.ts";

/**
 * Site operation lock (plan 7.2): one in-process mutex per site. An operation that finds the site busy
 * fails at once with 409 site.busy and the name of the running operation; it never waits.
 */
export class SiteLocks {
  private readonly held = new Map<string, string>();

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
    };
  }
}
