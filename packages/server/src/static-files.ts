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

export type ResolveResult = { ok: true; file: string } | { ok: false; status: 400 | 404 };

/**
 * Map a URL path to a regular file under `root` (plan 8.4). Rejects encoded traversal, NUL bytes
 * and any symlink on the way (lstat on every segment, answered like a missing file so nothing about
 * the link leaks); directories map to index.html. The realpath must stay inside the root's realpath.
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

  const notFound = { ok: false, status: 404 } as const;
  let current = root;
  try {
    if (fs.lstatSync(current).isSymbolicLink()) return notFound;
    for (const segment of segments) {
      current = path.join(current, segment);
      if (fs.lstatSync(current).isSymbolicLink()) return notFound;
    }
    let st = fs.lstatSync(current);
    if (st.isDirectory()) {
      current = path.join(current, "index.html");
      st = fs.lstatSync(current);
      if (st.isSymbolicLink()) return notFound;
    }
    if (!st.isFile()) return notFound;
    const realRoot = fs.realpathSync(root);
    if (!fs.realpathSync(current).startsWith(realRoot + path.sep)) return notFound;
  } catch {
    return { ok: false, status: 404 };
  }
  return { ok: true, file: current };
}
