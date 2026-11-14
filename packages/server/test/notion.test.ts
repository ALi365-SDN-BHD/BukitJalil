import { describe, expect, it } from "vitest";
import { buildReport } from "../src/builds/service.ts";
import { notionProblemIn, notionSnapshotProblemIn } from "../src/bukit/notion-errors.ts";
import { bukitErrorCodesIn, bukitErrorsIn, mediaProblemIn } from "../src/bukit/report-errors.ts";
import { notionConfigChanges } from "../src/changes/notion-config.ts";
import { notionId } from "../src/data-sources/service.ts";

// Plan 5.4/5.5: Notion errors by Bukit 2.2.0's BKT-0Bxx codes, Notion config changes, Notion ids.

/** Bukit 2.2.0's cli-error object on stderr with --log-format json. */
const cliError = (message: string, code = "BKT-0B06") =>
  JSON.stringify(
    {
      schema: "https://bukit.dev/schemas/cli-error.v1.json",
      version: "1.0",
      command: "build",
      exitCode: 2,
      errors: [{ code, message, showUsage: false }],
    },
    null,
    2,
  );

const line = (code: string, message = "…") => `[${code}] ${message}`;

describe("notionSnapshotProblemIn (plan 5.5)", () => {
  it("maps the snapshot codes", () => {
    for (const [code, problem] of [
      ["BKT-0B10", "stale"],
      ["BKT-0B14", "stale"],
      ["BKT-0B11", "change"],
      ["BKT-0B12", "change"],
      ["BKT-0B13", "change"],
    ] as const) {
      expect(notionSnapshotProblemIn(cliError("x", code))).toBe(problem);
    }
    for (const code of ["BKT-0B15", "BKT-0B16", "BKT-0B17", "BKT-0B01", "cli-error"]) {
      expect(notionSnapshotProblemIn(cliError("x", code))).toBeNull();
    }
  });

  it("reads line-start config-check and doctor codes, not warnings or forwarded lines", () => {
    expect(notionSnapshotProblemIn("", line("BKT-0B11", "Notion offline snapshot has no data"))).toBe("change");
    expect(notionSnapshotProblemIn("", `✖ ${line("BKT-0B10", "Notion offline snapshot error")}`)).toBe("stale");
    expect(notionSnapshotProblemIn("", `⚠ ${line("BKT-0B01", "Notion API unreachable")}`)).toBeNull();
    expect(notionSnapshotProblemIn("", "Error: [BKT-0B11] Worker for language 'zh-CN' failed")).toBeNull();
    expect(notionSnapshotProblemIn("", "prefix BKT-0B11")).toBeNull();
    expect(notionSnapshotProblemIn("", "✔ Notion offline snapshot (format 1)")).toBeNull();
  });

  it("prefers the cli-error code and falls back when it is not a Notion code", () => {
    expect(notionSnapshotProblemIn(cliError("x", "BKT-0B11"), line("BKT-0B10"))).toBe("change");
    expect(notionSnapshotProblemIn(cliError("x", "BKT-0001"), line("BKT-0B11"))).toBe("change");
  });

  it("uses the last cli-error document, not a forwarded child line", () => {
    const stderr = `Error: [BKT-0B14] Internal multilingual build worker failed\n${cliError("x", "BKT-0B11")}`;
    expect(notionSnapshotProblemIn(stderr)).toBe("change");
  });
});

describe("notionProblemIn", () => {
  it("maps the Notion codes", () => {
    for (const [code, problem] of [
      ["BKT-0B01", "unauthorized"],
      ["BKT-0B02", "forbidden"],
      ["BKT-0B03", "not_shared"],
      ["BKT-0B04", "rate_limited"],
      ["BKT-0B05", "property_missing"],
      ["BKT-0B06", "request_failed"],
      ["BKT-0B07", "network"],
      ["BKT-0B08", "request_failed"],
    ] as const) {
      expect(notionProblemIn(cliError("x", code))).toBe(problem);
    }
    expect(notionProblemIn(cliError("x", "BKT-0B10"))).toBeNull();
    expect(notionProblemIn(cliError("x", "cli-error"))).toBeNull();
  });

  it("reads line-start config-check and doctor codes, not warnings or forwarded lines", () => {
    expect(notionProblemIn("", line("BKT-0B03", "Notion database check failed: 404"))).toBe("not_shared");
    expect(notionProblemIn("", `✖ ${line("BKT-0B01", "Notion database check failed: 401")}`)).toBe("unauthorized");
    expect(notionProblemIn("", `⚠ ${line("BKT-0B01", "Notion API unreachable")}`)).toBeNull();
    expect(notionProblemIn("", "Error: [BKT-0B03] Worker for language 'en' failed")).toBeNull();
    expect(notionProblemIn("", "prefix BKT-0B01")).toBeNull();
  });

  it("prefers the cli-error code and takes the error that stopped the run", () => {
    expect(notionProblemIn(cliError("x", "BKT-0B01"), line("BKT-0B03"))).toBe("unauthorized");
    const relation =
      '{"ts":"t","level":"Warn","msg":"event=notion.relation.resolve_failed pageId=p message=Notion request failed: 404 Not Found"}';
    expect(notionProblemIn(relation)).toBeNull();
    expect(notionProblemIn(`${relation}\n${cliError("x", "BKT-0B01")}`)).toBe("unauthorized");
  });

  it("is only reported for a failed build", () => {
    const run = (exitCode: number) =>
      buildReport({
        exitCode,
        stdout: "",
        stderr: cliError("x", "BKT-0B03"),
        stopped: null,
        durationMs: 1,
      } as never);
    expect(run(2).notionProblem).toBe("not_shared");
    expect(run(0).notionProblem).toBeUndefined();
  });
});

describe("bukitErrorCodesIn", () => {
  it("reads the codes of the last cli-error document", () => {
    const log = `${cliError("old", "BKT-0B01")}\nmore\n${cliError("new", "BKT-0B11")}\n`;
    expect(bukitErrorCodesIn(log)).toEqual(["BKT-0B11"]);
    expect(bukitErrorCodesIn("")).toEqual([]);
    expect(bukitErrorCodesIn(JSON.stringify({ schema: "other", errors: [{ code: "BKT-0B01" }] }, null, 2))).toEqual([]);
  });
});

// Plan 8.6: Bukit's own error messages and the missing media placeholder.
describe("bukitErrorsIn", () => {
  it("reads the messages of the last cli-error document", () => {
    const log = `{"ts":"t","level":"Info","msg":"event=x"}\n${cliError("old")}\nmore\n${cliError("Referenced localized media output is missing: assets/images/noneimg-news.jpg")}\n`;
    expect(bukitErrorsIn(log)).toEqual([
      "Referenced localized media output is missing: assets/images/noneimg-news.jpg",
    ]);
  });

  it("caps the count and length, and ignores other JSON", () => {
    const doc = JSON.stringify(
      {
        schema: "https://bukit.dev/schemas/cli-error.v1.json",
        errors: [...Array(7)].map((_, i) => ({ message: `${i}`.repeat(600) })).concat([{ message: 1 } as never]),
      },
      null,
      2,
    );
    const errors = bukitErrorsIn(doc);
    expect(errors).toHaveLength(5);
    expect(errors[0]).toHaveLength(500);
    expect(bukitErrorsIn(JSON.stringify({ schema: "other", errors: [{ message: "x" }] }, null, 2))).toEqual([]);
    expect(bukitErrorsIn("{\nnot json\n}")).toEqual([]);
    expect(bukitErrorsIn("")).toEqual([]);
  });
});

describe("mediaProblemIn", () => {
  const failed = (n: number) =>
    `{"ts":"t","level":"Warn","msg":"event=media.download_failed status=441 source=https://x/a.png"}\n{"ts":"t","level":"Info","msg":"event=media.localize_summary phase=deferred downloaded=3 failed=${n}"}`;

  it("finds the missing placeholder and adds up the failed downloads", () => {
    const log = `${failed(1)}\n${failed(2)}\n${cliError("Referenced localized media output is missing: assets/images/noneimg-news.jpg")}`;
    expect(mediaProblemIn(log)).toEqual({ missing: "assets/images/noneimg-news.jpg", failedDownloads: 3 });
    // Downloaded files missing: `keep` would not help, so only Bukit's message says it.
    expect(mediaProblemIn(cliError("Referenced localized media is missing or unsafe: media/x/a.png"))).toBeNull();
    // A path with a space or backslashes is taken whole from the parsed message.
    expect(mediaProblemIn("", ["Referenced localized media output is missing: assets\\my img.jpg"])).toEqual({
      missing: "assets\\my img.jpg",
      failedDownloads: 0,
    });
    // Bukit 2.1 follows the path with what the placeholder is, the pages and the fixes.
    const detailed =
      "Referenced localized media output is missing: assets/my img.jpg (content.media.defaultImageUrl, the placeholder " +
      "that replaces an image that could not be downloaded or has no URL; …). Referenced by: /a/. To fix: add assets/my img.jpg";
    expect(mediaProblemIn("", [detailed])).toEqual({ missing: "assets/my img.jpg", failedDownloads: 0 });
    expect(mediaProblemIn(failed(1))).toBeNull();
  });

  it("is only reported for a failed build, with Bukit's messages", () => {
    const stderr = `${failed(1)}\n${cliError("Referenced localized media output is missing: assets/images/none.jpg")}`;
    const run = (exitCode: number) =>
      buildReport({ exitCode, stdout: "", stderr, stopped: null, durationMs: 1 } as never);
    expect(run(1).mediaProblem).toEqual({ missing: "assets/images/none.jpg", failedDownloads: 1 });
    expect(run(1).bukitErrors).toEqual(["Referenced localized media output is missing: assets/images/none.jpg"]);
    expect(run(0).mediaProblem).toBeUndefined();
    expect(run(0).bukitErrors).toBeUndefined();
  });
});

describe("notionConfigChanges", () => {
  const site = (...sources: unknown[]) => ({ content: { sources } });
  const src = (name: string | null, notion: Record<string, unknown>) => ({
    type: "notion",
    ...(name ? { name } : {}),
    notion,
  });

  it("lists added, removed and changed sources with the databaseId and the other keys", () => {
    const before = site(
      src("blog", { databaseId: "a", filterProperty: "Published" }),
      src("docs", { databaseId: "d" }),
      { type: "markdown", name: "posts", markdown: { dir: "content/posts" } },
    );
    const after = site(
      src("blog", { databaseId: "b", filterProperty: "Public", propertyMap: { slug: "Slug" } }),
      src("news", { databaseId: "n" }),
      { type: "markdown", name: "posts", markdown: { dir: "content/other" } },
    );
    expect(notionConfigChanges(before, after)).toEqual([
      {
        source: "blog",
        change: "changed",
        databaseId: { before: "a", after: "b" },
        keys: ["filterProperty", "propertyMap"],
      },
      { source: "news", change: "added", databaseId: { before: null, after: "n" }, keys: [] },
      { source: "docs", change: "removed", databaseId: { before: "d", after: null }, keys: [] },
    ]);
  });

  it("names unnamed sources by position, ignores equal ones and unreadable configs", () => {
    const a = site(src(null, { databaseId: "x", cacheMode: "readonly" }));
    expect(notionConfigChanges(a, site(src(null, { databaseId: "x", cacheMode: "readwrite" })))).toEqual([
      { source: "#1", change: "changed", keys: ["cacheMode"] },
    ]);
    expect(notionConfigChanges(a, structuredClone(a))).toEqual([]);
    // A source detected by its notion section alone, and a config that is not YAML (null).
    expect(notionConfigChanges(null, site({ name: "n", notion: { databaseId: "y" } }))).toEqual([
      { source: "n", change: "added", databaseId: { before: null, after: "y" }, keys: [] },
    ]);
  });

  it("matches the type without case, as Bukit does", () => {
    expect(notionConfigChanges(site(), site({ type: "Notion", name: "x", notion: { databaseId: "e" } }))).toEqual([
      { source: "x", change: "added", databaseId: { before: null, after: "e" }, keys: [] },
    ]);
  });

  it("keeps a source named like another's position", () => {
    const after = site(src(null, { databaseId: "a" }), src("#1", { databaseId: "evil" }));
    expect(notionConfigChanges(site(), after)).toEqual([
      { source: "#1", change: "added", databaseId: { before: null, after: "a" }, keys: [] },
      { source: "#1 (#2)", change: "added", databaseId: { before: null, after: "evil" }, keys: [] },
    ]);
  });
});

describe("notionId", () => {
  it("accepts Notion ids with or without dashes and nothing else", () => {
    expect(notionId("01234567-89AB-cdef-0123-456789abcdef")).toBe("0123456789abcdef0123456789abcdef");
    expect(notionId("0123456789abcdef0123456789abcdef")).toBe("0123456789abcdef0123456789abcdef");
    expect(notionId("../users/me")).toBeNull();
    expect(notionId("db_blog")).toBeNull();
    expect(notionId("0123456789abcdef0123456789abcdef?x=1")).toBeNull();
  });
});
