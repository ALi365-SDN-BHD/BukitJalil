import fs from "node:fs";
import path from "node:path";
import { SiteLanguage, SiteName } from "@bukitjalil/shared";
import { parseDocument } from "yaml";
import type { BukitService } from "../bukit/locate.ts";
import { usableRunner } from "../bukit/runner.ts";
import type { GitRunner } from "../git/run.ts";
import { SiteError } from "./location.ts";

/**
 * A new site's starting files (plan 5.2): the bundled Bukit's `bukit new` writes them, so the starter theme
 * follows Bukit. BukitJalil only replaces the content sources when the user picked Notion databases.
 * Checking where the site may be created belongs to the caller; this only needs an empty or missing target.
 */

export interface StarterSource {
  type: "markdown" | "notion";
  name: string;
  mode?: "content" | "data";
  collection?: string;
  markdown?: { dir: string };
  notion?: { databaseId: string };
}

export interface StarterValues {
  /** Display name: site.title and the theme's brand and footer text. */
  title: string;
  /** BCP 47 tag, e.g. "zh-CN" or "en-US"; a Simplified Chinese one gets the theme's text in Chinese. */
  language: string;
}

/** Writes the starter into `target` (missing or empty), or throws and leaves nothing of its own behind. */
export type NewSite = (target: string, values: StarterValues) => Promise<void>;

export function validateStarterValues(values: StarterValues): string | null {
  // The same rules as the API request (shared SiteName / SiteLanguage), so a valid request never fails here.
  const title = SiteName.safeParse(values.title);
  if (!title.success) {
    return title.error.issues.some((i) => i.code === "custom")
      ? "title must not contain control characters"
      : "title must be 1-200 characters";
  }
  if (!SiteLanguage.safeParse(values.language).success) return "language must be a BCP 47 tag like zh-CN";
  return null;
}

/** Bukit's output in an error detail stays short. */
const MAX_DETAIL = 500;

/**
 * `bukit new` with the bundled Bukit. The values go as `--opt=value`, so a title starting with "-" is not
 * read as an option; `bukit new` runs no git, build or network, and removes what it wrote when it fails.
 */
export function bukitNewSite(
  bukit: BukitService,
  runnerOpts: { git: GitRunner; home: string; tmpDir: string },
): NewSite {
  return async (target, values) => {
    const problem = validateStarterValues(values);
    if (problem) throw new SiteError("request.invalid_body", 400, { detail: problem });
    const runner = await usableRunner(bukit, runnerOpts);
    if (!runner) throw new SiteError("build.bukit_missing", 409);
    fs.mkdirSync(runnerOpts.tmpDir, { recursive: true, mode: 0o700 });
    const result = await runner.run(
      "new",
      ["new", target, `--title=${values.title.trim()}`, `--language=${values.language}`],
      { cwd: runnerOpts.tmpDir },
    );
    if (result.stopped !== null || result.exitCode !== 0) {
      const detail = (result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`).slice(0, MAX_DETAIL);
      throw new SiteError("site.create_failed", 500, { detail });
    }
    const file = path.join(target, "site.yaml");
    if (!fs.existsSync(file)) {
      throw new SiteError("site.create_failed", 500, { detail: "bukit new wrote no site.yaml" });
    }
    dropDocumentEnd(file);
  };
}

/**
 * `bukit new` ends site.yaml with the YAML document end marker "...". Settings later appended to the file
 * would start a second document, which BukitJalil's reader refuses, so the marker is dropped.
 */
export function dropDocumentEnd(file: string): void {
  const yaml = fs.readFileSync(file, "utf8");
  if (yaml.endsWith("\n...\n")) fs.writeFileSync(file, yaml.slice(0, -"...\n".length));
}

/** Replace site.yaml's content sources with the ones picked for a new site, keeping the rest of the file. */
export function writeSources(target: string, sources: StarterSource[]): void {
  const file = path.join(target, "site.yaml");
  const doc = parseDocument(fs.readFileSync(file, "utf8"));
  if (doc.errors.length > 0) throw new Error(`site.yaml is invalid: ${doc.errors[0]?.message}`);
  doc.setIn(["content", "sources"], sources);
  fs.writeFileSync(file, doc.toString());
}
