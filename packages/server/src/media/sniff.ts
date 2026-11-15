import type { MediaMime } from "@bukitjalil/shared";
import { imageMime } from "../panels/service.ts";

/** Recognize an upload by its first bytes; the file name does not count. */
export function sniffMedia(data: Buffer): MediaMime | null {
  const image = imageMime(data);
  if (image) return image;
  return data.length >= 5 && data.subarray(0, 5).toString("latin1") === "%PDF-" ? "application/pdf" : null;
}
