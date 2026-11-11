import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

export interface GitIdentity {
  name: string | null;
  email: string | null;
}

/**
 * Default commit identity for the settings page (plan 7.2): the user's global `user.name` / `user.email`.
 * This is the one git call that reads the global config; `config --get` only reads values and runs no
 * program. Everything else uses GitRunner, which never reads it.
 */
export async function readGlobalIdentity(gitPath: string, home = os.homedir()): Promise<GitIdentity> {
  const get = (key: string) =>
    new Promise<string | null>((resolve) => {
      let out = "";
      const child = spawn(gitPath, ["config", "--global", "--get", key], {
        cwd: home,
        env: {
          PATH: [path.dirname(gitPath), "/usr/bin", "/bin"].join(path.delimiter),
          HOME: home,
          LANG: "C",
          GIT_CONFIG_NOSYSTEM: "1",
        },
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 10_000,
      });
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (d: string) => {
        if (out.length < 1024) out += d;
      });
      child.on("error", () => resolve(null));
      child.on("close", (code) => {
        const value = out.trim();
        resolve(code === 0 && value.length > 0 ? value : null);
      });
    });
  const [name, email] = await Promise.all([get("user.name"), get("user.email")]);
  return { name, email };
}
