// Windows port, item 0: what an ordinary (non-administrator) user can do about "a PATH directory holding only
// git" (bukit/runner.ts makes a symlink). Run as that user by windows-user-links.ps1; writes result.json to the
// directory given as the first argument.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const out = process.argv[2];
const gitExe = process.argv[3];
const root = fs.mkdtempSync(path.join(out, "links-"));
const result = { user: process.env.USERNAME, gitExe, tries: {} };

const sh = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", windowsHide: true }).slice(0, 3000);
  } catch (err) {
    return `failed: ${err.message}`.slice(0, 500);
  }
};
result.whoami = { groups: sh("whoami", ["/groups"]), privileges: sh("whoami", ["/priv"]) };

const gitRuns = (file) => {
  const r = spawnSync(file, ["--version"], { encoding: "utf8", windowsHide: true, timeout: 30000 });
  return r.status === 0 ? r.stdout.trim() : `exit ${r.status}: ${(r.stderr || r.error?.message || "").slice(0, 200)}`;
};

const attempt = (name, fn) => {
  try {
    result.tries[name] = { ok: true, detail: fn() };
  } catch (err) {
    result.tries[name] = { ok: false, detail: `${err.code ?? ""} ${err.message}`.trim().slice(0, 300) };
  }
};

attempt("file symlink to git.exe", () => {
  const link = path.join(root, "git.exe");
  fs.symlinkSync(gitExe, link, "file");
  return gitRuns(link);
});
attempt("junction to git's directory", () => {
  const link = path.join(root, "gitdir");
  fs.symlinkSync(path.dirname(gitExe), link, "junction");
  return gitRuns(path.join(link, "git.exe"));
});
attempt("hard link to git.exe", () => {
  const link = path.join(root, "hard-git.exe");
  fs.linkSync(gitExe, link);
  return gitRuns(link);
});
attempt("copy of git.exe", () => {
  const copy = path.join(root, "copy-git.exe");
  fs.copyFileSync(gitExe, copy);
  return gitRuns(copy);
});
attempt("batch shim git.cmd (Bukit starts git without a shell)", () => {
  const shim = path.join(root, "git.cmd");
  fs.writeFileSync(shim, `@"${gitExe}" %*\r\n`);
  // Process.Start-style lookup of plain "git" only finds .exe; this shows whether a .cmd even runs by name.
  const r = spawnSync("git", ["--version"], {
    env: { ...process.env, PATH: root },
    encoding: "utf8",
    windowsHide: true,
    timeout: 30000,
  });
  return r.status === 0 ? r.stdout.trim() : `exit ${r.status}: ${r.error?.code ?? ""} ${(r.stderr || "").slice(0, 100)}`;
});

fs.writeFileSync(path.join(out, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
