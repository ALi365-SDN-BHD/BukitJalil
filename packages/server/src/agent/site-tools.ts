import fs from "node:fs";
import path from "node:path";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { auditText } from "../builds/audit.ts";
import { isRecord, pathProblem } from "../bukit/guard.ts";
import { summarizeConfig } from "../panels/service.ts";
import { parseFrontMatter, parseYaml } from "../panels/yaml.ts";
import type { AiBukit, BuildResult, CheckResult } from "./ai-bukit.ts";
import { GateError, type PathGate, segmentKey } from "./gate.ts";

/**
 * The site tools (plan 6.3). Their parameters are names and small values, never paths: whatever they
 * read goes through the gate, and the Bukit tools run through AiBukit (lock, snapshot, guard).
 */
export const SITE_TOOLS = [
  "site_info",
  "list_content",
  "bukit_check",
  "bukit_build",
  "bukit_schema",
  "summarize_changes",
] as const;

const MAX_CONFIG_BYTES = 256 * 1024;
const MAX_CONTENT_FILES = 500;
const MAX_CONTENT_FILE_BYTES = 256 * 1024;
const MAX_SCHEMA_CHARS = 60_000;
export const MAX_SUMMARY_CHARS = 2000;

export interface SiteToolOptions {
  siteId: string;
  /** The working copy (the session's cwd). */
  cwd: string;
  gate: PathGate;
  bukit: AiBukit;
  /** summarize_changes: the summary for the user's review (stored with the change set in M4). */
  onSummary: (summary: string) => void;
}

type Result = { content: { type: "text"; text: string }[]; details: unknown };
const text = (value: string, details: unknown = null): Result => ({
  content: [{ type: "text", text: value }],
  details,
});
const json = (value: unknown): Result => text(JSON.stringify(value, null, 2), value);

/** A JSON Schema object (Pi validates tool arguments against any JSON Schema). */
const object = (properties: Record<string, unknown>, required: string[] = []) =>
  ({ type: "object", properties, required, additionalProperties: false }) as never;

export function createSiteTools(opts: SiteToolOptions): ToolDefinition[] {
  const { cwd, gate } = opts;

  /** site.yaml from the working copy, through the gate; parse errors are returned, not thrown. */
  const readConfig = (): { config: Record<string, unknown> | null; error: string | null } => {
    const real = gate.check(path.join(cwd, "site.yaml"), "read");
    const st = fs.statSync(real, { throwIfNoEntry: false });
    if (!st?.isFile()) return { config: null, error: "site.yaml does not exist" };
    if (st.size > MAX_CONFIG_BYTES) return { config: null, error: "site.yaml is too large" };
    const parsed = parseYaml(fs.readFileSync(real, "utf8"));
    if (parsed.error !== null) return { config: null, error: parsed.error };
    return isRecord(parsed.value) ? { config: parsed.value, error: null } : { config: null, error: "not a mapping" };
  };

  const tools: ToolDefinition[] = [
    {
      name: "site_info",
      label: "Site info",
      description:
        "Summary of site.yaml in the working copy: site title, URL, languages, collections, content sources, theme, plugins.",
      parameters: object({}),
      async execute() {
        const { config, error } = readConfig();
        return json(config ? summarizeConfig(config) : { error });
      },
    },
    {
      name: "list_content",
      label: "List content",
      description:
        "List the Markdown files of the site's content sources with a front matter summary (title, slug, publishAt, draft, keys). Optionally only the sources of one collection.",
      parameters: object({ collection: { type: "string", description: "Collection name from site_info" } }),
      async execute(_id, params: { collection?: string }) {
        const { config, error } = readConfig();
        if (!config) return json({ error });
        return json(listContent(config, params.collection, cwd, gate));
      },
    },
    {
      name: "bukit_check",
      label: "Bukit check",
      description:
        "Check the site like `bukit config check` and `bukit doctor`: configuration, content and templates. Run it after changing files.",
      parameters: object({}),
      executionMode: "sequential",
      async execute(_id, _params, signal) {
        return json(formatCheck(await opts.bukit.check(opts.siteId, cwd, signal)));
      },
    },
    {
      name: "bukit_build",
      label: "Bukit build",
      description:
        "Build the site like `bukit build` into a temporary folder and report success, page count, errors and an SEO / GEO summary (seoGeo) from Bukit's reports. Run it after bukit_check passes.",
      parameters: object({}),
      executionMode: "sequential",
      async execute(_id, _params, signal) {
        return json(formatBuild(await opts.bukit.build(opts.siteId, cwd, signal)));
      },
    },
    {
      name: "bukit_schema",
      label: "Bukit schema",
      description:
        "The JSON Schema of site.yaml (`bukit config schema`). Pass a top-level section (e.g. site, content, theme, build) to get only that part.",
      parameters: object({ section: { type: "string", description: "Top-level site.yaml key" } }),
      async execute(_id, params: { section?: string }) {
        const schema = await opts.bukit.configSchema();
        return text(schemaText(schema, params.section));
      },
    },
    {
      name: "summarize_changes",
      label: "Summarize changes",
      description:
        "When you have finished a round of changes, describe them for the user's review: a short title line (at most 72 characters), a blank line, then a few sentences on what changed and why. It becomes the commit message when the user applies the changes.",
      parameters: object(
        {
          summary: { type: "string", minLength: 1, maxLength: MAX_SUMMARY_CHARS, description: "What changed and why" },
        },
        ["summary"],
      ),
      async execute(_id, params: { summary: string }) {
        opts.onSummary(params.summary.trim());
        return text("Saved. The user sees this summary with your changes.");
      },
    },
  ];
  return tools;
}

// --- results the model reads ---

/** Files the snapshot deleted, said once so the AI knows they are gone. */
const removedNote = (removed: string[]) =>
  removed.length > 0
    ? {
        removedIgnoredFiles: removed,
        note: "These files were ignored by .gitignore, so they could never reach the site; they were deleted.",
      }
    : {};

function formatCheck({ commit: _, removed, ...rest }: CheckResult) {
  return { ...rest, ...removedNote(removed) };
}

const OUTCOME_TEXT: Record<BuildResult["outcome"], string> = {
  ok: "The build succeeded.",
  config_or_content_error: "The build failed: a configuration or content error (exit code 2).",
  render_error: "The build failed: a template rendering error (exit code 3).",
  stopped: "The build was stopped.",
  failed: "Bukit failed to run the build.",
};

function formatBuild(r: BuildResult) {
  return {
    succeeded: r.outcome === "ok",
    result: OUTCOME_TEXT[r.outcome],
    pages: r.pages,
    messages: r.messages,
    output: r.output,
    ...(r.audit ? { seoGeo: auditText(r.audit) } : {}),
    ...removedNote(r.removed),
  };
}

/** The schema, or one top-level property of it, cut to a size the model can take. */
export function schemaText(schema: unknown, section?: string): string {
  let value = schema;
  if (section) {
    const props = isRecord(schema) && isRecord(schema.properties) ? schema.properties : {};
    if (!Object.hasOwn(props, section)) {
      return `No section "${section}". Sections: ${Object.keys(props).join(", ") || "(none)"}`;
    }
    value = props[section];
  }
  const out = JSON.stringify(value, null, 1);
  if (out.length <= MAX_SCHEMA_CHARS) return out;
  const sections = isRecord(value) && isRecord(value.properties) ? Object.keys(value.properties).join(", ") : "";
  return `${out.slice(0, MAX_SCHEMA_CHARS)}\n…[cut at ${MAX_SCHEMA_CHARS} characters${sections ? `; ask for one section: ${sections}` : ""}]`;
}

interface ContentFile {
  file: string;
  title?: unknown;
  slug?: unknown;
  publishAt?: unknown;
  draft?: unknown;
  keys?: string[];
  error?: string;
}

/** Markdown files of the markdown sources (of one collection), with front matter summaries. */
export function listContent(
  config: Record<string, unknown>,
  collection: string | undefined,
  cwd: string,
  gate: PathGate,
) {
  const content = isRecord(config.content) ? config.content : {};
  const sources = Array.isArray(content.sources) ? content.sources : [];
  let budget = MAX_CONTENT_FILES;
  let truncated = false;
  const out: {
    index: number;
    name: unknown;
    collection: unknown;
    type: string;
    dir?: string;
    files?: ContentFile[];
    note?: string;
  }[] = [];
  for (const [index, source] of sources.entries()) {
    const s = isRecord(source) ? source : {};
    if (collection !== undefined && s.collection !== collection) continue;
    const markdown = isRecord(s.markdown) ? s.markdown : null;
    const type = typeof s.type === "string" ? s.type : markdown ? "markdown" : isRecord(s.notion) ? "notion" : "other";
    const base = { index, name: s.name ?? null, collection: s.collection ?? null, type };
    const dir = markdown && typeof markdown.dir === "string" ? markdown.dir : null;
    if (type !== "markdown" || dir === null) {
      out.push({
        ...base,
        note: type === "notion" ? "Notion content is not in the working copy" : "not a Markdown source",
      });
      continue;
    }
    if (pathProblem(dir) !== null) {
      out.push({ ...base, dir, note: "the directory is not a safe relative path" });
      continue;
    }
    const files: ContentFile[] = [];
    for (const rel of markdownFiles(cwd, dir, gate)) {
      if (budget === 0) {
        truncated = true;
        break;
      }
      budget--;
      files.push(describeFile(cwd, rel, gate));
    }
    out.push({ ...base, dir, files });
  }
  if (collection !== undefined && out.length === 0) {
    return { error: `No content source for collection "${collection}"` };
  }
  return { sources: out, truncated };
}

/** .md / .markdown files under `dir`, relative to the working copy, sorted; no symlinks, no .git. */
function markdownFiles(cwd: string, dir: string, gate: PathGate): string[] {
  const start = path.join(cwd, dir);
  let root: string;
  try {
    root = gate.check(start, "list");
  } catch (err) {
    if (err instanceof GateError) return [];
    throw err;
  }
  const found: string[] = [];
  const walk = (abs: string, rel: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (found.length > MAX_CONTENT_FILES || e.isSymbolicLink() || segmentKey(e.name) === ".git") continue;
      const childRel = path.posix.join(rel, e.name);
      if (e.isDirectory()) walk(path.join(abs, e.name), childRel);
      else if (e.isFile() && /\.(md|markdown)$/i.test(e.name)) found.push(childRel);
    }
  };
  walk(root, path.posix.normalize(dir).replace(/\/+$/, ""));
  return found;
}

function describeFile(cwd: string, rel: string, gate: PathGate): ContentFile {
  try {
    const real = gate.check(path.join(cwd, rel), "read");
    const st = fs.statSync(real);
    if (st.size > MAX_CONTENT_FILE_BYTES) return { file: rel, error: "file too large to read" };
    const fm = parseFrontMatter(fs.readFileSync(real, "utf8"));
    if (fm.error !== null || !isRecord(fm.value)) return { file: rel, error: fm.error ?? "invalid front matter" };
    const { title, slug, draft } = fm.value;
    return {
      file: rel,
      title,
      slug,
      publishAt: fm.value.publishAt ?? fm.value.date,
      draft,
      keys: Object.keys(fm.value),
    };
  } catch (err) {
    return { file: rel, error: err instanceof Error ? err.message : String(err) };
  }
}
