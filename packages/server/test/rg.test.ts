import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { RG_PACKAGES, RG_VERSION, type RgPackage, RgService, rgArchiveLayout } from "../src/agent/rg.ts";
import { makeApp, req } from "./helpers.ts";
import { tarEntry, tgz } from "./tar.ts";

const base = fs.mkdtempSync(path.join(os.tmpdir(), "bj-rg-"));
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

const sha = (data: Buffer | string) => crypto.createHash("sha256").update(data).digest("hex");
const posix = process.platform !== "win32";

/** A stand-in for the rg binary: prints what `rg --version` prints. */
const fakeRg = (version = RG_VERSION) => `#!/bin/sh\necho "ripgrep ${version} (rev test)"\n`;

/** A release archive with the real layout, its rg replaced by `rg`; `extra` adds unexpected entries. */
function archive(target: string, rg: string, extra: Buffer[] = []): Buffer {
  const { files, dirs } = rgArchiveLayout({ target, sha256: "", rgSha256: "", rgSize: 0 });
  return tgz(
    ...dirs.map((d) => tarEntry(`${d}/`, "", "5")),
    ...files.map((f) => tarEntry(f, f.endsWith("/rg") ? rg : `text of ${f}`, "0", f.endsWith("/rg") ? 0o755 : 0o644)),
    ...extra,
  );
}

let n = 0;
/** An RgService for a fake "test" target, served by a fake fetch that records the URLs it was asked for. */
function setup(opts: { rg?: string; data?: Buffer; pkg?: Partial<RgPackage>; platform?: string } = {}) {
  const rg = opts.rg ?? fakeRg();
  const data = opts.data ?? archive("test-target", rg);
  const pkg: RgPackage = {
    target: "test-target",
    sha256: sha(data),
    rgSha256: sha(rg),
    rgSize: Buffer.byteLength(rg),
    ...opts.pkg,
  };
  const urls: string[] = [];
  const fetchImpl = (async (url: string) => {
    urls.push(url);
    return new Response(new Uint8Array(data));
  }) as unknown as typeof fetch;
  const piBin = path.join(base, `pi-${++n}`, "bin");
  const service = new RgService({
    piBin,
    platform: opts.platform ?? "testos",
    arch: "x64",
    fetchImpl,
    packages: { "testos-x64": pkg },
  });
  return { service, urls, piBin, rg };
}

async function install(service: RgService) {
  expect(service.installer.start()).toBe(true);
  await service.installer.wait();
  return service.installer.progress;
}

describe("pinned packages", () => {
  it("has full SHA-256 values for macOS and Linux, arm64 and x64", () => {
    expect(Object.keys(RG_PACKAGES).sort()).toEqual(["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"]);
    for (const pkg of Object.values(RG_PACKAGES)) {
      expect(pkg.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(pkg.rgSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(pkg.sha256).not.toBe(pkg.rgSha256);
      expect(pkg.rgSize).toBeGreaterThan(1_000_000);
    }
  });
});

describe.skipIf(!posix)("RgService", () => {
  it("installs the pinned rg after checking the archive, the binary and its version", async () => {
    const { service, urls, piBin } = setup();
    expect(service.status()).toEqual({ state: "missing", version: RG_VERSION, installable: true });
    expect(service.ready()).toBe(false);

    expect(await install(service)).toEqual({ state: "done" });
    expect(urls).toEqual([
      `https://github.com/BurntSushi/ripgrep/releases/download/${RG_VERSION}/ripgrep-${RG_VERSION}-test-target.tar.gz`,
    ]);
    const rgPath = path.join(piBin, "rg");
    expect(fs.statSync(rgPath).mode & 0o777).toBe(0o755);
    // Only rg is installed; no staging files are left behind.
    expect(fs.readdirSync(piBin)).toEqual(["rg"]);
    expect(service.status().state).toBe("ok");
    expect(service.ready()).toBe(true);
  });

  it("stops trusting rg once the file changes", async () => {
    const { service, piBin, rg } = setup();
    await install(service);
    const rgPath = path.join(piBin, "rg");

    fs.writeFileSync(rgPath, `${rg}# changed\n`);
    expect(service.status().state).toBe("mismatch");
    expect(service.ready()).toBe(false);
    // Same size, different content: caught by the SHA-256.
    fs.writeFileSync(rgPath, rg.replace("ripgrep", "RIPGREP"));
    expect(service.status().state).toBe("mismatch");

    fs.writeFileSync(rgPath, rg);
    fs.chmodSync(rgPath, 0o755);
    expect(service.ready()).toBe(true);
    fs.chmodSync(rgPath, 0o644);
    expect(service.ready()).toBe(false);

    fs.rmSync(rgPath);
    fs.symlinkSync(path.join(base, "elsewhere"), rgPath);
    expect(service.status().state).toBe("mismatch");
    fs.rmSync(rgPath);
    expect(service.status().state).toBe("missing");
  });

  it("refuses an archive whose SHA-256 does not match", async () => {
    const { service, piBin } = setup({ pkg: { sha256: "0".repeat(64) } });
    expect(await install(service)).toMatchObject({ state: "failed", code: "checksum_mismatch" });
    expect(fs.existsSync(path.join(piBin, "rg"))).toBe(false);
  });

  it("refuses an rg binary whose SHA-256 does not match, even in a matching archive", async () => {
    const { service, piBin } = setup({ pkg: { rgSha256: "1".repeat(64) } });
    expect(await install(service)).toMatchObject({ state: "failed", code: "checksum_mismatch" });
    expect(fs.existsSync(path.join(piBin, "rg"))).toBe(false);
  });

  it("refuses archives with entries outside the release layout", async () => {
    const root = `ripgrep-${RG_VERSION}-test-target`;
    for (const extra of [
      tarEntry(`${root}/extra`, "x"),
      tarEntry(`${root}/other/`, "", "5"),
      tarEntry(`${root}/link`, "", "2"),
      tarEntry("../evil", "x"),
    ]) {
      const { service, piBin } = setup({ data: archive("test-target", fakeRg(), [extra]) });
      expect(await install(service)).toMatchObject({ state: "failed", code: "bad_archive" });
      expect(fs.existsSync(path.join(piBin, "rg"))).toBe(false);
    }
  });

  it("removes rg when it does not report the pinned version", async () => {
    const { service, piBin } = setup({ rg: fakeRg("15.1.0") });
    expect(await install(service)).toMatchObject({ state: "failed", code: "verify_failed" });
    expect(fs.existsSync(path.join(piBin, "rg"))).toBe(false);
    expect(service.status().state).toBe("missing");
  });

  it("keeps a verified rg when rg --version cannot run, and says so", async () => {
    const { service, piBin } = setup({ rg: "#!/bin/sh\nexit 3\n" });
    expect(await install(service)).toMatchObject({
      state: "failed",
      code: "verify_failed",
      message: expect.stringContaining("exit code 3"),
    });
    expect(fs.existsSync(path.join(piBin, "rg"))).toBe(true);
    expect(service.status().state).toBe("ok");
  });

  it("replaces a directory where rg belongs", async () => {
    const { service, piBin } = setup();
    fs.mkdirSync(path.join(piBin, "rg", "inner"), { recursive: true });
    expect(service.status().state).toBe("mismatch");
    expect(await install(service)).toEqual({ state: "done" });
    expect(service.status().state).toBe("ok");
  });

  it("has nothing to install on other platforms", async () => {
    const { service } = setup({ platform: "win32" });
    expect(service.status()).toEqual({ state: "missing", version: RG_VERSION, installable: false });
    expect(await install(service)).toMatchObject({ state: "failed", code: "unsupported_platform" });
  });
});

describe.skipIf(!posix)("/api/rg", () => {
  const post = () =>
    req("/api/rg/install", {
      method: "POST",
      body: "{}",
      headers: { "content-type": "application/json", "x-bukitjalil": "1", origin: "http://127.0.0.1:47880" },
    });

  it("reports status and install progress; one install at a time", async () => {
    const { service } = setup();
    const { app, db } = makeApp({ rg: service });
    const first = await (await app.fetch(req("/api/rg"))).json();
    expect(first).toEqual({
      status: { state: "missing", version: RG_VERSION, installable: true },
      install: { state: "idle" },
    });

    expect((await app.fetch(post())).status).toBe(202);
    const again = await app.fetch(post());
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ code: "rg.install_running" });
    await service.installer.wait();
    const after = await (await app.fetch(req("/api/rg"))).json();
    expect(after).toEqual({
      status: { state: "ok", version: RG_VERSION, installable: true },
      install: { state: "done" },
    });
    db.close();
  });

  it("answers 400 where no package is pinned", async () => {
    const { service } = setup({ platform: "win32" });
    const { app, db } = makeApp({ rg: service });
    const res = await app.fetch(post());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: "rg.unsupported_platform" });
    db.close();
  });
});
