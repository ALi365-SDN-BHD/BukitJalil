import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { silentLogger } from "../src/log.ts";
import { UpdateService } from "../src/updates/service.ts";

const RELEASE = "https://github.com/ALi365-SDN-BHD/BukitJalil/releases";
const BYTES = Buffer.from("installer bytes");
const HASH = createHash("sha256").update(BYTES).digest("hex");
const DMG = "BukitJalil-0.1.0-beta.5-mac-arm64.dmg";
const EXE = "BukitJalil-0.1.0-beta.5-win-x64.exe";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function asset(name: string, size = BYTES.length) {
  return { name, size, browser_download_url: `${RELEASE}/download/v0.1.0-beta.5/${name}` };
}

function release(version: string, options: { draft?: boolean; prerelease?: boolean; assets?: unknown[] } = {}) {
  return {
    tag_name: `v${version}`,
    draft: options.draft ?? false,
    prerelease: options.prerelease ?? version.includes("-"),
    published_at: "2026-11-16T00:00:00Z",
    html_url: `${RELEASE}/tag/v${version}`,
    assets: options.assets ?? [asset(`BukitJalil-${version}-mac-arm64.dmg`), asset("SHA256SUMS.txt")],
  };
}

function service(options: {
  currentVersion?: string;
  releases?: unknown[];
  fetchImpl?: typeof fetch | null;
  platform?: NodeJS.Platform;
  arch?: string;
  linuxPackage?: "appimage" | "deb";
  openInstaller?: ((file: string) => Promise<string | null>) | null;
}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bj-update-"));
  dirs.push(dir);
  return {
    dir,
    updates: new UpdateService({
      currentVersion: options.currentVersion ?? "0.1.0-beta.4",
      dir,
      fetchImpl:
        options.fetchImpl === undefined ? fakeFetch(options.releases ?? [release("0.1.0-beta.5")]) : options.fetchImpl,
      logger: silentLogger,
      openInstaller: options.openInstaller ?? null,
      platform: options.platform ?? "darwin",
      arch: options.arch ?? "arm64",
      linuxPackage: options.linuxPackage,
    }),
  };
}

function fakeFetch(releases: unknown[], hash = HASH, name = DMG, bytes = BYTES): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("/releases?")) return Response.json(releases);
    if (url.endsWith("SHA256SUMS.txt")) return new Response(`${hash}  ${name}\n`);
    if (url.endsWith(name)) return new Response(bytes, { status: 200 });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

describe("UpdateService", () => {
  it("selects the newest beta and its macOS dmg with the release checksum", async () => {
    const { updates } = service({});
    const status = await updates.check(true);
    expect(status.state).toMatchObject({
      phase: "available",
      release: { version: "0.1.0-beta.5", asset: { name: DMG, sha256: HASH } },
    });
    expect(status.checkedAt).not.toBeNull();
  });

  it("does not offer a beta to a stable install", async () => {
    const releases = [
      { ...release("0.1.1-beta.1"), assets: [asset("BukitJalil-0.1.1-beta.1-mac-arm64.dmg"), asset("SHA256SUMS.txt")] },
      release("0.1.1"),
    ];
    const { updates } = service({
      currentVersion: "0.1.0",
      releases,
      fetchImpl: fakeFetch(releases, HASH, "BukitJalil-0.1.1-mac-arm64.dmg"),
    });
    const status = await updates.check(true);
    expect(status.state).toMatchObject({ phase: "available", release: { version: "0.1.1" } });
  });

  it("ignores drafts and versions that are not newer", async () => {
    const { updates } = service({
      releases: [release("0.1.0-beta.5", { draft: true }), release("0.1.0-beta.4")],
    });
    const status = await updates.check(true);
    expect(status.state).toEqual({ phase: "idle" });
  });

  it("reports a missing platform asset", async () => {
    const { updates } = service({
      releases: [
        release("0.1.0-beta.5", { assets: [asset("BukitJalil-0.1.0-beta.5-mac-x64.dmg"), asset("SHA256SUMS.txt")] }),
      ],
    });
    const status = await updates.check(true);
    expect(status.state).toMatchObject({ phase: "error", operation: "check", code: "update.no_asset" });
  });

  it("does not accept a beta asset for a stable release", async () => {
    const releases = [
      release("0.1.0", {
        assets: [asset("BukitJalil-0.1.0-beta.5-mac-arm64.dmg"), asset("SHA256SUMS.txt")],
      }),
    ];
    const { updates } = service({ currentVersion: "0.0.9", releases });
    const status = await updates.check(true);
    expect(status.state).toMatchObject({ phase: "error", operation: "check", code: "update.no_asset" });
  });

  it("rejects an asset whose name does not contain the release version", async () => {
    const releases = [
      release("0.1.0-beta.5", {
        assets: [asset("BukitJalil-0.1.0-beta.4-mac-arm64.dmg"), asset("SHA256SUMS.txt")],
      }),
    ];
    const { updates } = service({ releases });
    const status = await updates.check(true);
    expect(status.state).toMatchObject({ phase: "error", operation: "check", code: "update.no_asset" });
  });

  it("downloads, verifies and exposes the installer", async () => {
    const opened: string[] = [];
    const { dir, updates } = service({
      openInstaller: async (file) => {
        opened.push(file);
        return null;
      },
    });
    fs.mkdirSync(path.join(dir, "0.1.0-beta.2"), { recursive: true });
    await updates.check(true);
    updates.startDownload();
    await updates.waitForDownload();
    const state = updates.status().state;
    expect(state).toMatchObject({
      phase: "downloaded",
      release: { version: "0.1.0-beta.5", asset: { format: "dmg" } },
      fileName: DMG,
    });
    const file = path.join(dir, "0.1.0-beta.5", DMG);
    expect(fs.readFileSync(file)).toEqual(BYTES);
    expect(fs.existsSync(path.join(dir, "0.1.0-beta.2"))).toBe(false);
    await updates.open();
    expect(opened).toEqual([file]);
  });

  it("reports an open failure instead of claiming success", async () => {
    const { updates } = service({ openInstaller: async () => "cannot open" });
    await updates.check(true);
    updates.startDownload();
    await updates.waitForDownload();
    const status = await updates.open();
    expect(status.state).toMatchObject({ phase: "error", operation: "open", code: "update.open_failed" });
  });

  it("discards a same-size damaged installer before opening and can download a fresh one", async () => {
    const opened: string[] = [];
    const { dir, updates } = service({
      openInstaller: async (file) => {
        opened.push(file);
        return null;
      },
    });
    await updates.check(true);
    updates.startDownload();
    await updates.waitForDownload();
    const file = path.join(dir, "0.1.0-beta.5", DMG);
    fs.writeFileSync(file, Buffer.alloc(BYTES.length));
    expect((await updates.open()).state).toMatchObject({
      phase: "error",
      operation: "download",
      code: "update.checksum_mismatch",
    });
    expect(opened).toEqual([]);
    expect(fs.existsSync(file)).toBe(false);
    updates.startDownload();
    await updates.waitForDownload();
    await updates.open();
    expect(opened).toEqual([file]);
    expect(fs.readFileSync(file)).toEqual(BYTES);
  });

  it("removes interrupted .part files at startup", async () => {
    const { dir, updates } = service({});
    const versionDir = path.join(dir, "0.1.0-beta.5");
    fs.mkdirSync(versionDir, { recursive: true });
    fs.writeFileSync(path.join(versionDir, `${DMG}.part`), "partial");
    await updates.cleanup();
    expect(fs.existsSync(versionDir)).toBe(false);
  });

  it("downloads only after the startup cleanup, which would otherwise delete the new .part file", async () => {
    // An interrupted download of the same version is left over, and the installer arrives slowly: without
    // waiting, the cleanup reaches that folder while the new .part file is being written and deletes it.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bj-update-"));
    dirs.push(dir);
    fs.mkdirSync(path.join(dir, "0.1.0-beta.5"));
    fs.writeFileSync(path.join(dir, "0.1.0-beta.5", `${DMG}.part`), "partial");
    const quick = fakeFetch([release("0.1.0-beta.5")]);
    const slow = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (!url.endsWith(DMG)) return quick(input, init);
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(BYTES.subarray(0, 1));
          await new Promise((resolve) => setTimeout(resolve, 100));
          controller.enqueue(BYTES.subarray(1));
          controller.close();
        },
      });
      return new Response(body);
    }) as typeof fetch;
    const updates = new UpdateService({
      currentVersion: "0.1.0-beta.4",
      dir,
      fetchImpl: slow,
      logger: silentLogger,
      openInstaller: null,
      platform: "darwin",
      arch: "arm64",
    });
    await updates.check(true);
    updates.startDownload();
    await updates.waitForDownload();
    expect(updates.status().state).toMatchObject({ phase: "downloaded" });
    expect(fs.readFileSync(path.join(dir, "0.1.0-beta.5", DMG))).toEqual(BYTES);
  });

  it.each([false, true])("verifies cached bytes before reuse (damaged: %s)", async (damaged) => {
    const first = service({});
    await first.updates.check(true);
    first.updates.startDownload();
    await first.updates.waitForDownload();
    const file = path.join(first.dir, "0.1.0-beta.5", DMG);
    fs.writeFileSync(`${file}.sha256`, `${HASH}\n`); // Legacy cache metadata.
    if (damaged) fs.writeFileSync(file, Buffer.alloc(BYTES.length));

    let downloads = 0;
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/releases?")) return Response.json([release("0.1.0-beta.5")]);
      if (url.endsWith("SHA256SUMS.txt")) return new Response(`${HASH}  ${DMG}\n`);
      if (url.endsWith(DMG)) {
        downloads++;
        return new Response(BYTES);
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    const second = new UpdateService({
      currentVersion: "0.1.0-beta.4",
      dir: first.dir,
      fetchImpl,
      logger: silentLogger,
      openInstaller: null,
      platform: "darwin",
      arch: "arm64",
    });
    await second.check(true);
    second.startDownload();
    await second.waitForDownload();
    expect(second.status().state.phase).toBe("downloaded");
    expect(downloads).toBe(damaged ? 1 : 0);
    expect(fs.readFileSync(file)).toEqual(BYTES);
  });

  it("deletes a file whose checksum does not match", async () => {
    const { dir, updates } = service({
      fetchImpl: fakeFetch([release("0.1.0-beta.5")], "0".repeat(64)),
    });
    await updates.check(true);
    updates.startDownload();
    await updates.waitForDownload();
    expect(updates.status().state).toMatchObject({
      phase: "error",
      operation: "download",
      code: "update.checksum_mismatch",
    });
    expect(fs.existsSync(path.join(dir, "0.1.0-beta.5", DMG))).toBe(false);
  });

  it("reports a checksum server error as a check failure", async () => {
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/releases?")) return Response.json([release("0.1.0-beta.5")]);
      if (url.endsWith("SHA256SUMS.txt")) return new Response("busy", { status: 500 });
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    const { updates } = service({ fetchImpl });
    const status = await updates.check(true);
    expect(status.state).toMatchObject({ phase: "error", operation: "check", code: "update.check_failed" });
  });

  it("reports a full disk while downloading", async () => {
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/releases?")) return Response.json([release("0.1.0-beta.5")]);
      if (url.endsWith("SHA256SUMS.txt")) return new Response(`${HASH}  ${DMG}\n`);
      if (url.endsWith(DMG)) {
        throw Object.assign(new Error("no space"), { code: "ENOSPC" });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    const { updates } = service({ fetchImpl });
    await updates.check(true);
    updates.startDownload();
    await updates.waitForDownload();
    expect(updates.status().state).toMatchObject({
      phase: "error",
      operation: "download",
      code: "fs.disk_full",
    });
  });

  it("does not start a download while a check is running", async () => {
    let finish!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/releases?")) return pending;
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    const { updates } = service({ fetchImpl });
    const checking = updates.check(true);
    expect(updates.status().state.phase).toBe("checking");
    expect(updates.startDownload().state).toMatchObject({
      phase: "error",
      operation: "download",
      code: "update.not_available",
    });
    finish(Response.json([release("0.1.0-beta.5")]));
    await checking;
  });

  it("keeps the footer quiet when an automatic check fails", async () => {
    const { updates } = service({
      fetchImpl: (async () => {
        throw new Error("offline");
      }) as typeof fetch,
    });
    const status = await updates.check(true, false);
    expect(status.state).toEqual({ phase: "idle" });
  });

  it("reports a failed manual check", async () => {
    const { updates } = service({
      fetchImpl: (async () => {
        throw new Error("offline");
      }) as typeof fetch,
    });
    const status = await updates.check(true);
    expect(status.state).toMatchObject({ phase: "error", operation: "check", code: "update.check_failed" });
  });

  it("reports an offline check", async () => {
    const { updates } = service({ fetchImpl: null });
    const status = await updates.check(true);
    expect(status.state).toMatchObject({ phase: "error", operation: "check", code: "update.offline" });
  });

  it("selects the Linux AppImage", async () => {
    const appImage = "BukitJalil-0.1.0-beta.5-linux-x86_64.AppImage";
    const releases = [release("0.1.0-beta.5", { assets: [asset(appImage), asset("SHA256SUMS.txt")] })];
    const { updates } = service({
      platform: "linux",
      arch: "x64",
      linuxPackage: "appimage",
      releases,
      fetchImpl: fakeFetch(releases, HASH, appImage),
    });
    const status = await updates.check(true);
    expect(status.state).toMatchObject({
      phase: "available",
      release: { asset: { name: appImage, format: "appimage" } },
    });
  });

  it("selects the deb for a deb install when both Linux packages exist", async () => {
    const appImage = "BukitJalil-0.1.0-beta.5-linux-x86_64.AppImage";
    const deb = "BukitJalil-0.1.0-beta.5-linux-amd64.deb";
    const releases = [release("0.1.0-beta.5", { assets: [asset(appImage), asset(deb), asset("SHA256SUMS.txt")] })];
    const { updates } = service({
      platform: "linux",
      arch: "x64",
      linuxPackage: "deb",
      releases,
      fetchImpl: fakeFetch(releases, HASH, deb),
    });
    const status = await updates.check(true);
    expect(status.state).toMatchObject({ phase: "available", release: { asset: { name: deb, format: "deb" } } });
  });

  it("selects the package of the machine's architecture", async () => {
    const cases = [
      { platform: "darwin", arch: "x64", want: "mac-x64.dmg", format: "dmg", other: "mac-arm64.dmg" },
      {
        platform: "linux",
        arch: "arm64",
        want: "linux-arm64.AppImage",
        format: "appimage",
        other: "linux-x86_64.AppImage",
      },
      { platform: "linux", arch: "arm64", want: "linux-arm64.deb", format: "deb", other: "linux-amd64.deb" },
    ] as const;
    for (const c of cases) {
      const want = `BukitJalil-0.1.0-beta.5-${c.want}`;
      const releases = [
        release("0.1.0-beta.5", {
          assets: [asset(`BukitJalil-0.1.0-beta.5-${c.other}`), asset(want), asset("SHA256SUMS.txt")],
        }),
      ];
      const { updates } = service({
        platform: c.platform,
        arch: c.arch,
        linuxPackage: c.format === "deb" ? "deb" : "appimage",
        releases,
        fetchImpl: fakeFetch(releases, HASH, want),
      });
      const status = await updates.check(true);
      expect(status.state, want).toMatchObject({
        phase: "available",
        release: { asset: { name: want, format: c.format } },
      });
    }
  });

  it("selects the Windows installer for Windows", async () => {
    const { updates } = service({
      platform: "win32",
      arch: "x64",
      releases: [release("0.1.0-beta.5", { assets: [asset(EXE), asset("SHA256SUMS.txt")] })],
      fetchImpl: fakeFetch([release("0.1.0-beta.5", { assets: [asset(EXE), asset("SHA256SUMS.txt")] })], HASH, EXE),
    });
    const status = await updates.check(true);
    expect(status.state).toMatchObject({ phase: "available", release: { asset: { name: EXE, format: "exe" } } });
  });
});
