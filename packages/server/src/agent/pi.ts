import path from "node:path";
import type * as AiModule from "@earendil-works/pi-ai";
import type * as PiModule from "@earendil-works/pi-coding-agent";
import { assertPiEnvironment } from "./env.ts";

export interface PiModules {
  pi: typeof PiModule;
  ai: typeof AiModule;
}

let loaded: { dir: string; modules: Promise<PiModules> } | null = null;

/**
 * Load Pi on first use (plan 6.1). This is the only place that loads Pi's code: everything else imports
 * its types only, so Pi never reads its environment before `preparePiEnvironment` has run. Pi keeps the
 * directory it saw at load time, so a later call with another directory is refused.
 */
export function loadPi(piDir: string): Promise<PiModules> {
  const dir = path.resolve(piDir);
  assertPiEnvironment(dir);
  if (loaded && loaded.dir !== dir) throw new Error(`Pi is already loaded for ${loaded.dir}`);
  if (!loaded) {
    const modules = Promise.all([import("@earendil-works/pi-coding-agent"), import("@earendil-works/pi-ai")]).then(
      ([pi, ai]) => ({ pi, ai }),
    );
    // A failed load can be tried again.
    modules.catch(() => {
      if (loaded?.modules === modules) loaded = null;
    });
    loaded = { dir, modules };
  }
  return loaded.modules;
}
