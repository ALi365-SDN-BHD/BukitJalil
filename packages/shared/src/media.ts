import { z } from "zod";
import type { ImageMime } from "./panels.ts";

/** POST /api/sites/:siteId/media. The body is JSON so the existing CSRF rules apply unchanged. */
export const MediaUploadRequest = z.object({
  name: z.string().min(1).max(255),
  data: z.string(),
  replace: z.boolean().optional(),
});
export type MediaUploadRequest = z.infer<typeof MediaUploadRequest>;

/** An upload's recognized type. PDF is accepted, but is never shown with as=raw. */
export type MediaMime = ImageMime | "application/pdf";

export interface MediaUploadResult {
  /** Repository-relative path of the written file. */
  path: string;
  /** The URL to use in content and front matter, including the site's baseUrl. */
  url: string;
  size: number;
  mime: MediaMime;
  replaced: boolean;
  /** The written JPEG still carries EXIF/XMP location metadata. Detection only: the bytes are unchanged. */
  location: boolean;
  changeId: string;
}
