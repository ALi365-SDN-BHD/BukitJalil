import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { gitGuide } from "../src/git/platform.ts";
import { GitService } from "../src/git/service.ts";
import type { GitHealth } from "../src/git/version.ts";
import { ADMIN, makeApp, req } from "./helpers.ts";

// Git status and Homebrew install/update, without running brew or touching the network.

const healthy = (version = "2.39.5"): GitHealth => ({ ok: true, version, problem: null });
const brew = "/tmp/bj-fake-brew/bin/brew";

const latestFetch = (version = "2.56.1", calls?: { count: number }) =>
  (async () => {
    if (calls) calls.count++;
    return new Response(`<a href="git-${version}.tar.gz">git-${version}.tar.gz</a>`, {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  }) as unknown as typeof fetch;

describe("GitService", () => {
  it("offers an update when Homebrew has a newer Git", async () => {
    const service = new GitService({
      fetchImpl: latestFetch(),
      brew: "/opt/homebrew/bin/brew",
      resolvePath: () => "/opt/homebrew/bin/git",
      check: async () => healthy(),
    });
    await expect(service.status()).resolves.toMatchObject({
      path: "/opt/homebrew/bin/git",
      version: "2.39.5",
      latestVersion: "2.56.1",
      source: "homebrew",
      state: "ok",
      installable: true,
      updatable: true,
    });
  });

  it("reports missing, broken, too old and up-to-date states", async () => {
    const missing = new GitService({ fetchImpl: latestFetch(), brew, resolvePath: () => null });
    await expect(missing.status()).resolves.toMatchObject({ state: "missing", installable: true, updatable: true });

    const broken = new GitService({
      fetchImpl: latestFetch(),
      brew,
      resolvePath: () => "/usr/bin/git",
      check: async () => ({ ok: false, version: null, problem: "missing" }),
    });
    await expect(broken.status()).resolves.toMatchObject({ state: "broken" });

    const old = new GitService({
      fetchImpl: latestFetch(),
      brew,
      resolvePath: () => "/usr/bin/git",
      check: async () => ({ ok: false, version: "2.30.0", problem: "too_old" }),
    });
    await expect(old.status()).resolves.toMatchObject({
      source: "system",
      state: "too_old",
      updatable: true,
    });

    const current = new GitService({
      fetchImpl: latestFetch("2.39.5"),
      brew,
      resolvePath: () => "/usr/bin/git",
      check: async () => healthy(),
    });
    await expect(current.status()).resolves.toMatchObject({ updatable: false });
  });

  it("caches the latest version and refreshes on demand", async () => {
    const calls = { count: 0 };
    let now = 1_000_000;
    const service = new GitService({
      fetchImpl: latestFetch("2.56.1", calls),
      brew,
      resolvePath: () => "/usr/bin/git",
      check: async () => healthy(),
      now: () => now,
    });
    await service.status();
    expect(calls.count).toBe(1);
    now += 5 * 60_000;
    await service.status();
    expect(calls.count).toBe(1);
    await service.status(true);
    expect(calls.count).toBe(2);
  });

  it("uses the platform package manager when Homebrew is absent", async () => {
    const service = new GitService({
      fetchImpl: latestFetch(),
      brew: null,
      platform: "linux",
      manager: "apt",
      resolvePath: () => "/usr/bin/git",
      check: async () => healthy(),
    });
    await expect(service.status()).resolves.toMatchObject({
      platform: "linux",
      packageManager: "apt",
      latestVersion: "2.56.1",
      installable: false,
      updatable: false,
      guide: [{ title: "Debian / Ubuntu (apt)" }],
    });
  });

  it("reports unknown latest and no update when offline", async () => {
    const service = new GitService({
      fetchImpl: null,
      brew,
      resolvePath: () => "/usr/bin/git",
      check: async () => healthy(),
    });
    await expect(service.status()).resolves.toMatchObject({
      latestVersion: null,
      updatable: false,
      installable: true,
    });
  });

  it("runs brew install and makes the new path current", async () => {
    const applied: string[] = [];
    const calls: string[][] = [];
    const service = new GitService({
      fetchImpl: latestFetch(),
      brew,
      runBrew: async (_brew, args) => {
        calls.push(args);
        return { code: 0, output: "installed" };
      },
      resolvePath: () => "/opt/homebrew/bin/git",
      check: async () => healthy("2.56.1"),
      applyPath: (path) => applied.push(path),
    });
    expect(service.start()).toBe(true);
    expect(service.start()).toBe(false); // one job at a time
    await service.settled();
    expect(calls).toEqual([["install", "git"]]);
    expect(applied).toEqual(["/opt/homebrew/bin/git"]);
    expect(service.install).toEqual({ state: "done", version: "2.56.1" });
  });

  it("downloads and installs the official Git for Windows MinGit package", async () => {
    const appHome = fs.mkdtempSync(path.join(os.tmpdir(), "bj-git-win-"));
    const zip = Buffer.from(
      zipSync({
        "cmd/git.exe": new Uint8Array([1, 2]),
        "ucrt64/bin/git.exe": new Uint8Array([3]),
      }),
    );
    const sha256 = crypto.createHash("sha256").update(zip).digest("hex");
    const fetchImpl = (async (url: string) => {
      if (url.includes("api.github.com/repos/git-for-windows")) {
        return new Response(
          JSON.stringify({
            tag_name: "v2.56.1.windows.1",
            assets: [
              {
                name: "MinGit-2.56.1-64-bit.zip",
                browser_download_url: "https://example.invalid/mingit.zip",
                digest: `sha256:${sha256}`,
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(zip, { status: 200, headers: { "content-length": String(zip.length) } });
    }) as typeof fetch;
    const applied: string[] = [];
    const service = new GitService({
      fetchImpl,
      brew: null,
      platform: "win32",
      arch: "x64",
      appHome,
      resolvePath: () => null,
      check: async () => healthy("2.56.1"),
      applyPath: (path) => applied.push(path),
    });
    expect(service.start()).toBe(true);
    await service.settled();
    expect(service.install).toEqual({ state: "done", version: "2.56.1" });
    const expected = path.join(appHome, "git", "current", "cmd", "git.exe");
    expect(fs.existsSync(expected)).toBe(true);
    expect(applied).toEqual([expected]);
    fs.rmSync(appHome, { recursive: true, force: true });
  });

  it("keeps brew's error visible when the install fails", async () => {
    const service = new GitService({
      fetchImpl: null,
      brew,
      runBrew: async () => ({ code: 1, output: "Error: git failed" }),
      resolvePath: () => "/usr/bin/git",
      check: async () => healthy(),
    });
    expect(service.start()).toBe(true);
    await service.settled();
    expect(service.install).toEqual({ state: "failed", message: "Error: git failed" });
  });

  it("cannot install without Homebrew", () => {
    const service = new GitService({ fetchImpl: null, brew: null, resolvePath: () => "/usr/bin/git" });
    expect(service.start()).toBe(false);
  });
});

describe("gitGuide", () => {
  it("returns commands for the current platform", () => {
    expect(gitGuide("darwin", "homebrew").map((item) => item.title)).toEqual(["Homebrew", "Xcode Command Line Tools"]);
    expect(gitGuide("darwin", "xcode")[0]?.command).toBe("xcode-select --install");
    expect(gitGuide("linux", "apt")[0]?.command).toContain("sudo apt install git");
    expect(gitGuide("linux", "dnf")[0]?.command).toContain("sudo dnf install git");
    expect(gitGuide("linux", "pacman")[0]?.command).toContain("sudo pacman -S git");
    expect(gitGuide("win32", "winget")[0]?.command).toContain("winget install --id Git.Git -e");
    expect(gitGuide("win32", "choco")[0]?.command).toContain("choco install git");
    expect(gitGuide("linux", null)).toEqual([]);
  });
});

describe("GET /api/git", () => {
  it("returns the status and refuses installs without Homebrew", async () => {
    const ctx = makeApp({
      gitBrew: null,
      gitFetch: null,
      gitResolvePath: () => "/usr/bin/git",
      gitCheck: async () => healthy(),
    });
    const status = (await (await ctx.app.fetch(req("/api/git"))).json()) as {
      status: { state: string; version: string; installable: boolean };
      install: { state: string };
    };
    expect(status).toMatchObject({
      status: { state: "ok", version: "2.39.5", installable: false },
      install: { state: "idle" },
    });
    const res = await ctx.app.fetch(
      req("/api/git/install", {
        method: "POST",
        body: "{}",
        headers: { "content-type": "application/json", "x-bukitjalil": "1", origin: ADMIN },
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "git.install_unavailable" });
    ctx.db.close();
  });
});
