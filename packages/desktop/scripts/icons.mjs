// Renders the app icon from assets/icon.svg (full tile: Windows, Linux, windows) and assets/icon-mac.svg
// (Big Sur grid: an 824 px tile with a margin) into the files packaging uses, all in assets/:
//   icon.png   1024 px, Linux and the window icon
//   icon.ico   16–256 px PNG entries, the Windows executable and installer
//   icon.icns  16–1024 px, the macOS app (iconutil, so this part runs on macOS only)
// The outputs are committed; run this after changing an SVG: `pnpm --filter @bukitjalil/desktop icons`.
// It draws with Playwright and the installed Google Chrome (ICON_BROWSER_CHANNEL picks another channel).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";

const assets = path.resolve(import.meta.dirname, "../assets");
const svg = (name) => fs.readFileSync(path.join(assets, name), "utf8");

const browser = await chromium.launch({ channel: process.env.ICON_BROWSER_CHANNEL || "chrome" });
// One fixed viewport for every size: resizing it between screenshots let one capture a half-updated frame
// (the 256 px image came out split in two, and the Retina Dock shows exactly that one).
const page = await browser.newPage({ viewport: { width: 1100, height: 1100 }, deviceScaleFactor: 1 });

/** PNG of `source` at `size` px, transparent around the tile. */
async function render(source, size) {
  const data = Buffer.from(source).toString("base64");
  await page.setContent(
    `<body style="margin:0"><img src="data:image/svg+xml;base64,${data}" width="${size}" height="${size}" style="display:block"></body>`,
  );
  const img = page.locator("img");
  await img.evaluate((el) => el.decode());
  const png = await img.screenshot({ omitBackground: true });
  // A check against the same failure: the picture must be the requested size and match a second capture.
  if (png.readUInt32BE(16) !== size || png.readUInt32BE(20) !== size) throw new Error(`icon ${size}: wrong size`);
  if (!png.equals(await img.screenshot({ omitBackground: true }))) throw new Error(`icon ${size}: unstable render`);
  return png;
}

/** An ICO file whose entries are PNG images (Windows Vista and later read these). */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // 0 means 256
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

const full = svg("icon.svg");
fs.writeFileSync(path.join(assets, "icon.png"), await render(full, 1024));
const icoImages = [];
for (const size of [16, 24, 32, 48, 64, 128, 256]) icoImages.push({ size, png: await render(full, size) });
fs.writeFileSync(path.join(assets, "icon.ico"), ico(icoImages));

if (process.platform === "darwin") {
  const mac = svg("icon-mac.svg");
  const set = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bukitjalil-icon-")), "icon.iconset");
  fs.mkdirSync(set);
  for (const size of [16, 32, 128, 256, 512]) {
    fs.writeFileSync(path.join(set, `icon_${size}x${size}.png`), await render(mac, size));
    fs.writeFileSync(path.join(set, `icon_${size}x${size}@2x.png`), await render(mac, size * 2));
  }
  execFileSync("iconutil", ["-c", "icns", set, "-o", path.join(assets, "icon.icns")]);
  fs.rmSync(path.dirname(set), { recursive: true, force: true });
} else {
  console.warn("icon.icns is made with iconutil: run this on macOS to update it");
}
await browser.close();
console.log(fs.readdirSync(assets).join("\n"));
