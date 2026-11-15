import { z } from "zod";
import { ErrorCode } from "./errors.ts";

export const AppUpdateFormat = z.enum(["dmg", "zip", "exe", "appimage", "deb"]);
export type AppUpdateFormat = z.infer<typeof AppUpdateFormat>;

/** One file of a GitHub release that can be downloaded for this platform. */
export const AppUpdateAsset = z.object({
  name: z.string(),
  size: z.number().int().nonnegative(),
  format: AppUpdateFormat,
  /** GitHub's browser_download_url. The server checks it before downloading. */
  url: z.string(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export type AppUpdateAsset = z.infer<typeof AppUpdateAsset>;

/** A newer release that this platform can install. */
export const AppUpdateRelease = z.object({
  version: z.string(),
  publishedAt: z.string(),
  /** GitHub release page, opened by the user for the notes. */
  pageUrl: z.string(),
  /** GitHub's prerelease flag; the version suffix is the source of truth for the channel. */
  prerelease: z.boolean(),
  asset: AppUpdateAsset,
});
export type AppUpdateRelease = z.infer<typeof AppUpdateRelease>;

export const AppUpdateState = z.discriminatedUnion("phase", [
  z.object({ phase: z.literal("idle") }),
  z.object({ phase: z.literal("checking") }),
  z.object({ phase: z.literal("available"), release: AppUpdateRelease }),
  z.object({
    phase: z.literal("downloading"),
    release: AppUpdateRelease,
    received: z.number().nonnegative(),
    total: z.number().nonnegative().nullable(),
  }),
  z.object({ phase: z.literal("verifying"), release: AppUpdateRelease }),
  z.object({ phase: z.literal("downloaded"), release: AppUpdateRelease, fileName: z.string() }),
  z.object({
    phase: z.literal("error"),
    operation: z.enum(["check", "download", "open"]),
    code: ErrorCode,
    release: AppUpdateRelease.optional(),
  }),
]);
export type AppUpdateState = z.infer<typeof AppUpdateState>;

export const AppUpdateResponse = z.object({
  currentVersion: z.string(),
  /** When the last GitHub lookup finished, successful or not. */
  checkedAt: z.string().nullable(),
  state: AppUpdateState,
});
export type AppUpdateResponse = z.infer<typeof AppUpdateResponse>;
