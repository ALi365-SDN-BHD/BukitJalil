import type { AuditIssue } from "@bukitjalil/shared";
import { describe, expect, it } from "vitest";
import en from "@/i18n/en.ts";
import { format } from "@/i18n/index.tsx";
import { DRAFT_MAX_ISSUES, fixDraft, summaryDraft } from "./SeoPanel";

const issue = (n: number, route = "/a/"): AuditIssue => ({
  severity: "warning",
  code: `seo.k${n}`,
  route,
  message: `m${n}`,
});

describe("fixDraft (plan 10.4)", () => {
  it("lists the issues of the filter, names the page and counts what is left out", () => {
    const one = fixDraft(en.seo, format, [issue(1, "")], "");
    expect(one).toContain("that concern the site as a whole");
    expect(fixDraft(en.seo, format, [issue(1)], "/a/")).toContain("on the page /a/");
    expect(one).toContain("- [warning] seo.k1 · whole site: m1");
    expect(fixDraft(en.seo, format, [issue(1)], null)).not.toContain("on the page");

    const many = Array.from({ length: DRAFT_MAX_ISSUES + 5 }, (_, i) => issue(i));
    const text = fixDraft(en.seo, format, many, null);
    expect(text.split("\n").filter((l) => l.startsWith("- ["))).toHaveLength(DRAFT_MAX_ISSUES);
    expect(text).toContain("(and 5 more)");
  });

  it("says when it can only give the summary, one line per kind with its count", () => {
    const text = summaryDraft(
      en.seo,
      format,
      {
        summary: {
          seo: {
            routes: 9,
            errors: 0,
            warnings: 200,
            siteUrlMissing: false,
            siteUrlWarnings: 0,
            groups: [
              { code: "seo.k", severity: "warning", count: 200, message: "m", routes: ["", "/a/"], moreRoutes: true },
            ],
            groupsTruncated: false,
          },
          geo: null,
        },
      } as never,
      "Whole site",
    );
    expect(text).toContain("Build first to see every issue.");
    expect(text).toContain("- [warning] seo.k · 200×, pages: Whole site, /a/, …: m");
  });
});
