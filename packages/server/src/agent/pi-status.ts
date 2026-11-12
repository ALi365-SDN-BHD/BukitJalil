import type { PiStatus } from "@bukitjalil/shared";
import { versionAtLeast } from "../git/version.ts";
import type { PiModules } from "./pi.ts";

/** npm's latest release of the Pi runtime; the settings page checks it when it opens. */
export const PI_LATEST_URL = "https://registry.npmjs.org/@earendil-works%2Fpi-coding-agent/latest";
/** How long a fetched release is reused before the next settings check asks npm again. */
export const PI_VERSION_CACHE_MS = 10 * 60_000;

export interface PiStatusOptions {
  modules: () => Promise<PiModules>;
  /** null in tests and offline mode: the latest release stays unknown. */
  fetchImpl: typeof fetch | null;
  now?: () => number;
  timeoutMs?: number;
}

/**
 * Pi's version as bundled with this app, plus the latest release on npm. Pi is a library inside the app,
 * not a separately installed tool, so an available update is installed by updating BukitJalil itself.
 */
export class PiStatusService {
  private latest: Promise<string | null> | null = null;
  private latestAt = 0;

  constructor(private readonly opts: PiStatusOptions) {}

  /** `refresh` bypasses the ten-minute cache, as the manual "check for updates" button does. */
  async status(refresh = false): Promise<PiStatus> {
    if (refresh) this.invalidate();
    const [{ pi }, latestVersion] = await Promise.all([this.opts.modules(), this.latestVersion()]);
    return {
      version: pi.VERSION,
      latestVersion,
      updateAvailable: latestVersion !== null && !versionAtLeast(pi.VERSION, latestVersion),
    };
  }

  invalidate(): void {
    this.latest = null;
    this.latestAt = 0;
  }

  private latestVersion(): Promise<string | null> {
    const now = this.opts.now?.() ?? Date.now();
    if (this.latest && now - this.latestAt < PI_VERSION_CACHE_MS) return this.latest;
    if (!this.opts.fetchImpl) return Promise.resolve(null);
    this.latestAt = now;
    // A failed lookup resolves to null and is retried after the cache window, not on every settings open.
    this.latest = fetchLatestPiVersion(this.opts.fetchImpl, this.opts.timeoutMs);
    return this.latest;
  }
}

export async function fetchLatestPiVersion(fetchImpl: typeof fetch, timeoutMs = 8_000): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(PI_LATEST_URL, {
      headers: { Accept: "application/json", "User-Agent": "BukitJalil" },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { version?: unknown };
    return typeof json.version === "string" && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(json.version)
      ? json.version
      : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
