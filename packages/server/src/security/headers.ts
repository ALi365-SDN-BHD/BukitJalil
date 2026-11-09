/**
 * Response headers for the admin port (plan 11). frame-ancestors / X-Frame-Options stop a
 * preview page from framing the admin UI (clickjacking, measured in M1).
 */
export const ADMIN_CSP = [
  "default-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-src http://127.0.0.1:*",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join("; ");

export const adminHeaders: Record<string, string> = {
  "Content-Security-Policy": ADMIN_CSP,
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
};

/** Preview port headers (plan 8.4): opaque origin, no network, no form posts, no caching. */
export const PREVIEW_CSP = "sandbox allow-scripts allow-popups; connect-src 'none'; form-action 'none'";

export const previewHeaders: Record<string, string> = {
  "Content-Security-Policy": PREVIEW_CSP,
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
};
