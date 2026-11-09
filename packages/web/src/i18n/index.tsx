import { DEFAULT_LOCALE, type ErrorCode, type Locale, SUPPORTED_LOCALES } from "@bukitjalil/shared";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import en from "./en.ts";
import zhCN, { type Messages } from "./zh-CN.ts";

export const catalogs: Record<Locale, Messages> = { "zh-CN": zhCN, en };

export const localeNames: Record<Locale, string> = { "zh-CN": "简体中文", en: "English" };

/** First supported locale in the browser's list; zh-CN when nothing matches (plan 10.1). */
export function detectLocale(languages: readonly string[]): Locale {
  for (const lang of languages) {
    const lower = lang.toLowerCase();
    if (lower.startsWith("zh")) return "zh-CN";
    const exact = SUPPORTED_LOCALES.find((l) => l.toLowerCase() === lower || lower.startsWith(`${l.toLowerCase()}-`));
    if (exact) return exact;
  }
  return DEFAULT_LOCALE;
}

/** Replace {name} placeholders; unknown placeholders stay as they are. */
export function format(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in params ? String(params[key]) : match));
}

interface I18n {
  locale: Locale;
  m: Messages;
  t: (template: string, params?: Record<string, string | number>) => string;
  errorText: (code: ErrorCode) => string;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo<I18n>(() => {
    const m = catalogs[locale];
    return { locale, m, t: format, errorText: (code) => m.errors[code] };
  }, [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n outside I18nProvider");
  return ctx;
}
