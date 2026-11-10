import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AUDIT_MAX_GROUPS, AUDIT_ROUTES_PER_GROUP } from "@bukitjalil/shared";
import { afterAll, describe, expect, it } from "vitest";
import { auditText, readAudit, SITE_URL_CODES, summarizeGeo, summarizeSeo } from "../src/builds/audit.ts";
import { buildReport, previewEntry } from "../src/builds/service.ts";

// M4 layer 7: the SEO / GEO summary of a build, from the reports Bukit writes into .bukit/.

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bj-audit-")));
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

const issue = (code: string, route = "/", severity = "warning") => ({ severity, code, route, message: `${code} text` });

describe("summarizeSeo", () => {
  it("folds site.url warnings only while site.url is missing", () => {
    const issues = [issue("seo.canonical_not_absolute", "/"), issue("seo.canonical_not_absolute", "/a/"), issue("x")];
    const without = summarizeSeo({ siteUrl: null, issues });
    expect(without).toMatchObject({ warnings: 3, siteUrlMissing: true, siteUrlWarnings: 2 });
    expect(without?.groups.map((g) => g.code)).toEqual(["x"]);
    const withUrl = summarizeSeo({ siteUrl: "https://example.com", issues });
    expect(withUrl).toMatchObject({ siteUrlMissing: false, siteUrlWarnings: 0 });
    expect(withUrl?.groups[0]).toMatchObject({ code: "seo.canonical_not_absolute", count: 2, routes: ["/", "/a/"] });
    // An error is never folded away.
    const error = summarizeSeo({ issues: [issue("seo.canonical_not_absolute", "/", "Error")] });
    expect(error).toMatchObject({ errors: 1, siteUrlWarnings: 0, groups: [{ severity: "error" }] });
  });

  it("sorts errors first, then by count, keeps a few distinct routes and caps the kinds", () => {
    const many = Array.from({ length: AUDIT_ROUTES_PER_GROUP + 3 }, (_, i) => issue("b.many", `/p${i % 6}/`));
    const s = summarizeSeo({
      siteUrl: "https://x.test",
      issues: [issue("a.once"), ...many, issue("c.err", "", "error"), { ...issue("d.info"), severity: "info" }],
    });
    expect(s?.groups.map((g) => [g.code, g.severity])).toEqual([
      ["c.err", "error"],
      ["b.many", "warning"],
      ["a.once", "warning"],
      ["d.info", "info"],
    ]);
    const group = s?.groups[1];
    expect(group?.count).toBe(AUDIT_ROUTES_PER_GROUP + 3);
    expect(group?.routes).toHaveLength(AUDIT_ROUTES_PER_GROUP);
    expect(new Set(group?.routes).size).toBe(AUDIT_ROUTES_PER_GROUP);
    expect(s?.groups[0]?.routes).toEqual([""]);

    const kinds = summarizeSeo({
      siteUrl: "https://x.test",
      issues: Array.from({ length: AUDIT_MAX_GROUPS + 5 }, (_, i) => issue(`k.${i}`)),
    });
    expect(kinds?.groups).toHaveLength(AUDIT_MAX_GROUPS);
    expect(kinds?.groupsTruncated).toBe(true);
  });

  it("cuts long text and rejects reports of the wrong shape", () => {
    const s = summarizeSeo({ siteUrl: "https://x.test", issues: [{ ...issue("x"), message: "m".repeat(5000) }] });
    expect(s?.groups[0]?.message).toHaveLength(300);
    expect(summarizeSeo({ issues: "nope" })).toBeNull();
    expect(summarizeSeo(null)).toBeNull();
    expect(summarizeSeo({ issues: [{ code: 1 }] })).toBeNull();
  });
});

describe("summarizeGeo", () => {
  it("clamps the score and defaults the flags", () => {
    expect(summarizeGeo({ geoScore: 140.4 })).toEqual({
      score: 100,
      llmsTxt: false,
      llmsFullTxt: false,
      enhancedRoutes: 0,
    });
    expect(summarizeGeo({ geoScore: 50, llmsTxtGenerated: true, geoEnhancedCount: 1 })).toMatchObject({
      score: 50,
      llmsTxt: true,
      enhancedRoutes: 1,
    });
    expect(summarizeGeo({ geoScore: "50" })).toBeNull();
  });
});

describe("readAudit", () => {
  const out = (name: string, files: Record<string, string>) => {
    const dir = path.join(base, name);
    fs.mkdirSync(path.join(dir, ".bukit"), { recursive: true });
    for (const [f, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, ".bukit", f), text);
    return dir;
  };

  it("reads both reports, either alone, and nothing from a missing or broken one", () => {
    const seo = JSON.stringify({ siteUrl: null, routes: [{}], issues: [] });
    const geo = JSON.stringify({ geoScore: 25 });
    expect(readAudit(out("both", { "seo-report.json": seo, "geo-report.json": geo }))).toMatchObject({
      seo: { routes: 1, groups: [] },
      geo: { score: 25 },
    });
    expect(readAudit(out("geo-only", { "geo-report.json": geo }))).toMatchObject({ seo: null, geo: { score: 25 } });
    expect(readAudit(out("broken", { "seo-report.json": "{", "geo-report.json": "[]" }))).toBeNull();
    expect(readAudit(path.join(base, "missing"))).toBeNull();
  });

  it("does not follow a link in place of a report", () => {
    const target = path.join(base, "elsewhere.json");
    fs.writeFileSync(target, JSON.stringify({ geoScore: 99 }));
    const dir = out("linked", {});
    fs.symlinkSync(target, path.join(dir, ".bukit", "geo-report.json"));
    expect(readAudit(dir)).toBeNull();
  });
});

describe("auditText", () => {
  it("tells the AI what matters in a few lines", () => {
    const text = auditText({
      seo: summarizeSeo({
        siteUrl: null,
        issues: [issue("seo.og_image_not_absolute"), issue("seo.description_missing", "/a/")],
      }),
      geo: summarizeGeo({ geoScore: 25, llmsTxtGenerated: true }),
    });
    expect(text).toContain("SEO: 0 pages, 0 errors, 2 warnings.");
    expect(text).toContain("site.url is not set");
    expect(text).toContain("seo.description_missing ×1");
    expect(text).not.toContain("seo.og_image_not_absolute ×");
    expect(text).toContain("GEO: score 25/100, llms.txt yes");
    expect(auditText(null)).toBeNull();
    expect(SITE_URL_CODES.has("seo.canonical_not_absolute")).toBe(true);
  });
});

describe("buildReport", () => {
  it("reads the JSON log from stderr and stdout and keeps only other text as output", () => {
    const report = buildReport({
      exitCode: 0,
      stdout: "plain stdout\n",
      stderr: [
        '{"ts":"t","level":"Info","msg":"event=build.start"}',
        '{"ts":"t","level":"Warn","msg":"event=x a=1"}',
        '{"ts":"t","level":"Warn","msg":"publish.audit severity=warning code=publish.time_missing route=/ message=m"}',
        '{"ts":"t","level":"Warn","msg":"event=diagnostics.summary kind=seo.audit:seo.canonical_not_absolute total=15"}',
        '{"ts":"t","level":"Warn","msg":"seo.site_url_missing absolute SEO URLs require site.url."}',
        '{"ts":"t","level":"Warn","msg":"event=diagnostics.summary kind=route.slow total=2"}',
        '{"ts":"t","level":"Error","msg":"seo.audit severity=error code=seo.x route=/ message=m"}',
        "plain stderr",
      ].join("\n"),
      durationMs: 1,
      stopped: null,
    });
    expect(report.messages).toEqual([
      { level: "Warn", msg: "event=x a=1" },
      { level: "Warn", msg: "event=diagnostics.summary kind=route.slow total=2" },
      { level: "Error", msg: "seo.audit severity=error code=seo.x route=/ message=m" },
    ]);
    expect(report.output).toBe("plain stderr\nplain stdout");
  });
});

describe("previewEntry", () => {
  const output = (name: string, homes: string[], root = false) => {
    const dir = path.join(base, name);
    for (const h of homes) {
      fs.mkdirSync(path.join(dir, h), { recursive: true });
      fs.writeFileSync(path.join(dir, h, "index.html"), h);
    }
    fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
    if (root) fs.writeFileSync(path.join(dir, "index.html"), "root");
    return dir;
  };
  const checkout = (name: string, yaml: string) => {
    const dir = path.join(base, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "site.yaml"), yaml);
    return dir;
  };

  it("sends a multilingual output to the default language's home", () => {
    const co = checkout("co-default", "site:\n  language: en-US\n  defaultLanguage: zh-CN\n");
    expect(previewEntry(co, output("multi", ["en-US", "zh-CN"]))).toBe("/zh-CN/");
    const lang = checkout("co-lang", "site:\n  language: zh-CN\n");
    expect(previewEntry(lang, output("multi-lang", ["en-US", "zh-CN"]))).toBe("/zh-CN/");
    // An unknown or missing language falls back to the first home in order.
    const none = checkout("co-none", "site: [\n");
    expect(previewEntry(none, output("multi-none", ["zh-CN", "en-US"]))).toBe("/en-US/");
  });

  it("leaves an output with a root home page, or without any home, alone", () => {
    const co = checkout("co-plain", "site:\n  language: zh-CN\n");
    expect(previewEntry(co, output("plain", ["zh-CN"], true))).toBeUndefined();
    expect(previewEntry(co, output("empty", []))).toBeUndefined();
    expect(previewEntry(co, path.join(base, "no-such-output"))).toBeUndefined();
  });
});
