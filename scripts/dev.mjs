// `pnpm dev`: start the server (tsx watch) and Vite together (plan 3.3).
// Vite gets only an allowlisted environment, so it never sees tokens or model keys whatever they are called.
import { spawn } from "node:child_process";

const VITE_ENV_ALLOWED =
  /^(PATH|PATHEXT|HOME|USER|LOGNAME|SHELL|LANG|LC_\w+|TZ|TERM|TERM_PROGRAM|COLORTERM|NO_COLOR|FORCE_COLOR|TMPDIR|TMP|TEMP|XDG_\w+|CI|NODE_ENV|PNPM_HOME|COREPACK_HOME|npm_config_\w+|SystemRoot|ComSpec|APPDATA|LOCALAPPDATA|USERPROFILE)$/;
const LOOKS_SECRET = /token|secret|key|password|passwd|auth|credential/i;

const viteEnv = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => VITE_ENV_ALLOWED.test(k) && !LOOKS_SECRET.test(k)),
);

// pnpm is a .cmd shim on Windows, which Node only runs through a shell.
const pnpm = (args, options) => spawn("pnpm", args, { ...options, shell: process.platform === "win32" });

const children = [
  // The server owns the terminal's input: tsx watch restarts on Enter and the server prints a new login link.
  pnpm(
    [
      "--filter",
      "@bukitjalil/server",
      "exec",
      "tsx",
      "watch",
      "--clear-screen=false",
      "src/main.ts",
      "--dev-origin",
      "http://127.0.0.1:47890",
      "--no-open",
    ],
    { stdio: "inherit", env: { ...process.env, BUKITJALIL_DEV: "1" } },
  ),
  pnpm(["--filter", "@bukitjalil/web", "dev"], { stdio: ["ignore", "inherit", "inherit"], env: viteEnv }),
];

let exiting = false;
function stopAll(code) {
  if (exiting) return;
  exiting = true;
  for (const child of children) child.kill("SIGTERM");
  process.exitCode = code;
}
for (const child of children) child.on("exit", (code) => stopAll(code ?? 1));
process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));
