import fs from "node:fs";
import path from "node:path";
import { AUDIT_MAX_GROUPS, AUDIT_ROUTES_PER_GROUP, type AuditIssueGroup, type BuildAudit } from "@bukitjalil/shared";
import { z } from "zod";

/**
 * SEO / GEO summary of a build (plan 8.3, M4 layer 7). Bukit writes `.bukit/seo-report.json` and
 * `.bukit/geo-report.json` into every build output; `bukit seo audit` / `bukit geo audit` only read them back
 * and print text, so the reports are read here directly. The output comes from site content the AI may have
 * written, so the files are size-capped, checked against a loose schema, and anything odd means "no report".
 */

const MAX_SEO_REPORT = 16 * 1024 * 1024;
const MAX_GEO_REPORT = 1024 * 1024;
const MAX_TEXT = 300;

/**
 * Issues Bukit 2.0.12 raises only because site.yaml has no site.url (a starter site goes from 81 warnings to 2
 * once it is set). While site.url is missing they are folded into one hint instead of listed one by one.
 */
export const SITE_URL_CODES: ReadonlySet<string> = new Set([
  "seo.canonical_not_absolute",
  "seo.og_image_not_absolute",
  "seo.twitter_image_not_absolute",
  "seo.schema_website_url_invalid",
  "seo.schema_breadcrumb_item_url_not_absolute",
  "seo.schema_itemlist_url_missing",
  "publish.sitemap_missing_route",
  "publish.rss_missing_route",
]);

const SeoReport = z.object({
  siteUrl: z.string().nullable().optional(),
  routes: z.array(z.unknown()).optional(),
  issues: z.array(
    z.object({
      severity: z.string(),
      code: z.string(),
      route: z.string().nullable().optional(),
      message: z.string().nullable().optional(),
    }),
  ),
});

const GeoReport = z.object({
  geoScore: z.number().finite(),
  llmsTxtGenerated: z.boolean().optional(),
  llmsFullTxtGenerated: z.boolean().optional(),
  geoEnhancedCount: z.number().int().nonnegative().optional(),
});

/** A regular file of at most `max` bytes, parsed as JSON; null when missing, too large, a link or not JSON. */
function readJson(file: string, max: number): unknown {
  let fd: number;
  try {
    // O_NOFOLLOW: a link in place of the report is refused rather than followed.
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  } catch {
    return null;
  }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > max) return null;
    return JSON.parse(fs.readFileSync(fd, "utf8"));
  } catch {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

const severityOf = (s: string): AuditIssueGroup["severity"] => {
  const v = s.toLowerCase();
  return v === "error" || v === "fatal" || v === "critical" ? "error" : v === "info" ? "info" : "warning";
};

const RANK = { error: 0, warning: 1, info: 2 } as const;

export function summarizeSeo(raw: unknown): BuildAudit["seo"] {
  const parsed = SeoReport.safeParse(raw);
  if (!parsed.success) return null;
  const report = parsed.data;
  const siteUrlMissing = !report.siteUrl;
  const groups = new Map<string, AuditIssueGroup>();
  let errors = 0;
  let warnings = 0;
  let siteUrlWarnings = 0;
  for (const issue of report.issues) {
    const severity = severityOf(issue.severity);
    if (severity === "error") errors++;
    else if (severity === "warning") warnings++;
    if (siteUrlMissing && severity !== "error" && SITE_URL_CODES.has(issue.code)) {
      siteUrlWarnings++;
      continue;
    }
    const code = issue.code.slice(0, 100);
    const key = `${severity}:${code}`;
    let group = groups.get(key);
    if (!group) {
      group = { code, severity, count: 0, message: (issue.message ?? "").slice(0, MAX_TEXT), routes: [] };
      groups.set(key, group);
    }
    group.count++;
    const route = (issue.route ?? "").slice(0, MAX_TEXT);
    if (group.routes.length < AUDIT_ROUTES_PER_GROUP && !group.routes.includes(route)) group.routes.push(route);
  }
  const sorted = [...groups.values()].sort(
    (a, b) => RANK[a.severity] - RANK[b.severity] || b.count - a.count || a.code.localeCompare(b.code),
  );
  return {
    routes: report.routes?.length ?? 0,
    errors,
    warnings,
    siteUrlMissing,
    siteUrlWarnings,
    groups: sorted.slice(0, AUDIT_MAX_GROUPS),
    groupsTruncated: sorted.length > AUDIT_MAX_GROUPS,
  };
}

export function summarizeGeo(raw: unknown): BuildAudit["geo"] {
  const parsed = GeoReport.safeParse(raw);
  if (!parsed.success) return null;
  const r = parsed.data;
  return {
    score: Math.max(0, Math.min(100, Math.round(r.geoScore))),
    llmsTxt: r.llmsTxtGenerated ?? false,
    llmsFullTxt: r.llmsFullTxtGenerated ?? false,
    enhancedRoutes: r.geoEnhancedCount ?? 0,
  };
}

/** The audit summary of a build output directory, or null when it holds neither report. */
export function readAudit(outputDir: string): BuildAudit | null {
  const dir = path.join(outputDir, ".bukit");
  const seo = summarizeSeo(readJson(path.join(dir, "seo-report.json"), MAX_SEO_REPORT));
  const geo = summarizeGeo(readJson(path.join(dir, "geo-report.json"), MAX_GEO_REPORT));
  return seo || geo ? { seo, geo } : null;
}

/** A few lines for the AI's bukit_build result, so it can act on the findings. */
export function auditText(audit: BuildAudit | null): string | null {
  if (!audit) return null;
  const lines: string[] = [];
  if (audit.seo) {
    const s = audit.seo;
    lines.push(`SEO: ${s.routes} pages, ${s.errors} errors, ${s.warnings} warnings.`);
    if (s.siteUrlMissing)
      lines.push(
        `- site.url is not set in site.yaml: ${s.siteUrlWarnings} warnings about relative canonical/image/structured-data URLs come from that alone. Leave it unless the user gives the site's address.`,
      );
    for (const g of s.groups.slice(0, 10)) {
      const where = g.routes.map((r) => r || "(site)").join(", ");
      lines.push(`- ${g.severity} ${g.code} ×${g.count}: ${g.message}${where ? ` [${where}]` : ""}`);
    }
    if (s.groups.length > 10 || s.groupsTruncated) lines.push("- (more issue kinds not listed)");
  }
  if (audit.geo) {
    const g = audit.geo;
    lines.push(
      `GEO: score ${g.score}/100, llms.txt ${g.llmsTxt ? "yes" : "no"}, llms-full.txt ${g.llmsFullTxt ? "yes" : "no"}, ${g.enhancedRoutes} pages with geo front matter (geo.faq, geo.steps, geo.schema_type).`,
    );
  }
  return lines.join("\n");
}
