import { z } from "zod";
import { SUPPORTED_LOCALES } from "./constants.ts";

export const Locale = z.enum(SUPPORTED_LOCALES);
export type Locale = z.infer<typeof Locale>;

export const Settings = z.object({
  /** null until the user picks one; the UI then follows the browser language. */
  locale: Locale.nullable(),
  /** Parent directory chosen last time in the site directory picker (plan 5.2). */
  lastParentDir: z.string().nullable(),
});
export type Settings = z.infer<typeof Settings>;

export const SettingsPatch = Settings.partial().strict();
export type SettingsPatch = z.infer<typeof SettingsPatch>;

export const defaultSettings: Settings = { locale: null, lastParentDir: null };
