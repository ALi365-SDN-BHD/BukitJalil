import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MAX_REFERENCE_IMAGE_BYTES } from "@bukitjalil/shared";
import { afterAll, describe, expect, it } from "vitest";
import { cleanReferenceImage, writeReferenceImages } from "../src/media/reference.ts";
import { SiteError } from "../src/sites/location.ts";
import { jpegSegment, pngChunk, riffChunk, tinyPng, webp } from "./fixtures/images.ts";

const base = fs.mkdtempSync(path.join(os.tmpdir(), "bj-reference-"));
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

const b64 = (data: Buffer) => data.toString("base64");
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return err instanceof SiteError ? err.code : String(err);
  }
  return null;
};

describe("cleanReferenceImage", () => {
  it("keeps a PNG's image chunks and drops its text, time and EXIF chunks, whatever the declared type", () => {
    const meta = [
      pngChunk("tEXt", Buffer.from("Author\0Someone")),
      pngChunk("iTXt", Buffer.from("XML:com.adobe.xmp\0\0\0\0\0<x/>")),
      pngChunk("eXIf", Buffer.from("MM\0*GPS")),
      pngChunk("tIME", Buffer.alloc(7)),
      pngChunk("gAMA", Buffer.alloc(4)),
    ];
    const out = cleanReferenceImage({ mimeType: "image/jpeg", data: b64(tinyPng(meta)) });
    expect(out.mimeType).toBe("image/png");
    expect(out.data.equals(tinyPng([meta[4] as Buffer]))).toBe(true);
    expect(out.data.includes("Someone")).toBe(false);
  });

  it("drops a JPEG's EXIF, XMP and comments and keeps its ICC profile and image", () => {
    const jfif = jpegSegment(0xe0, Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0", "latin1"));
    const exif = jpegSegment(0xe1, Buffer.from("Exif\0\0MM\0*GPS 3.1 101.6"));
    const xmp = jpegSegment(0xe1, Buffer.from("http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>"));
    const icc = jpegSegment(0xe2, Buffer.from("ICC_PROFILE\0\x01\x01profile", "latin1"));
    const comment = jpegSegment(0xfe, Buffer.from("taken at home"));
    const dqt = jpegSegment(0xdb, Buffer.alloc(65));
    const scan = Buffer.concat([jpegSegment(0xda, Buffer.alloc(10)), Buffer.from([1, 2, 3, 0xff, 0xd9])]);
    const soi = Buffer.from([0xff, 0xd8]);
    const out = cleanReferenceImage({
      mimeType: "image/jpeg",
      data: b64(Buffer.concat([soi, jfif, exif, xmp, icc, comment, dqt, scan])),
    });
    expect(out.mimeType).toBe("image/jpeg");
    expect(out.data.equals(Buffer.concat([soi, jfif, icc, dqt, scan]))).toBe(true);
  });

  it("keeps every scan of a progressive JPEG and drops what follows the end, such as an appended gain map", () => {
    const soi = Buffer.from([0xff, 0xd8]);
    const eoi = Buffer.from([0xff, 0xd9]);
    const scan = (bytes: number[]) => Buffer.concat([jpegSegment(0xda, Buffer.alloc(8)), Buffer.from(bytes)]);
    const image = Buffer.concat([
      soi,
      jpegSegment(0xdb, Buffer.alloc(65)),
      scan([1, 0xff, 0x00, 2, 0xff, 0xd0, 3]), // a stuffed 0xFF and a restart marker inside the data
      jpegSegment(0xc4, Buffer.alloc(20)),
      scan([4, 5]),
      eoi,
    ]);
    const gainMap = Buffer.concat([soi, jpegSegment(0xe1, Buffer.from("Exif\0\0MM\0*GPS")), scan([6]), eoi]);
    const out = cleanReferenceImage({ mimeType: "image/jpeg", data: b64(Buffer.concat([image, gainMap])) });
    expect(out.data.equals(image)).toBe(true);
    // No end of image: refused.
    expect(code(() => cleanReferenceImage({ mimeType: "image/jpeg", data: b64(image.subarray(0, -2)) }))).toBe(
      "image.invalid",
    );
  });

  it("drops a WebP's EXIF and XMP chunks and clears their flags", () => {
    const vp8x = Buffer.alloc(10);
    vp8x[0] = 0x08 | 0x04 | 0x20; // EXIF, XMP, ICC
    const image = riffChunk("VP8L", Buffer.from([0x2f, 0, 0, 0, 0]));
    const out = cleanReferenceImage({
      mimeType: "image/webp",
      data: b64(
        webp([
          riffChunk("VP8X", vp8x),
          riffChunk("ICCP", Buffer.from("icc")),
          image,
          riffChunk("EXIF", Buffer.from("MM\0*GPS")),
          riffChunk("XMP ", Buffer.from("<x/>")),
        ]),
      ),
    });
    const kept = Buffer.alloc(10);
    kept[0] = 0x20;
    expect(out.mimeType).toBe("image/webp");
    expect(out.data.equals(webp([riffChunk("VP8X", kept), riffChunk("ICCP", Buffer.from("icc")), image]))).toBe(true);
  });

  it("refuses what is not a well-formed PNG, JPEG or WebP", () => {
    const png = tinyPng();
    const clean = (data: Buffer | string) =>
      code(() => cleanReferenceImage({ mimeType: "image/png", data: typeof data === "string" ? data : b64(data) }));
    expect(clean(png.subarray(0, png.length - 12))).toBe("image.invalid"); // no IEND
    expect(clean(Buffer.concat([png.subarray(0, 8), pngChunk("IDAT", Buffer.alloc(1))]))).toBe("image.invalid");
    const damaged = Buffer.from(png);
    damaged[20] = (damaged[20] ?? 0) ^ 1; // inside IHDR: its CRC no longer matches
    expect(clean(damaged)).toBe("image.invalid");
    expect(clean(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 2, 0xff, 0xd9]))).toBe("image.invalid");
    expect(clean(webp([riffChunk("EXIF", Buffer.from("x"))]))).toBe("image.invalid"); // no image chunk
    expect(clean(Buffer.from("GIF89a\x01\0\x01\0", "latin1"))).toBe("image.unsupported_type");
    expect(clean(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBe("image.unsupported_type");
    expect(clean("not base64!")).toBe("image.invalid");
    expect(clean("")).toBe("image.invalid");
    expect(clean(Buffer.alloc(MAX_REFERENCE_IMAGE_BYTES + 1))).toBe("image.too_large");
  });
});

describe("writeReferenceImages", () => {
  const image = cleanReferenceImage({ mimeType: "image/png", data: b64(tinyPng()) });

  it("writes new files into _reference/ and returns their paths", () => {
    const root = fs.mkdtempSync(path.join(base, "root-"));
    const first = writeReferenceImages(root, [image, image]);
    const second = writeReferenceImages(root, [image]);
    expect(first).toHaveLength(2);
    for (const file of [...first, ...second]) {
      expect(file).toMatch(/^_reference\/ref-\d{8}-\d{6}-\d-[0-9a-f]{6}\.png$/);
      expect(fs.readFileSync(path.join(root, file)).equals(image.data)).toBe(true);
    }
    expect(new Set([...first, ...second]).size).toBe(3);
    expect(writeReferenceImages(root, [])).toEqual([]);
  });

  it("refuses a _reference that is a file or a symlink", () => {
    const root = fs.mkdtempSync(path.join(base, "root-"));
    fs.writeFileSync(path.join(root, "_reference"), "x");
    expect(code(() => writeReferenceImages(root, [image]))).toBe("media.dir_unsafe");
    const linked = fs.mkdtempSync(path.join(base, "root-"));
    const outside = fs.mkdtempSync(path.join(base, "outside-"));
    fs.symlinkSync(outside, path.join(linked, "_reference"));
    expect(code(() => writeReferenceImages(linked, [image]))).toBe("media.dir_unsafe");
    expect(fs.readdirSync(outside)).toEqual([]);
  });
});
