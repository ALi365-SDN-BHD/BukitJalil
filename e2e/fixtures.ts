import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test as base } from "@playwright/test";
import { bukitForTests } from "./fake-bukit.ts";
import { E2E_ADMIN_PORT, E2E_PREVIEW_BASE } from "./ports.ts";

interface Server {
  /** A fresh one-time login link: the startup link first, then one per Enter on the server's stdin. */
  loginUrl(): Promise<string>;
  /** The path of the app's own Bukit copy; tests may rewrite it to change the reported version. */
  bukitPath: string;
  /** Replace the app's Bukit copy with `source`; refresh the cached status from the page afterwards. */
  setBukit(source: string): void;
}

const URL_RE = /http:\/\/127\.0\.0\.1:\d+\/\?token=[\w-]+/g;

/** The real server with a throwaway data dir, one per worker (one worker per browser project). */
export const test = base.extend<object, { server: Server }>({
  server: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright requires a destructuring pattern here
    async ({}, use) => {
      const root = path.resolve(import.meta.dirname, "..");
      if (!fs.existsSync(path.join(root, "packages/web/dist/index.html"))) {
        throw new Error("Build the UI first: pnpm build");
      }
      const home = fs.mkdtempSync(path.join(os.tmpdir(), "bj-e2e-home-"));
      // The server only uses the Bukit that ships with it (plan 8.1); BUKITJALIL_BUKIT_DIR points it at a
      // folder holding the stand-in (or BUKIT_BIN).
      const bukitDir = path.join(home, "bundled-bukit");
      const bukitLink = path.join(bukitDir, "bukit");
      const setBukit = (source: string) => {
        fs.mkdirSync(path.dirname(bukitLink), { recursive: true, mode: 0o700 });
        fs.rmSync(bukitLink, { force: true });
        fs.symlinkSync(path.resolve(source), bukitLink);
      };
      setBukit(bukitForTests(home));
      const child: ChildProcess = spawn(
        process.execPath,
        [
          path.join(root, "packages/server/node_modules/tsx/dist/cli.mjs"),
          path.join(root, "packages/server/src/main.ts"),
          "--no-open",
          "--port",
          String(E2E_ADMIN_PORT),
          "--preview-port-base",
          String(E2E_PREVIEW_BASE),
        ],
        // The scripted model (packages/server/src/agent/fake-model.ts) lets conversations run without a key.
        {
          cwd: root,
          env: {
            ...process.env,
            BUKITJALIL_HOME: home,
            BUKITJALIL_BUKIT_DIR: bukitDir,
            BUKITJALIL_FAKE_MODEL: "1",
            BUKITJALIL_OFFLINE: "1",
          },
          stdio: ["pipe", "pipe", "pipe"],
        },
      );

      let out = "";
      const urls: string[] = [];
      let waiter: ((url: string) => void) | null = null;
      const onData = (d: Buffer) => {
        out += d.toString();
        const found = [...out.matchAll(URL_RE)].map((m) => m[0]);
        for (const url of found.slice(urls.length)) {
          urls.push(url);
          waiter?.(url);
          waiter = null;
        }
      };
      child.stdout?.on("data", onData);
      child.stderr?.on("data", onData);
      const exited = new Promise<void>((resolve) => child.on("exit", () => resolve()));

      let handedOut = 0;
      const next = (timeoutMs: number) =>
        new Promise<string>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`no login link from the server:\n${out}`)), timeoutMs);
          waiter = (url) => {
            clearTimeout(timer);
            resolve(url);
          };
        });

      await use({
        async loginUrl() {
          if (handedOut === 0) {
            const first = urls[0] ?? (await next(20_000));
            handedOut = 1;
            return first;
          }
          const fresh = next(5_000);
          child.stdin?.write("\n");
          handedOut++;
          return fresh;
        },
        bukitPath: bukitLink,
        setBukit,
      });

      child.kill("SIGTERM");
      await exited;
      fs.rmSync(home, { recursive: true, force: true });
    },
    { scope: "worker" },
  ],
});

export { expect } from "@playwright/test";
