import { describe, expect, it } from "vitest";
import type { PiModules } from "../src/agent/pi.ts";
import { PiStatusService } from "../src/agent/pi-status.ts";

// The settings page's Pi row: the bundled version and npm's latest release, cached for ten minutes. No
// request leaves the machine here.

const modules = {
  pi: { VERSION: "1.5.2" },
  ai: { PI_AI_VERSION: "1.5.2" },
} as unknown as PiModules;

const npm = (version: string, calls: { count: number }) =>
  (async () => {
    calls.count++;
    return new Response(JSON.stringify({ version }), { status: 200 });
  }) as unknown as typeof fetch;

describe("PiStatusService", () => {
  it("reports the bundled version and caches npm's answer for ten minutes", async () => {
    const calls = { count: 0 };
    let now = 1_000_000;
    const service = new PiStatusService({
      modules: async () => modules,
      fetchImpl: npm("1.5.2", calls),
      now: () => now,
    });

    expect(await service.status()).toEqual({ version: "1.5.2", latestVersion: "1.5.2", updateAvailable: false });
    expect(calls.count).toBe(1);

    now += 5 * 60_000;
    await service.status();
    expect(calls.count).toBe(1);

    now += 6 * 60_000;
    await service.status();
    expect(calls.count).toBe(2);
  });

  it("bypasses the cache for a manual check and offers a newer release", async () => {
    const calls = { count: 0 };
    const service = new PiStatusService({
      modules: async () => modules,
      fetchImpl: npm("1.6.0", calls),
    });
    expect(await service.status(true)).toEqual({ version: "1.5.2", latestVersion: "1.6.0", updateAvailable: true });
    await service.status(true);
    expect(calls.count).toBe(2);
  });

  it("leaves the latest version unknown when offline or when npm fails", async () => {
    const offline = new PiStatusService({ modules: async () => modules, fetchImpl: null });
    expect(await offline.status()).toEqual({ version: "1.5.2", latestVersion: null, updateAvailable: false });

    const failing = new PiStatusService({
      modules: async () => modules,
      fetchImpl: (async () => new Response("not found", { status: 404 })) as unknown as typeof fetch,
    });
    expect(await failing.status()).toEqual({ version: "1.5.2", latestVersion: null, updateAvailable: false });
  });
});
