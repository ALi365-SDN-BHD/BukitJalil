import { describe, expect, it } from "vitest";
import { buildReport } from "../src/builds/service.ts";
import { notionProblemIn } from "../src/bukit/notion-errors.ts";
import { bukitErrorsIn, mediaProblemIn } from "../src/bukit/report-errors.ts";
import { notionConfigChanges } from "../src/changes/notion-config.ts";
import { notionId } from "../src/data-sources/service.ts";

// Plan 5.4: Notion errors in Bukit's output, Notion config changes in a review, Notion ids.

/** Bukit 2.0.15's error object on stderr with --log-format json. */
const cliError = (message: string) =>
  JSON.stringify(
    {
      schema: "https://bukit.dev/schemas/cli-error.v1.json",
      version: "1.0",
      command: "build",
      exitCode: 2,
      errors: [{ code: "cli-error", message, showUsage: false }],
    },
    null,
    2,
  );

describe("notionProblemIn", () => {
  it("recognises Bukit's Notion failures", () => {
    expect(notionProblemIn(cliError("Notion request failed: 401 Unauthorized"))).toBe("unauthorized");
    expect(notionProblemIn(cliError("Notion request failed: 404 Not Found"))).toBe("not_shared");
    expect(notionProblemIn(cliError("Notion request failed: 403 Forbidden"))).toBe("forbidden");
    expect(notionProblemIn(cliError("Notion request rate limited: 429 Too Many Requests (attempts: 6)."))).toBe(
      "rate_limited",
    );
    expect(
      notionProblemIn(
        cliError(
          "Notion database property 'Published' not found (case-insensitive match). Available properties: Name.",
        ),
      ),
    ).toBe("property_missing");
    expect(notionProblemIn("Error: Notion request failed due to a transport error.")).toBe("network");
    expect(notionProblemIn(cliError("Notion request failed: 400 Bad Request"))).toBeNull();
    expect(notionProblemIn("nothing about it")).toBeNull();
  });

  it("takes the error that stopped the run, not a skipped relation", () => {
    const relation =
      '{"ts":"t","level":"Warn","msg":"event=notion.relation.resolve_failed pageId=p message=Notion request failed: 404 Not Found"}';
    expect(notionProblemIn(relation)).toBeNull();
    expect(notionProblemIn(`${relation}\n${cliError("Notion request failed: 401 Unauthorized")}`)).toBe("unauthorized");
  });

  it("recognises doctor's database check and ignores its connectivity warning", () => {
    expect(notionProblemIn("✖ Notion database check failed: 401 Unauthorized")).toBe("unauthorized");
    expect(notionProblemIn("✖ Notion database check failed: 404 Not Found")).toBe("not_shared");
    expect(notionProblemIn("✖ Notion database check failed: 429 Too Many Requests")).toBe("rate_limited");
    expect(
      notionProblemIn(
        "⚠ Notion API connectivity check failed: Notion request failed due to a transport error.\n✖ theme missing",
      ),
    ).toBeNull();
  });

  it("is only reported for a failed build", () => {
    const run = (exitCode: number) =>
      buildReport({
        exitCode,
        stdout: "",
        stderr: cliError("Notion request failed: 404 Not Found"),
        stopped: null,
        durationMs: 1,
      } as never);
    expect(run(2).notionProblem).toBe("not_shared");
    expect(run(0).notionProblem).toBeUndefined();
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
