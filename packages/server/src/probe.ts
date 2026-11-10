import { spawn } from "node:child_process";

export type ProbeResult = { ok: true; stdout: string } | { ok: false; reason: string };

/**
 * Run a program once to ask its version: no shell, the given minimal environment, stdout capped at 64 KB,
 * killed after `timeoutMs`. Fails when it cannot start, times out or exits with a non-zero code.
 */
export function runProbe(
  file: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  timeoutMs = 15_000,
): Promise<ProbeResult> {
  return new Promise((resolve) => {
    let out = "";
    let timedOut = false;
    const child = spawn(file, args, { env, stdio: ["ignore", "pipe", "ignore"], shell: false });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d: string) => {
      if (out.length < 64 * 1024) out += d;
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, reason: err.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) resolve({ ok: false, reason: `no answer after ${timeoutMs / 1000} s` });
      else if (code === 0) resolve({ ok: true, stdout: out });
      else resolve({ ok: false, reason: `exit code ${code}` });
    });
  });
}
