import { DEFAULT_LOCALE, type ErrorCode, type Locale, SUPPORTED_LOCALES } from "@bukitjalil/shared";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import { ApiRequestError } from "@/lib/api";
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
  /** An API error code (with its params) in the current language. */
  errorText: (code: ErrorCode, params?: Record<string, string | number | boolean>) => string;
  /** Any thrown value as text: API errors are translated, anything else means the server is unreachable. */
  errorOf: (err: unknown) => string;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo<I18n>(() => {
    const m = catalogs[locale];
    const errorText: I18n["errorText"] = (code, params = {}) =>
      format(m.errors[code], Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])));
    // fetch rejects with a TypeError only when the server cannot be reached; anything else is a client-side
    // failure (an unexpected response shape, a bug) and says so.
    const errorOf = (err: unknown) => {
      if (err instanceof ApiRequestError) return errorText(err.code, err.params);
      if (err instanceof TypeError && /fetch|network|load failed/i.test(err.message)) return m.status.unreachable;
      return format(m.status.failed, { message: err instanceof Error ? err.message : String(err) });
    };
    return { locale, m, t: format, errorText, errorOf };
  }, [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n outside I18nProvider");
  return ctx;
}
