import { z } from "zod";
import { SUPPORTED_LOCALES } from "./constants.ts";

export const Locale = z.enum(SUPPORTED_LOCALES);
export type Locale = z.infer<typeof Locale>;

/** Pi's thinking levels (Pi SDK 1.5.1); Pi clamps the level to what the model supports. */
export const ThinkingLevel = z.enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
export type ThinkingLevel = z.infer<typeof ThinkingLevel>;

/** A model of Pi's catalog, by provider id and model id (plan 6.5). */
export const ModelRef = z.object({
  provider: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),
  id: z.string().min(1).max(200),
});
export type ModelRef = z.infer<typeof ModelRef>;

export const Settings = z.object({
  /** null until the user picks one; the UI then follows the browser language. */
  locale: Locale.nullable(),
  /** Parent directory chosen last time in the site directory picker (plan 5.2). */
  lastParentDir: z.string().nullable(),
  /** Custom Bukit executable (plan 8.1), e.g. a self-built one on Intel Mac; null uses the app copy or PATH. */
  bukitPath: z.string().max(4096).regex(/^\//, "must be an absolute path").nullable(),
  /** Committer identity for commits BukitJalil makes (plan 7.2); the UI suggests the global git identity. */
  commitName: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((s) => !/[\p{Cc}<>]/u.test(s), "must not contain control characters or <>")
    .nullable(),
  commitEmail: z
    .string()
    .trim()
    .max(254)
    .regex(/^[^\s<>@]+@[^\s<>@]+$/, "must be an email address")
    .nullable(),
  /** The model conversations use; null until the user picks one. */
  model: ModelRef.nullable(),
  thinkingLevel: ThinkingLevel,
});
export type Settings = z.infer<typeof Settings>;

export const SettingsPatch = Settings.partial().strict();
export type SettingsPatch = z.infer<typeof SettingsPatch>;

export const defaultSettings: Settings = {
  locale: null,
  lastParentDir: null,
  bukitPath: null,
  commitName: null,
  commitEmail: null,
  model: null,
  thinkingLevel: "medium",
};
