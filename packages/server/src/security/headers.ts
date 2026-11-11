import crypto from "node:crypto";

/**
 * Placeholder Vite writes into the built index.html (`html.cspNonce` in packages/web/vite.config.ts);
 * the server replaces it with a fresh nonce on every response.
 */
export const CSP_NONCE_PLACEHOLDER = "BJ_CSP_NONCE";

export const newCspNonce = () => crypto.randomBytes(16).toString("base64");

/**
 * Admin port CSP (plan 11). frame-ancestors / X-Frame-Options stop a preview page from framing the
 * admin UI (clickjacking, measured in M1). Pages served with a nonce may add <style> elements carrying
 * it: Radix (shadcn dialogs, selects) injects its scroll-lock styles that way.
 */
export function adminCsp(nonce: string | null): string {
  return [
    "default-src 'self'",
    nonce ? `style-src 'self' 'nonce-${nonce}'` : null,
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "frame-src http://127.0.0.1:*",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ]
    .filter((d) => d !== null)
    .join("; ");
}

export const adminHeaders: Record<string, string> = {
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
