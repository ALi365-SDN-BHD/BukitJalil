/**
 * JPEG location metadata (design 4.5): read the EXIF GPS IFD or the standard XMP packet. This only detects;
 * the upload bytes are never changed. Extended XMP, PNG, WebP, GIF and PDF are not inspected.
 */
export function hasJpegLocation(data: Buffer): boolean {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return false;
  let offset = 2;
  while (offset + 4 <= data.length) {
    if (data[offset] !== 0xff) {
      offset++;
      continue;
    }
    while (data[offset + 1] === 0xff) offset++; // fill bytes before a marker
    if (offset + 4 > data.length) break;
    const marker = data[offset + 1] ?? 0;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xda) break; // start of scan: metadata segments are before it
    const length = data.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > data.length) break;
    const start = offset + 4;
    const end = offset + 2 + length;
    if (marker === 0xe1) {
      const payload = data.subarray(start, end);
      if (payload.subarray(0, 6).toString("latin1") === "Exif\0\0") {
        if (tiffHasGps(payload.subarray(6))) return true;
      } else if (payload.subarray(0, 29).toString("latin1") === "http://ns.adobe.com/xap/1.0/\0") {
        const xml = payload.subarray(29).toString("utf8");
        if (xml.includes("GPSLatitude")) return true;
      }
    }
    offset = end;
  }
  return false;
}

/** TIFF header and IFD0: a GPS IFD pointer (tag 0x8825) means the photo has location metadata. */
function tiffHasGps(tiff: Buffer): boolean {
  if (tiff.length < 8) return false;
  const little = tiff[0] === 0x49 && tiff[1] === 0x49;
  const big = tiff[0] === 0x4d && tiff[1] === 0x4d;
  if (!little && !big) return false;
  const u16 = (at: number) => (little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at));
  const u32 = (at: number) => (little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at));
  if (u16(2) !== 42) return false;
  const ifd = u32(4);
  if (ifd + 2 > tiff.length) return false;
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > tiff.length) return false;
    if (u16(entry) === 0x8825) return true;
  }
  return false;
}
