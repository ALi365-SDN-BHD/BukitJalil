import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { MediaUploadRequest } from "@bukitjalil/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BukitService } from "../src/bukit/locate.ts";
import { mediaDir } from "../src/media/dir.ts";
import { hasJpegLocation } from "../src/media/location.ts";
import { normalizeMediaName } from "../src/media/names.ts";
import { sniffMedia } from "../src/media/sniff.ts";
import { copyStarter } from "../src/sites/template.ts";
import { SettingsStore } from "../src/store/settings.ts";
import { ADMIN, commitAllAs, installAppBukit, makeApp, rawGit, req, testBukitDir } from "./helpers.ts";

const STARTER = path.resolve(import.meta.dirname, "../../../templates/starter");
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const FAKE_BUKIT = `#!/bin/sh
case "$1" in
  version) echo "bukit 2.2.3+fake"; exit 0;;
  config|doctor) exit 0;;
  build)
    out=""; prev=""
    for a in "$@"; do if [ "$prev" = "--output" ]; then out="$a"; fi; prev="$a"; done
    mkdir -p "$out"; echo "<h1>home</h1>" > "$out/index.html"; exit 0;;
esac
exit 1
`;

let base: string;
let ctx: ReturnType<typeof makeApp>;
let n = 0;

beforeAll(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bj-media-")));
  fs.mkdirSync(path.join(base, "home"));
  const fakeBin = path.join(base, "fake-bukit");
  fs.writeFileSync(fakeBin, FAKE_BUKIT, { mode: 0o755 });
  const home = path.join(base, "bk");
  installAppBukit(home, fakeBin);
  ctx = makeApp({
    bukit: new BukitService({ dir: testBukitDir(home), tmpDir: path.join(base, "bk-tmp") }),
    appHome: path.join(base, "app"),
    userHome: path.join(base, "home"),
  });
  new SettingsStore(ctx.db).update({ commitName: "Site Owner", commitEmail: "owner@example.com" });
});

afterAll(async () => {
  await ctx.agent.shutdown();
  await ctx.builds.shutdown();
  ctx.db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

/** A registered starter site; `prepare` runs before the first commit. */
async function makeSite(name: string, prepare?: (dir: string) => void) {
  const dir = path.join(base, "sites", `${++n}-${name}`);
  copyStarter(STARTER, dir, { title: `Media ${n}`, language: "en-US" });
  prepare?.(dir);
  rawGit(base, dir, "init", "-q", "-b", "main");
  commitAllAs(base, dir);
  const site = await ctx.sites.import({ path: dir });
  await ctx.builds.settled();
  return { ...site, dir };
}

const upload = (siteId: string, req: MediaUploadRequest) => ctx.media.upload(siteId, req);

function openChange(siteId: string) {
  const change = ctx.changes.store.open(siteId);
  if (!change) throw new Error("no open change set");
  return change;
}

async function changeFile(siteId: string, rel: string): Promise<Buffer> {
  const change = openChange(siteId);
  const cwd = await ctx.sites.aiWorktree(siteId, change.snapshotCommit, { reset: false });
  return fs.readFileSync(path.join(cwd, rel));
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (err) {
    return (err as { code?: string }).code;
  }
}

const appBase = (siteId: string, body: unknown) =>
  req(`/api/sites/${siteId}/media`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-bukitjalil": "1", origin: ADMIN },
  });

function jpegSegment(payload: Buffer): Buffer {
  const length = payload.length + 2;
  return Buffer.concat([Buffer.from([0xff, 0xe1, length >> 8, length & 0xff]), payload]);
}

function jpegWith(payload: Buffer): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xd8]), jpegSegment(payload), Buffer.from([0xff, 0xd9])]);
}

function exifPayload(): Buffer {
  // TIFF little-endian: IFD0 at 8, one entry (GPS IFD pointer 0x8825), an empty GPS IFD at 26.
  const tiff = Buffer.from([
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x25, 0x88, 0x04, 0x00, 0x01, 0x00, 0x00, 0x00, 0x1a,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ]);
  return Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
}

const XMP_HEAD = "http://ns.adobe.com/xap/1.0/\0";
const EXTENDED_XMP_HEAD = "http://ns.adobe.com/xmp/extension/\0";

describe("media names", () => {
  it("normalizes a name once and keeps it stable", () => {
    expect(normalizeMediaName("Logo 最终版.PNG")).toBe("logo.png");
    expect(normalizeMediaName("CON.png")).toBe("con-file.png");
    expect(normalizeMediaName("a/b\\c.png")).toBe("a-b-c.png");
    expect(normalizeMediaName("a..b.png")).toBe("a..b.png");
    const chinese = normalizeMediaName("首页横幅.jpeg");
    expect(chinese).toMatch(/^upload-\d{8}-[0-9a-f]{4}\.jpg$/);
    expect(normalizeMediaName(chinese)).toBe(chinese);
  });
});

describe("media types and location", () => {
  it("recognizes the supported formats and rejects SVG/HTML", () => {
    expect(sniffMedia(PNG)).toBe("image/png");
    expect(sniffMedia(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffMedia(Buffer.from("GIF89a..."))).toBe("image/gif");
    expect(sniffMedia(Buffer.from("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(sniffMedia(Buffer.from("%PDF-1.7"))).toBe("application/pdf");
    expect(sniffMedia(Buffer.from("<svg/>"))).toBeNull();
    expect(sniffMedia(Buffer.from("<html></html>"))).toBeNull();
  });

  it("detects JPEG EXIF and XMP location, but not extended XMP or other formats", () => {
    expect(hasJpegLocation(jpegWith(exifPayload()))).toBe(true);
    expect(hasJpegLocation(jpegWith(Buffer.from(`${XMP_HEAD}<x exif:GPSLatitude="1" />`)))).toBe(true);
    expect(hasJpegLocation(jpegWith(Buffer.from(`${EXTENDED_XMP_HEAD}<x exif:GPSLatitude="1" />`)))).toBe(false);
    expect(hasJpegLocation(Buffer.from([0xff, 0xd8, 0xff, 0xd9]))).toBe(false);
    expect(hasJpegLocation(PNG)).toBe(false);
  });
});

describe("upload directory rules", () => {
  function dirWithTheme(): string {
    const dir = path.join(base, "dirs", `${++n}`);
    fs.mkdirSync(path.join(dir, "themes/starter/static"), { recursive: true });
    return dir;
  }

  it("follows theme.static, including the default, case and trailing slash", () => {
    const dir = dirWithTheme();
    expect(mediaDir(dir, { theme: { name: "starter", static: "static" } })).toBe(
      path.join(dir, "themes/starter/static/uploads"),
    );
    expect(mediaDir(dir, { theme: { name: "starter", static: "Static" } })).toBe(
      path.join(dir, "themes/starter/static/uploads"),
    );
    expect(mediaDir(dir, { theme: { name: "starter" } })).toBe(path.join(dir, "themes/starter/static/uploads"));
    expect(mediaDir(dir, { theme: { name: "starter", static: "static/" } })).toBe(path.join(dir, "static/uploads"));
    expect(mediaDir(dir, { theme: { name: "starter", static: "media" } })).toBe(path.join(dir, "media/uploads"));
  });

  it("rejects unusable theme settings", () => {
    const dir = dirWithTheme();
    expect(codeOf(() => mediaDir(dir, { theme: { name: "starter", static: "" } }))).toBe("media.config_invalid");
    expect(codeOf(() => mediaDir(dir, { theme: {} }))).toBe("media.config_invalid");
    expect(codeOf(() => mediaDir(dir, { theme: { name: "missing", static: "static" } }))).toBe("media.config_invalid");
    expect(codeOf(() => mediaDir(dir, { theme: { name: "../../outside" } }))).toBe("media.dir_unsafe");
    if (process.platform !== "win32") {
      fs.symlinkSync("starter", path.join(dir, "themes/linked"), "dir");
      expect(codeOf(() => mediaDir(dir, { theme: { name: "linked" } }))).toBe("media.dir_unsafe");
    }
  });
});

describe("MediaService.upload", () => {
  it("writes an upload into the AI checkout and creates a change set", async () => {
    const site = await makeSite("upload");
    const result = await upload(site.id, { name: "logo.png", data: PNG.toString("base64") });
    expect(result).toMatchObject({
      path: "themes/starter/static/uploads/logo.png",
      url: "/uploads/logo.png",
      size: PNG.length,
      mime: "image/png",
      replaced: false,
      location: false,
    });
    expect(openChange(site.id).id).toBe(result.changeId);
    expect((await changeFile(site.id, result.path)).equals(PNG)).toBe(true);
  });

  it("accepts all five supported formats", async () => {
    const site = await makeSite("formats");
    const files: [string, Buffer, string][] = [
      ["one.png", PNG, "image/png"],
      ["two.jpg", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, 0xff, 0xd9]), "image/jpeg"],
      ["three.gif", Buffer.from("GIF89a..."), "image/gif"],
      ["four.webp", Buffer.from("RIFF\0\0\0\0WEBPVP8 "), "image/webp"],
      ["five.pdf", Buffer.from("%PDF-1.7\n"), "application/pdf"],
    ];
    for (const [name, data, mime] of files) {
      const result = await upload(site.id, { name, data: data.toString("base64") });
      expect(result.mime).toBe(mime);
      expect((await changeFile(site.id, result.path)).equals(data)).toBe(true);
    }
  });

  it("joins an existing change set and uses the site baseUrl in the URL", async () => {
    const site = await makeSite("subpath", (dir) => {
      const file = path.join(dir, "site.yaml");
      fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("baseUrl: /", "baseUrl: /blog/"));
    });
    const first = await upload(site.id, { name: "one.png", data: PNG.toString("base64") });
    const second = await upload(site.id, { name: "two.png", data: PNG.toString("base64") });
    expect(first.url).toBe("/blog/uploads/one.png");
    expect(second.url).toBe("/blog/uploads/two.png");
    expect(second.changeId).toBe(first.changeId);
  });

  it("returns media.exists without replace and replaces with replace", async () => {
    const site = await makeSite("replace");
    await upload(site.id, { name: "logo.png", data: PNG.toString("base64") });
    await expect(upload(site.id, { name: "logo.png", data: PNG.toString("base64") })).rejects.toMatchObject({
      code: "media.exists",
      params: { name: "logo.png" },
    });
    const replaced = await upload(site.id, { name: "logo.png", data: PNG.toString("base64"), replace: true });
    expect(replaced.replaced).toBe(true);
  });

  it("replaces a case-only name on every platform", async () => {
    const site = await makeSite("case", (dir) => {
      const file = path.join(dir, "themes/starter/static/uploads/Logo.png");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, PNG);
    });
    const result = await upload(site.id, { name: "logo.png", data: PNG.toString("base64"), replace: true });
    expect(result.replaced).toBe(true);
    const change = openChange(site.id);
    const cwd = await ctx.sites.aiWorktree(site.id, change.snapshotCommit, { reset: false });
    const names = fs.readdirSync(path.join(cwd, "themes/starter/static/uploads"));
    expect(names.filter((name) => name.toLowerCase() === "logo.png")).toHaveLength(1);
  });

  it("rejects invalid requests before opening a change set", async () => {
    const site = await makeSite("invalid");
    const cases: [MediaUploadRequest, string][] = [
      [{ name: "logo.png", data: "!!!" }, "request.invalid_body"],
      [{ name: "logo.png", data: "" }, "media.empty"],
      [{ name: "logo", data: PNG.toString("base64") }, "media.bad_name"],
      [{ name: "logo\u0000.png", data: PNG.toString("base64") }, "media.bad_name"],
      [{ name: "logo.png", data: Buffer.from("<svg/>").toString("base64") }, "media.unsupported_type"],
      [{ name: "logo.html", data: Buffer.from("<html></html>").toString("base64") }, "media.unsupported_type"],
      [{ name: "logo.gif", data: PNG.toString("base64") }, "media.type_mismatch"],
      [
        { name: "logo.png", data: Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]).toString("base64") },
        "media.too_large",
      ],
    ];
    for (const [request, code] of cases) {
      await expect(upload(site.id, request)).rejects.toMatchObject({ code });
      expect(ctx.changes.store.open(site.id)).toBeNull();
    }
  });

  it("rejects protected, ignored and missing upload locations", async () => {
    const protectedSite = await makeSite("protected", (dir) => {
      const file = path.join(dir, "site.yaml");
      fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("  static: static", "  static: dist"));
    });
    await expect(upload(protectedSite.id, { name: "logo.png", data: PNG.toString("base64") })).rejects.toMatchObject({
      code: "media.dir_unsafe",
    });

    const ignoredSite = await makeSite("ignored", (dir) => {
      fs.writeFileSync(path.join(dir, ".gitignore"), "themes/starter/static/uploads/\n");
    });
    await expect(upload(ignoredSite.id, { name: "logo.png", data: PNG.toString("base64") })).rejects.toMatchObject({
      code: "media.dir_unsafe",
    });

    const emptySite = await makeSite("empty-static", (dir) => {
      const file = path.join(dir, "site.yaml");
      fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("  static: static", '  static: ""'));
    });
    await expect(upload(emptySite.id, { name: "logo.png", data: PNG.toString("base64") })).rejects.toMatchObject({
      code: "media.config_invalid",
    });

    const envSite = await makeSite("env-path", (dir) => {
      const file = path.join(dir, "site.yaml");
      fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("  static: static", "  static: .env-assets"));
    });
    await expect(upload(envSite.id, { name: "logo.png", data: PNG.toString("base64") })).rejects.toMatchObject({
      code: "media.dir_unsafe",
    });
  });

  it("rejects a snapshot whose site.yaml cannot be parsed", async () => {
    const site = await makeSite("bad-yaml");
    fs.writeFileSync(path.join(site.dir, "site.yaml"), "site: [\n");
    commitAllAs(base, site.dir, "bad config");
    await expect(upload(site.id, { name: "logo.png", data: PNG.toString("base64") })).rejects.toMatchObject({
      code: "media.config_invalid",
    });
    expect(ctx.changes.store.open(site.id)).toBeNull();
  });

  it.skipIf(process.platform === "win32")("rejects a symbolic link in the upload path", async () => {
    const site = await makeSite("symlink");
    // Open the checkout first: a later beginUserChange must not reset it and remove the test's symlink.
    const { cwd } = await ctx.changes.beginUserChange(site.id);
    const outside = path.join(base, "outside");
    fs.mkdirSync(outside, { recursive: true });
    const uploads = path.join(cwd, "themes/starter/static/uploads");
    fs.mkdirSync(path.dirname(uploads), { recursive: true });
    fs.symlinkSync(outside, uploads, "dir");
    await expect(upload(site.id, { name: "logo.png", data: PNG.toString("base64") })).rejects.toMatchObject({
      code: "media.dir_unsafe",
    });
  });

  it("rolls back a new file and closes the change set when the snapshot fails", async () => {
    const site = await makeSite("rollback");
    const snap = vi.spyOn(ctx.changes, "snapshot").mockRejectedValueOnce(new Error("snapshot failed"));
    try {
      await expect(upload(site.id, { name: "logo.png", data: PNG.toString("base64") })).rejects.toThrow(
        "snapshot failed",
      );
    } finally {
      snap.mockRestore();
    }
    expect(ctx.changes.store.open(site.id)).toBeNull();
    const cwd = await ctx.sites.aiWorktree(site.id, await ctx.sites.headOf(site), { reset: false });
    expect(fs.existsSync(path.join(cwd, "themes/starter/static/uploads/logo.png"))).toBe(false);
  });

  it("restores a replaced file when the snapshot fails", async () => {
    const site = await makeSite("rollback-replace", (dir) => {
      const file = path.join(dir, "themes/starter/static/uploads/logo.png");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, PNG);
    });
    const replacement = Buffer.concat([PNG, Buffer.from([0])]);
    const snap = vi.spyOn(ctx.changes, "snapshot").mockRejectedValueOnce(new Error("snapshot failed"));
    try {
      await expect(
        upload(site.id, { name: "logo.png", data: replacement.toString("base64"), replace: true }),
      ).rejects.toThrow("snapshot failed");
    } finally {
      snap.mockRestore();
    }
    const cwd = await ctx.sites.aiWorktree(site.id, await ctx.sites.headOf(site), { reset: false });
    expect((await fs.promises.readFile(path.join(cwd, "themes/starter/static/uploads/logo.png"))).equals(PNG)).toBe(
      true,
    );
  });

  it("detects JPEG location without changing the uploaded bytes", async () => {
    const site = await makeSite("location");
    const jpeg = jpegWith(exifPayload());
    const result = await upload(site.id, { name: "photo.jpg", data: jpeg.toString("base64") });
    expect(result.location).toBe(true);
    expect((await changeFile(site.id, result.path)).equals(jpeg)).toBe(true);
  });

  it("makes an upload-only change user-authored with a diff summary", async () => {
    const site = await makeSite("apply");
    await upload(site.id, { name: "logo.png", data: PNG.toString("base64") });
    const view = await ctx.changes.current(site.id, false);
    if (!view) throw new Error("no change set");
    await ctx.changes.apply(view.id, { treeHash: view.treeHash });
    expect(rawGit(base, site.dir, "log", "-1", "--format=%an|%ae|%cn|%ce").trim()).toBe(
      "Site Owner|owner@example.com|Site Owner|owner@example.com",
    );
    const body = rawGit(base, site.dir, "log", "-1", "--format=%B");
    expect(body).toContain("Add 1 file");
    expect(body).toContain("themes/starter/static/uploads/logo.png");
    const history = await ctx.changes.history(site.id, 0);
    expect(history.entries[0]?.byAi).toBe(false);
  });

  it("discards uploaded files when the change set is rejected", async () => {
    const site = await makeSite("reject");
    const result = await upload(site.id, { name: "logo.png", data: PNG.toString("base64") });
    await ctx.changes.reject(result.changeId);
    expect(fs.existsSync(path.join(site.dir, result.path))).toBe(false);
  });
});

describe("media API", () => {
  it("accepts a 13.3 MiB request and rejects one over 14 MiB", async () => {
    const site = await makeSite("body-limit");
    const big = Buffer.alloc(10 * 1024 * 1024);
    PNG.copy(big);
    const ok = await ctx.app.fetch(appBase(site.id, { name: "big.png", data: big.toString("base64") }));
    expect(ok.status).toBe(201);
    const tooBig = await ctx.app.fetch(
      appBase(site.id, { name: "too-big.png", data: "a".repeat(14 * 1024 * 1024 + 1) }),
    );
    expect(tooBig.status).toBe(413);
    expect(await tooBig.json()).toMatchObject({ code: "request.too_large" });
  });

  it("rejects an upload while a conversation is running", async () => {
    const site = await makeSite("busy");
    const busy = vi.spyOn(ctx.agent, "busy").mockReturnValue(true);
    try {
      const res = await ctx.app.fetch(appBase(site.id, { name: "logo.png", data: PNG.toString("base64") }));
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: "site.busy" });
    } finally {
      busy.mockRestore();
    }
  });

  it("rejects a read-only site and a held site lock", async () => {
    const site = await makeSite("locked");
    const release = ctx.locks.acquire(site.id, "build");
    try {
      await expect(upload(site.id, { name: "logo.png", data: PNG.toString("base64") })).rejects.toMatchObject({
        code: "site.busy",
      });
    } finally {
      release();
    }
    ctx.sites.store.setState(site.id, { readOnly: [{ code: "plugin_files" }], checkedCommit: null, configCheck: null });
    await expect(upload(site.id, { name: "logo.png", data: PNG.toString("base64") })).rejects.toMatchObject({
      code: "site.read_only",
    });
  });
});
