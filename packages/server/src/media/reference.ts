import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { MAX_REFERENCE_IMAGE_BYTES, type ReferenceImageMime, type ReferenceImageRequest } from "@bukitjalil/shared";
import { assertNotLink, O_NOFOLLOW } from "../safe-open.ts";
import { SiteError } from "../sites/location.ts";
import { assertNoSymlinks } from "./dir.ts";

/**
 * Reference images (theme development design 4.2): pictures the user attaches to a message or a new theme
 * project. The bytes decide the type, never the name or the declared type, and the structure is parsed:
 * a file that does not parse as PNG, JPEG or WebP is refused. Metadata is removed (EXIF, XMP, text chunks,
 * comments), so a photo's location or camera never reaches the model provider or the repository.
 */

/** Simple linear check; the nested-group form overflows V8's stack on a large value. */
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** The project directory reference images are kept in (design 3.1); the AI may read it, not write it. */
export const REFERENCE_DIR = "_reference";

const EXT: Record<ReferenceImageMime, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

const invalid = () => new SiteError("image.invalid", 400);

/** An image after the server checked it and removed its metadata. */
export interface ReferenceImage {
  mimeType: ReferenceImageMime;
  data: Buffer;
}

/** Decode, check and clean one image from a request. */
export function cleanReferenceImage(req: ReferenceImageRequest): ReferenceImage {
  if (req.data.length % 4 !== 0 || !BASE64.test(req.data)) throw invalid();
  const data = Buffer.from(req.data, "base64");
  if (data.length === 0) throw invalid();
  if (data.length > MAX_REFERENCE_IMAGE_BYTES) {
    throw new SiteError("image.too_large", 400, { max: String(MAX_REFERENCE_IMAGE_BYTES) });
  }
  if (isPng(data)) return { mimeType: "image/png", data: stripPng(data) };
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff)
    return { mimeType: "image/jpeg", data: stripJpeg(data) };
  if (isWebp(data)) return { mimeType: "image/webp", data: stripWebp(data) };
  throw new SiteError("image.unsupported_type", 400);
}

/**
 * Write images into `<root>/_reference/` with new names; the caller holds the project lock. The directory and
 * the path to it must not be symlinks, and no existing file is replaced. Returns the paths, relative to root.
 */
export function writeReferenceImages(root: string, images: readonly ReferenceImage[]): string[] {
  if (images.length === 0) return [];
  const dir = path.join(root, REFERENCE_DIR);
  assertNoSymlinks(root, dir);
  const st = fs.lstatSync(dir, { throwIfNoEntry: false });
  if (st && !st.isDirectory()) throw new SiteError("media.dir_unsafe", 409);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
  return images.map((image, i) => {
    const name = `ref-${stamp}-${i + 1}-${crypto.randomBytes(3).toString("hex")}.${EXT[image.mimeType]}`;
    const file = path.join(dir, name);
    assertNotLink(file);
    const { O_WRONLY, O_CREAT, O_EXCL } = fs.constants;
    const fd = fs.openSync(file, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o644);
    try {
      fs.writeFileSync(fd, image.data);
    } finally {
      fs.closeSync(fd);
    }
    return `${REFERENCE_DIR}/${name}`;
  });
}

// --- PNG: signature, then length/type/data/CRC chunks from IHDR to IEND, each CRC checked ---

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_METADATA = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "tIME"]);

const isPng = (data: Buffer) => data.length >= 8 && data.subarray(0, 8).equals(PNG_SIGNATURE);

function stripPng(data: Buffer): Buffer {
  const out: Buffer[] = [PNG_SIGNATURE];
  let offset = 8;
  let first = true;
  for (;;) {
    if (offset + 12 > data.length) throw invalid();
    const length = data.readUInt32BE(offset);
    const type = data.subarray(offset + 4, offset + 8).toString("latin1");
    const end = offset + 12 + length;
    if (!/^[A-Za-z]{4}$/.test(type) || end > data.length) throw invalid();
    // A chunk whose CRC does not match is damaged; Pi's image decoder would drop the image.
    if (zlib.crc32(data.subarray(offset + 4, end - 4)) !== data.readUInt32BE(end - 4)) throw invalid();
    if (first && type !== "IHDR") throw invalid();
    first = false;
    if (!PNG_METADATA.has(type)) out.push(data.subarray(offset, end));
    offset = end;
    if (type === "IEND") return Buffer.concat(out);
  }
}

// --- JPEG: segments and scans up to the end of image; APP1-APP15 (except an ICC profile) and comments are
// dropped, and so is anything after the end (an appended image, such as a gain map, has metadata of its own) ---

function stripJpeg(data: Buffer): Buffer {
  const out: Buffer[] = [data.subarray(0, 2)];
  let offset = 2;
  let scanned = false;
  for (;;) {
    if (offset + 2 > data.length || data[offset] !== 0xff) throw invalid();
    while (data[offset + 1] === 0xff) offset++; // fill bytes before a marker
    const marker = data[offset + 1] ?? 0;
    if (marker === 0xd9) {
      if (!scanned) throw invalid(); // the end before any scan
      out.push(data.subarray(offset, offset + 2));
      return Buffer.concat(out);
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push(data.subarray(offset, offset + 2));
      offset += 2;
      continue;
    }
    if (marker === 0xd8) throw invalid(); // a second start
    if (offset + 4 > data.length) throw invalid();
    const end = offset + 2 + data.readUInt16BE(offset + 2);
    if (end < offset + 4 || end > data.length) throw invalid();
    if (marker === 0xda) {
      // Start of scan: the header, then compressed data up to the next marker (a progressive image has several).
      scanned = true;
      const next = scanEnd(data, end);
      out.push(data.subarray(offset, next));
      offset = next;
      continue;
    }
    const icc = marker === 0xe2 && data.subarray(offset + 4, offset + 16).toString("latin1") === "ICC_PROFILE\0";
    const metadata = (marker >= 0xe1 && marker <= 0xef && !icc) || marker === 0xfe;
    if (!metadata) out.push(data.subarray(offset, end));
    offset = end;
  }
}

/** Where a scan's compressed data ends: the next 0xFF that starts a marker (not a stuffed 0x00 or a restart). */
function scanEnd(data: Buffer, from: number): number {
  for (let i = data.indexOf(0xff, from); i >= 0 && i + 1 < data.length; i = data.indexOf(0xff, i + 1)) {
    const next = data[i + 1] ?? 0;
    if (next !== 0x00 && next !== 0xff && (next < 0xd0 || next > 0xd7)) return i;
  }
  throw invalid();
}

// --- WebP: a RIFF container of chunks; EXIF and XMP chunks are dropped and VP8X's flags updated ---

const isWebp = (data: Buffer) =>
  data.length >= 12 &&
  data.subarray(0, 4).toString("latin1") === "RIFF" &&
  data.subarray(8, 12).toString("latin1") === "WEBP";

const VP8X_EXIF = 0x08;
const VP8X_XMP = 0x04;

function stripWebp(data: Buffer): Buffer {
  const riffEnd = 8 + data.readUInt32LE(4);
  if (riffEnd > data.length || riffEnd < 12) throw invalid();
  const chunks: Buffer[] = [];
  let image = false;
  let offset = 12;
  while (offset < riffEnd) {
    if (offset + 8 > riffEnd) throw invalid();
    const fourcc = data.subarray(offset, offset + 4).toString("latin1");
    const size = data.readUInt32LE(offset + 4);
    const end = offset + 8 + size + (size % 2);
    if (end > riffEnd) throw invalid();
    if (fourcc === "VP8 " || fourcc === "VP8L" || fourcc === "VP8X") image = true;
    if (fourcc === "VP8X") {
      if (size < 10) throw invalid();
      const chunk = Buffer.from(data.subarray(offset, end));
      chunk[8] = (chunk[8] ?? 0) & ~(VP8X_EXIF | VP8X_XMP);
      chunks.push(chunk);
    } else if (fourcc !== "EXIF" && fourcc !== "XMP ") {
      chunks.push(data.subarray(offset, end));
    }
    offset = end;
  }
  if (!image) throw invalid();
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(body.length + 4, 4);
  header.write("WEBP", 8, "latin1");
  return Buffer.concat([header, body]);
}
