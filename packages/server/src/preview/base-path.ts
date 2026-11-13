import fs from "node:fs";
import path from "node:path";
import { isRecord } from "../bukit/guard.ts";
import { parseYaml } from "../panels/yaml.ts";

/** site.yaml is read only up to this size; the pre-build guard refuses larger files anyway. */
const MAX_SITE_YAML = 1024 * 1024;
const MAX_BASE_PATH = 200;
const MAX_SEGMENTS = 10;
/** URL path characters that never need escaping (RFC 3986 unreserved). */
const SEGMENT = /^[A-Za-z0-9._~-]+$/;

export type BasePathResult = { ok: true; basePath: string } | { ok: false; detail: string };

/**
 * The path a preview is served under (plan 16 #8): site.baseUrl as "/" or "/a/b/". The value comes from a
 * site.yaml the AI can edit and becomes part of the preview server's routing and of Bukit's arguments, so
 * only plain segments of unreserved characters are accepted; anything else fails the preview build rather
 * than falling back to "/", which would hide the links that break once published.
 */
export function previewBasePath(baseUrl: unknown): BasePathResult {
  if (baseUrl === undefined || baseUrl === null) return { ok: true, basePath: "/" };
  if (typeof baseUrl !== "string") return { ok: false, detail: "site.baseUrl must be a string" };
  // Bukit trims the value and drops a trailing slash (BuildPathUtils.NormalizeBaseUrl).
  const value = baseUrl.trim();
  if (value === "" || value === "/") return { ok: true, basePath: "/" };
  if (!value.startsWith("/")) return { ok: false, detail: "site.baseUrl must start with /" };
  if (value.length > MAX_BASE_PATH) return { ok: false, detail: `site.baseUrl is longer than ${MAX_BASE_PATH}` };
  const segments = value.replace(/\/+$/, "").slice(1).split("/");
  if (segments.length > MAX_SEGMENTS) return { ok: false, detail: `site.baseUrl has more than ${MAX_SEGMENTS} parts` };
  for (const segment of segments) {
    if (!SEGMENT.test(segment) || segment === "." || segment === "..") {
      return { ok: false, detail: "site.baseUrl may only use letters, digits and . _ ~ - between slashes" };
    }
  }
  return { ok: true, basePath: `/${segments.join("/")}/` };
}

/** previewBasePath of the site.yaml in a checkout that is about to be built (the guard passed its commit). */
export function checkoutBasePath(checkout: string): BasePathResult {
  const file = path.join(checkout, "site.yaml");
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.size > MAX_SITE_YAML) return { ok: false, detail: "site.yaml cannot be read" };
  const { value } = parseYaml(fs.readFileSync(file, "utf8"));
  const site = isRecord(value) && isRecord(value.site) ? value.site : null;
  return previewBasePath(site?.baseUrl);
}
