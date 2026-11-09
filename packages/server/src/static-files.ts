import fs from "node:fs";
import path from "node:path";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
  ".pdf": "application/pdf",
};

export function contentType(file: string): string {
  return MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

export type ResolveResult = { ok: true; file: string } | { ok: false; status: 400 | 403 | 404 };

/**
 * Map a URL path to a regular file under `root` (plan 8.4). Rejects encoded traversal, NUL bytes
 * and any symlink on the way (checked with lstat on every segment); directories map to index.html.
 */
export function resolveStaticFile(root: string, urlPath: string): ResolveResult {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0] ?? "/");
  } catch {
    return { ok: false, status: 400 };
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return { ok: false, status: 400 };
  const segments = decoded.split("/").filter((s) => s.length > 0);
  if (segments.some((s) => s === "." || s === "..")) return { ok: false, status: 400 };

  let current = root;
  try {
    if (fs.lstatSync(current).isSymbolicLink()) return { ok: false, status: 403 };
    for (const segment of segments) {
      current = path.join(current, segment);
      const st = fs.lstatSync(current);
      if (st.isSymbolicLink()) return { ok: false, status: 403 };
    }
    let st = fs.lstatSync(current);
    if (st.isDirectory()) {
      current = path.join(current, "index.html");
      st = fs.lstatSync(current);
      if (st.isSymbolicLink()) return { ok: false, status: 403 };
    }
    if (!st.isFile()) return { ok: false, status: 404 };
  } catch {
    return { ok: false, status: 404 };
  }
  return { ok: true, file: current };
}
