/** Default ports (plan 3.3). The preview pool starts at PREVIEW_PORT_BASE and grows upward. */
export const DEFAULT_ADMIN_PORT = 47880;
export const DEFAULT_PREVIEW_PORT_BASE = 47881;
export const DEV_WEB_PORT = 47890;

/** Every non-GET API request must carry this header with value "1" (plan 11, cross-site requests). */
export const CSRF_HEADER = "x-bukitjalil";
export const CSRF_HEADER_VALUE = "1";

/** Session cookie set after the one-time token check. */
export const SESSION_COOKIE = "bj_session";

export const SUPPORTED_LOCALES = ["zh-CN", "en"] as const;
export const DEFAULT_LOCALE: (typeof SUPPORTED_LOCALES)[number] = "zh-CN";
