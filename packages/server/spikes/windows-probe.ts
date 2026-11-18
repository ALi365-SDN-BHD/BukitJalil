/**
 * Windows port, item 0 (docs/development-plan.md, "M7 之后：Windows 移植估算"): find out what breaks on a real
 * Windows machine before porting anything. Every step is independent: a failure is recorded and the probe
 * goes on. The result is printed and written to PROBE_REPORT (default windows-probe-report.json).
 *
 *   pnpm --filter @bukitjalil/server exec tsx spikes/windows-probe.ts
 *
 * PROBE_OFFLINE=1 skips the downloads (a syntax check on another platform). Nothing here changes the repo;
 * everything is created in a temporary directory.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BUKIT_VERSION, download, installFiles, packageForPlatform, packageUrl, readPackage, verifySha256 } from "../src/bukit/install.ts";
import { probeBukitVersion } from "../src/bukit/locate.ts";
import { RG_VERSION } from "../src/agent/rg.ts";

interface StepResult {
  name: string;
  ok: boolean;
  detail: unknown;
}

const results: StepResult[] = [];
const offline = process.env.PROBE_OFFLINE === "1";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "bukitjalil-probe-"));

async function step(name: string, fn: () => unknown | Promise<unknown>): Promise<void> {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
    console.log(`PASS ${name}`);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    results.push({ name, ok: false, detail });
    console.log(`FAIL ${name}: ${detail.split("\n")[0]}`);
  }
}

interface RunResult {
  status: number | null;
  signal: string | null;
  error: string | null;
  stdout: string;
  stderr: string;
}

function run(cmd: string, args: string[], opts: { cwd?: string; env: Record<string, string>; timeoutMs?: number }): RunResult {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd,
    env: opts.env,
    encoding: "utf8",
    shell: false,
    timeout: opts.timeoutMs ?? 120_000,
    windowsHide: true,
  });
  return {
    status: r.status,
    signal: r.signal,
    error: r.error ? `${(r.error as NodeJS.ErrnoException).code ?? ""} ${r.error.message}`.trim() : null,
    stdout: r.stdout?.slice(0, 2000) ?? "",
    stderr: r.stderr?.slice(0, 2000) ?? "",
  };
}

/** What BukitJalil passes today (bukit/runner.ts, bukit/locate.ts): Unix PATH and no Windows variables. */
const todayEnv = (tmp: string, extraPath: string[] = []): Record<string, string> => ({
  PATH: [...extraPath, "/usr/bin", "/bin"].join(path.delimiter),
  HOME: root,
  LANG: "C.UTF-8",
  TMPDIR: tmp,
  DOTNET_CLI_TELEMETRY_OPTOUT: "1",
});

/** The variables a Windows program needs on top (the list smoke-test.mjs already keeps). */
const windowsExtras = (): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const k of ["SystemRoot", "SystemDrive", "windir", "ComSpec", "PATHEXT", "TEMP", "TMP", "USERPROFILE"]) {
    const v = process.env[k] ?? process.env[k.toUpperCase()];
    if (v) out[k] = v;
  }
  return out;
};

const tmp = path.join(root, "tmp");
fs.mkdirSync(tmp, { recursive: true });
let bukitBin: string | null = null;
let gitExe: string | null = null;

await step("platform", () => ({
  platform: process.platform,
  arch: process.arch,
  release: os.release(),
  node: process.version,
  user: os.userInfo().username,
  home: os.homedir(),
  tmpdir: os.tmpdir(),
  isAdmin:
    process.platform === "win32" ? run("net", ["session"], { env: process.env as Record<string, string> }).status === 0 : null,
}));

await step("git: locate", () => {
  const cmd = process.platform === "win32" ? "where" : "which";
  const r = run(cmd, ["git"], { env: process.env as Record<string, string> });
  if (r.status !== 0) throw new Error(`git not found: ${r.stderr || r.error}`);
  gitExe = r.stdout.split(/\r?\n/)[0]?.trim() ?? null;
  if (!gitExe) throw new Error("empty where output");
  const dir = path.dirname(gitExe);
  return { gitExe, dirEntries: fs.readdirSync(dir).slice(0, 40) };
});

await step("git: version under today's env (PATH=gitdir:/usr/bin:/bin, no SystemRoot)", () => {
  if (!gitExe) throw new Error("no git");
  const emptyFile = path.join(root, "empty");
  fs.writeFileSync(emptyFile, "");
  const env = {
    PATH: [path.dirname(gitExe), "/usr/bin", "/bin"].join(path.delimiter),
    HOME: root,
    LANG: "C",
    LC_ALL: "C",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: emptyFile,
    GIT_TERMINAL_PROMPT: "0",
  };
  const today = run(gitExe, ["--version"], { env });
  const withWin = run(gitExe, ["--version"], { env: { ...env, ...windowsExtras() } });
  if (today.status !== 0) throw new Error(JSON.stringify({ today, withWindowsVariables: withWin }));
  return { today, withWindowsVariables: withWin };
});

await step("symlink (bukit/runner.ts:210 makes one to git)", () => {
  const target = path.join(root, "target.txt");
  fs.writeFileSync(target, "x");
  const link = path.join(root, "link.txt");
  try {
    fs.symlinkSync(target, link);
  } catch (err) {
    const priv = process.platform === "win32" ? run("whoami", ["/priv"], { env: process.env as Record<string, string> }).stdout : "";
    throw new Error(`${(err as Error).message}\n${priv}`);
  }
  // This runner is usually an administrator, so success here does not prove an ordinary user can do it.
  return { created: true, note: "runner may be admin; an ordinary user needs Developer Mode or the privilege" };
});

await step("permissions: mkdir 0o700, file 0o600, chmod", () => {
  const dir = path.join(root, "perm");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, "secret.json");
  fs.writeFileSync(file, "{}", { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  const mode = (fs.statSync(file).mode & 0o777).toString(8);
  const acl = process.platform === "win32" ? run("icacls", [file], { env: process.env as Record<string, string> }).stdout : "";
  return { reportedMode: mode, acl };
});

await step("directory fsync (store/json-file.ts does it best effort)", () => {
  const fd = fs.openSync(root, "r");
  try {
    fs.fsyncSync(fd);
    return "directory fsync works";
  } finally {
    fs.closeSync(fd);
  }
});

await step("bukit: today's probeBukitVersion (what fetch-bukit and the packaging script call)", async () => {
  const layout = packageForPlatform();
  if (!layout) throw new Error("no official package for this platform");
  if (offline) return "offline: skipped";
  const data = await download(packageUrl(layout), () => {});
  verifySha256(data, layout.sha256);
  const files = readPackage(layout, data);
  const target = path.join(root, `bukit-${BUKIT_VERSION}`);
  installFiles(files, target, layout.executable);
  bukitBin = path.join(target, layout.executable);
  const printed = await probeBukitVersion(bukitBin, tmp);
  if (printed !== BUKIT_VERSION) throw new Error(`probe printed ${JSON.stringify(printed)}, expected ${BUKIT_VERSION}`);
  return { bukitBin, printed };
});

await step("bukit: version with today's env vs with Windows variables", () => {
  if (!bukitBin) throw new Error("bukit not installed (previous step)");
  const today = run(bukitBin, ["version"], { env: todayEnv(tmp) });
  const withWin = run(bukitBin, ["version"], { env: { ...todayEnv(tmp), ...windowsExtras() } });
  return { today, withWindowsVariables: withWin };
});

await step("bukit: new site, git commit, build (PATH = git's own directory)", () => {
  if (!bukitBin || !gitExe) throw new Error("bukit or git missing");
  const gitDir = path.dirname(gitExe);
  const site = path.join(root, "site");
  const env = { ...todayEnv(tmp, [gitDir]), ...windowsExtras() };
  const created = run(bukitBin, ["new", site, "--title=Probe", "--language=en"], { cwd: tmp, env });
  if (created.status !== 0) throw new Error(`bukit new: ${JSON.stringify(created)}`);
  const git = (args: string[]) => run(gitExe as string, ["-C", site, ...args], { env: { ...env, GIT_TERMINAL_PROMPT: "0" } });
  const steps = [
    git(["init", "-q"]),
    git(["-c", "user.name=Probe", "-c", "user.email=probe@example.com", "add", "-A"]),
    git(["-c", "user.name=Probe", "-c", "user.email=probe@example.com", "commit", "-q", "-m", "init"]),
  ];
  const built = run(
    bukitBin,
    ["build", "--config", "site.yaml", "--output", ".bukitjalil-build/p1", "--base-url", "/", "--no-clean", "--log-format", "json"],
    { cwd: site, env, timeoutMs: 180_000 },
  );
  const index = fs.existsSync(path.join(site, ".bukitjalil-build", "p1", "index.html"));
  if (built.status !== 0 || !index) throw new Error(JSON.stringify({ gitSteps: steps.map((s) => s.status), built, index }));
  return { built: built.status, index };
});

await step(`rg ${RG_VERSION}: Windows zip (agent/rg.ts has no win32-x64 entry yet)`, async () => {
  if (offline) return "offline: skipped";
  const name = `ripgrep-${RG_VERSION}-x86_64-pc-windows-msvc`;
  const url = `https://github.com/BurntSushi/ripgrep/releases/download/${RG_VERSION}/${name}.zip`;
  const data = await download(url, () => {});
  const sha256 = createHash("sha256").update(data).digest("hex");
  const zip = path.join(root, `${name}.zip`);
  fs.writeFileSync(zip, data);
  const out = path.join(root, "rg");
  fs.mkdirSync(out);
  // bsdtar (Windows 10+) reads zip files; the app itself will use the strict reader in bukit/install.ts.
  execFileSync("tar", ["-xf", zip, "-C", out], { stdio: "ignore" });
  const listing: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(dir, e.name), `${prefix}${e.name}/`);
      else listing.push(`${prefix}${e.name}`);
    }
  };
  walk(out, "");
  const rg = path.join(out, name, "rg.exe");
  const bytes = fs.readFileSync(rg);
  const version = run(rg, ["--version"], { env: { ...todayEnv(tmp), ...windowsExtras() } });
  return {
    url,
    zipSha256: sha256,
    rgSha256: createHash("sha256").update(bytes).digest("hex"),
    rgSize: bytes.length,
    listing,
    version: version.stdout.split(/\r?\n/)[0],
  };
});

const report = { when: new Date().toISOString(), platform: process.platform, arch: process.arch, results };
const reportFile = process.env.PROBE_REPORT ?? "windows-probe-report.json";
fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} steps passed; report: ${path.resolve(reportFile)}`);
console.log(`temporary directory kept for inspection: ${root}`);
