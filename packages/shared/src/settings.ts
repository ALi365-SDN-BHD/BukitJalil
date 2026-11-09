import { z } from "zod";
import { SUPPORTED_LOCALES } from "./constants.ts";

export const Locale = z.enum(SUPPORTED_LOCALES);
export type Locale = z.infer<typeof Locale>;

export const Settings = z.object({
  /** null until the user picks one; the UI then follows the browser language. */
  locale: Locale.nullable(),
  /** Parent directory chosen last time in the site directory picker (plan 5.2). */
  lastParentDir: z.string().nullable(),
  /** Custom Bukit executable (plan 8.1), e.g. a self-built one on Intel Mac; null uses the app copy or PATH. */
  bukitPath: z.string().max(4096).regex(/^\//, "must be an absolute path").nullable(),
});
export type Settings = z.infer<typeof Settings>;

export const SettingsPatch = Settings.partial().strict();
export type SettingsPatch = z.infer<typeof SettingsPatch>;

export const defaultSettings: Settings = { locale: null, lastParentDir: null, bukitPath: null };
