import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AUDIT_MAX_GROUPS, AUDIT_MAX_ISSUES, AUDIT_ROUTES_PER_GROUP, type BuildAudit } from "@bukitjalil/shared";
import { afterAll, describe, expect, it } from "vitest";
import {
  auditText,
  compareAudits,
  readAudit,
  readIssues,
  SITE_URL_CODES,
  summarizeGeo,
  summarizeSeo,
} from "../src/builds/audit.ts";
import { buildReport, previewEntry, siteLanguage } from "../src/builds/service.ts";

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
    // Nor is an info: the hint counts warnings only.
    const info = summarizeSeo({ issues: [issue("seo.canonical_not_absolute", "/", "info")] });
    expect(info).toMatchObject({ warnings: 0, siteUrlWarnings: 0, groups: [{ severity: "info" }] });
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
    expect(group?.moreRoutes).toBe(true);
    expect(s?.groups[0]).toMatchObject({ routes: [""], moreRoutes: false });

    // Many issues on the listed pages only: nothing more to show.
    const same = Array.from({ length: 12 }, (_, i) => issue("e.same", `/q${i % AUDIT_ROUTES_PER_GROUP}/`));
    const full = summarizeSeo({ siteUrl: "https://x.test", issues: same });
    expect(full?.groups[0]).toMatchObject({ count: 12, moreRoutes: false });
    expect(full?.groups[0]?.routes).toHaveLength(AUDIT_ROUTES_PER_GROUP);

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

  it("counts entries per source of a successful build, once per source (plan 5.5)", () => {
    const line = (source: string, count: number) =>
      `{"ts":"t","level":"Info","msg":"event=content.source.loaded source=${source} count=${count}"}`;
    // A multilingual build loads each source once per language.
    const stdout = [line("posts", 3), line("pages", 0), line("posts", 3)].join("\n");
    const run = (exitCode: number) => buildReport({ exitCode, stdout, stderr: "", durationMs: 1, stopped: null });
    expect(run(0).sources).toEqual([
      { name: "posts", count: 3 },
      { name: "pages", count: 0 },
    ]);
    expect(run(0).messages).toEqual([]);
    expect(run(2).sources).toBeUndefined();
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
  it("sends a multilingual output to the default language's home", () => {
    expect(previewEntry(output("multi", ["en-US", "zh-CN"]), "zh-CN")).toBe("/zh-CN/");
    // An unknown or missing language falls back to the first home in order.
    expect(previewEntry(output("multi-other", ["zh-CN", "en-US"]), "ms-MY")).toBe("/en-US/");
    expect(previewEntry(output("multi-none", ["zh-CN", "en-US"]), null)).toBe("/en-US/");
  });

  it("reads the default language from site.yaml text", () => {
    expect(siteLanguage("site:\n  language: en-US\n  defaultLanguage: zh-CN\n")).toBe("zh-CN");
    expect(siteLanguage("site:\n  language: zh-CN\n")).toBe("zh-CN");
    expect(siteLanguage("site:\n  language: 3\n")).toBeNull();
    // Bukit 2.1 (plan 8.7): the first of site.languages is the default unless defaultLanguage says otherwise.
    expect(siteLanguage("site:\n  languages: [en, de]\n")).toBe("en");
    expect(siteLanguage("site:\n  languages: [en, de]\n  defaultLanguage: de\n")).toBe("de");
    expect(siteLanguage("site:\n  languages: [en]\n  language: fr\n")).toBe("en");
    expect(siteLanguage("site: [\n")).toBeNull();
    expect(siteLanguage("")).toBeNull();
  });

  it("leaves an output with a root home page, or without any home, alone", () => {
    expect(previewEntry(output("plain", ["zh-CN"], true), "zh-CN")).toBeUndefined();
    expect(previewEntry(output("empty", []), "zh-CN")).toBeUndefined();
    expect(previewEntry(path.join(base, "no-such-output"), "zh-CN")).toBeUndefined();
  });
});

describe("readIssues (plan 10.4)", () => {
  const out = (name: string, report: unknown) => {
    const dir = path.join(base, name);
    fs.mkdirSync(path.join(dir, ".bukit"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".bukit", "seo-report.json"), JSON.stringify(report));
    return dir;
  };

  it("lists every issue, sorted, folding site.url warnings and cutting long text", () => {
    const dir = out("issues", {
      siteUrl: null,
      issues: [
        issue("b.warn", "/z/"),
        issue("b.warn", "/a/"),
        issue("seo.canonical_not_absolute", "/"),
        issue("seo.canonical_not_absolute", "/", "error"),
        { severity: "info", code: "c".repeat(150), route: null, message: "m".repeat(400) },
      ],
    });
    const r = readIssues(dir);
    expect(r?.truncated).toBe(false);
    expect(r?.issues.map((i) => [i.severity, i.code.startsWith("ccc") ? "long" : i.code, i.route])).toEqual([
      ["error", "seo.canonical_not_absolute", "/"],
      ["warning", "b.warn", "/a/"],
      ["warning", "b.warn", "/z/"],
      ["info", "long", ""],
    ]);
    expect(r?.issues[3]?.code).toHaveLength(100);
    expect(r?.issues[3]?.message).toHaveLength(300);
  });

  it("caps the list and refuses odd reports", () => {
    const many = Array.from({ length: AUDIT_MAX_ISSUES + 2 }, (_, i) => issue("k", `/p${i}/`));
    const r = readIssues(out("many", { siteUrl: "https://x.test", issues: many }));
    expect(r?.issues).toHaveLength(AUDIT_MAX_ISSUES);
    expect(r?.truncated).toBe(true);
    expect(readIssues(out("odd", { issues: "nope" }))).toBeNull();
    expect(readIssues(path.join(base, "missing"))).toBeNull();
    // A link in place of the report is not followed.
    const linked = path.join(base, "linked");
    fs.mkdirSync(path.join(linked, ".bukit"), { recursive: true });
    fs.symlinkSync(
      path.join(base, "issues", ".bukit", "seo-report.json"),
      path.join(linked, ".bukit", "seo-report.json"),
    );
    expect(readIssues(linked)).toBeNull();
  });
});

describe("compareAudits (plan 10.4)", () => {
  const group = (code: string, count: number, severity: "error" | "warning" | "info" = "warning") => ({
    code,
    severity,
    count,
    message: code,
    routes: [],
  });
  const audit = (
    groups: ReturnType<typeof group>[],
    opts: { truncated?: boolean; score?: number } = {},
  ): BuildAudit => ({
    seo: {
      routes: 1,
      errors: groups.filter((g) => g.severity === "error").reduce((n, g) => n + g.count, 0),
      warnings: groups.filter((g) => g.severity === "warning").reduce((n, g) => n + g.count, 0),
      siteUrlMissing: false,
      siteUrlWarnings: 0,
      groups,
      groupsTruncated: opts.truncated ?? false,
    },
    geo: opts.score === undefined ? null : { score: opts.score, llmsTxt: false, llmsFullTxt: false, enhancedRoutes: 0 },
  });

  it("marks kinds new, fixed, more, fewer and same", () => {
    const c = compareAudits(
      audit([group("a", 2), group("b", 1), group("c", 3), group("e", 1, "error")], { score: 40 }),
      null,
      audit([group("a", 1), group("b", 2), group("c", 3), group("d", 1)], { score: 50 }),
    );
    expect(c?.groups.map((g) => [g.code, g.change])).toEqual([
      ["e", "new"],
      ["c", "same"],
      ["a", "more"],
      ["b", "fewer"],
      ["d", "fixed"],
    ]);
    expect(c).toMatchObject({ errors: 1, warnings: -1, geoScore: -10, previousTruncated: false });
  });

  it("counts from the full list when given, and never guesses past a cut summary", () => {
    const current = audit([group("a", 1)], { truncated: true });
    const issues = [issue("a"), issue("a"), issue("z")].map((i) => ({ ...i, severity: "warning" as const }));
    const full = compareAudits(current, issues, audit([group("a", 2), group("y", 1)], { truncated: true }));
    expect(full?.groups.map((g) => [g.code, g.change, g.previous])).toEqual([
      ["a", "same", 2],
      ["z", "unknown", null],
      ["y", "fixed", 1],
    ]);
    expect(full?.previousTruncated).toBe(true);
    // Without the list, a kind the cut current summary does not hold is not called fixed.
    const cut = compareAudits(current, null, audit([group("a", 1), group("y", 1)]));
    expect(cut?.groups.find((g) => g.code === "y")?.change).toBe("unknown");
  });

  it("does not call site.url warnings new or fixed when site.url was set or removed in between", () => {
    const withUrl = audit([group("seo.canonical_not_absolute", 2), group("x", 1)]);
    const without = audit([group("x", 1)]);
    if (without.seo) without.seo.siteUrlMissing = true;
    const added = compareAudits(withUrl, null, without);
    expect(added?.groups.map((g) => [g.code, g.change, g.previous])).toEqual([
      ["seo.canonical_not_absolute", "unknown", null],
      ["x", "same", 1],
    ]);
    const removed = compareAudits(without, null, withUrl);
    expect(removed?.groups.find((g) => g.code === "seo.canonical_not_absolute")?.change).toBe("unknown");
  });

  it("compares the GEO score alone when a side has no SEO report", () => {
    const geoOnly: BuildAudit = { seo: null, geo: { score: 30, llmsTxt: true, llmsFullTxt: false, enhancedRoutes: 0 } };
    expect(compareAudits(geoOnly, null, audit([], { score: 20 }))).toMatchObject({
      groups: [],
      errors: null,
      warnings: null,
      geoScore: 10,
    });
    expect(compareAudits(geoOnly, null, audit([]))).toBeNull();
  });
});
