import { spawn } from "node:child_process";
import { MIN_GIT_VERSION } from "@bukitjalil/shared";

export interface GitHealth {
  ok: boolean;
  version: string | null;
  problem: "missing" | "too_old" | null;
}

/** Compare dotted versions numerically ("2.39.5" >= "2.38.0"). */
export function versionAtLeast(version: string, minimum: string): boolean {
  const a = version.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const b = minimum.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

/** Extract "2.39.5" from "git version 2.39.5 (Apple Git-154)". */
export function parseGitVersion(output: string): string | null {
  return /git version (\d+(?:\.\d+)+)/.exec(output)?.[1] ?? null;
}

/**
 * `git --version` with a minimal environment. The full hardened runner (plan 7.3) arrives in M2;
 * this call touches no repository, so it needs no repository hardening.
 */
export function checkGit(gitPath = "git", envPath = process.env.PATH ?? "/usr/bin:/bin"): Promise<GitHealth> {
  return new Promise((resolve) => {
    let out = "";
    const child = spawn(gitPath, ["--version"], {
      env: { PATH: envPath, LANG: "C", GIT_CONFIG_NOSYSTEM: "1" },
      stdio: ["ignore", "pipe", "ignore"],
    });
    child.stdout.on("data", (d: Buffer) => {
      out += d.toString("utf8");
    });
    child.on("error", () => resolve({ ok: false, version: null, problem: "missing" }));
    child.on("close", () => {
      const version = parseGitVersion(out);
      if (!version) return resolve({ ok: false, version: null, problem: "missing" });
      const ok = versionAtLeast(version, MIN_GIT_VERSION);
      resolve({ ok, version, problem: ok ? null : "too_old" });
    });
  });
}
