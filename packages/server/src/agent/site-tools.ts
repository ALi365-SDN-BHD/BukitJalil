import fs from "node:fs";
import path from "node:path";
import { DesignSystem, type ProjectKey } from "@bukitjalil/shared";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { auditText } from "../builds/audit.ts";
import { isRecord, pathProblem } from "../bukit/guard.ts";
import { mediaDir, mediaUrl } from "../media/dir.ts";
import { sniffMedia } from "../media/sniff.ts";
import { summarizeConfig } from "../panels/service.ts";
import { parseFrontMatter, parseYaml } from "../panels/yaml.ts";
import { SiteError } from "../sites/location.ts";
import { MAX_COVERAGE_FILE_BYTES, type ThemeFiles, themeCoverage } from "../themes/coverage.ts";
import { designSystemFiles, unchangedDesignSystem } from "../themes/demo.ts";
import { lintThemeFiles } from "../themes/lint.ts";
import { pickPalettes, type Scheme, TRADES, type Trade } from "../themes/palettes.ts";
import type { RenderChecker } from "../themes/render-check.ts";
import { type AiBukit, type BuildResult, type CheckResult, type NotionNote, notionNoteText } from "./ai-bukit.ts";
import { GateError, type PathGate, segmentKey, writeChecked } from "./gate.ts";

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

/** Tools only theme projects get (theme development design 4.1). */
export const THEME_TOOLS = ["theme_coverage", "theme_lint", "theme_palettes", "theme_design_system"] as const;
/** The render check: theme projects in the desktop app only, which can render pages (taste skill D3). */
export const RENDER_TOOL = "theme_render_check";

const MAX_CONFIG_BYTES = 256 * 1024;
const MARKDOWN_FILE = /\.(md|markdown)$/i;
const MAX_CONTENT_FILES = 500;
const MAX_CONTENT_FILE_BYTES = 256 * 1024;
const MAX_SCHEMA_CHARS = 60_000;
export const MAX_SUMMARY_CHARS = 2000;

export interface SiteToolOptions {
  project: ProjectKey;
  /** The site config's file name in the working copy (found by content when the site was imported). */
  configFile: string;
  /** A theme project's theme (adds the THEME_TOOLS); null for a site. */
  themeName: string | null;
  /** BukitJalil's theme sample directory, which holds the design systems theme_design_system switches to. */
  themeDemo: string;
  /** The working copy (the session's cwd). */
  cwd: string;
  gate: PathGate;
  bukit: AiBukit;
  /** Renders and checks preview pages: set in the desktop app, null elsewhere (no theme_render_check). */
  renderCheck?: RenderChecker | null;
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
  const { cwd, gate, configFile } = opts;

  /** The site config from the working copy, through the gate; parse errors are returned, not thrown. */
  const readConfig = (): { config: Record<string, unknown> | null; error: string | null } => {
    const real = gate.check(path.join(cwd, configFile), "read");
    const st = fs.statSync(real, { throwIfNoEntry: false });
    if (!st?.isFile()) return { config: null, error: `${configFile} does not exist` };
    if (st.size > MAX_CONFIG_BYTES) return { config: null, error: `${configFile} is too large` };
    const parsed = parseYaml(fs.readFileSync(real, "utf8"));
    if (parsed.error !== null) return { config: null, error: parsed.error };
    return isRecord(parsed.value) ? { config: parsed.value, error: null } : { config: null, error: "not a mapping" };
  };

  const tools: ToolDefinition[] = [
    {
      name: "site_info",
      label: "Site info",
      description:
        "Summary of site.yaml in the working copy: site title, URL, languages, collections, content sources, theme, plugins, and the uploaded media files.",
      parameters: object({}),
      async execute() {
        const { config, error } = readConfig();
        if (!config) return json({ error, media: { error } });
        return json({ ...summarizeConfig(config), media: mediaInfo(config, cwd) });
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
        return json(formatCheck(await opts.bukit.check(opts.project, cwd, signal)));
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
        return json(formatBuild(await opts.bukit.build(opts.project, cwd, signal)));
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
  const { themeName } = opts;
  if (themeName !== null) {
    tools.push({
      name: "theme_coverage",
      label: "Theme coverage",
      description:
        "What the theme covers: the templates theme.yaml declares and whether their files exist, the page types with no template, includes that point at missing files, and whether tokens.yaml, a search page and static/404.html exist.",
      parameters: object({}),
      async execute() {
        const { config, error } = readConfig();
        if (!config) return json({ error });
        return json(await themeCoverage(config, themeName, workingCopyFiles(cwd, gate)));
      },
    });
    tools.push({
      name: "theme_lint",
      label: "Theme lint",
      description:
        "The design self-check items a program can test in the theme (see the theme-design skill): token contract keys, contrast of the token colors in the light and dark schemes, literal colors in the CSS, resources from other sites, :focus-visible, reduced motion, transition: all, and gradient text, frosted glass, emoji, violet theme colors, content revealed on scroll and tilt. File paths are relative to themes/<name>/. The rest of the self-check is still yours.",
      parameters: object({}),
      async execute() {
        const issues = await lintThemeFiles(`themes/${themeName}`, workingCopyFiles(cwd, gate));
        return json({ issues, ...(issues.length === 0 ? { note: "No issues found by the lint." } : {}) });
      },
    });
    tools.push({
      name: "theme_palettes",
      label: "Theme palettes",
      description:
        "Three color palettes to offer in the design direction when the user has given no colors, reference images or site to clone (see the theme-design skill). Each is filled in to the token contract's colors with every contrast pair of the self-check met; a light palette also has a darkScheme. Pass exclude to get others.",
      parameters: object({
        trade: { type: "string", enum: [...TRADES], description: "The kind of business the site is for, if one fits" },
        scheme: { type: "string", enum: ["light", "dark"], description: "Only light or only dark grounds" },
        exclude: { type: "array", items: { type: "string" }, maxItems: 64, description: "Palette ids already offered" },
      }),
      async execute(_id, params: { trade?: Trade; scheme?: Scheme; exclude?: string[] }) {
        const palettes = pickPalettes({ ...params, count: 3 });
        return json({ palettes, howToUse: PALETTE_USE });
      },
    });
    tools.push(designSystemTool(themeName, opts.themeDemo, cwd, gate));
    const { renderCheck } = opts;
    if (renderCheck) {
      tools.push({
        name: RENDER_TOOL,
        label: "Theme render check",
        description:
          "Build the working copy and render pages of the preview at 320, 390, 768 and 1280px wide, then report what only shows when rendered: the page scrolling sideways, tap targets under 44px close to others, headings (one h1, no skipped level), links and buttons with no visible focus ring, and blocks lying on one another. Checks the home page, a post, a list page and the style guide unless you name pages (paths in the build, such as blog/a-post/). Headings in the page body come from the content's Markdown (they carry an id, such as h3#monday) and the style guide shows every level on purpose; fix only the headings your templates write. It takes a while; run it when a round of changes is done.",
        parameters: object({
          pages: {
            type: "array",
            items: { type: "string", maxLength: 300 },
            maxItems: 6,
            description: "Pages to check instead, as paths in the build",
          },
        }),
        // It builds the working copy, as bukit_build does: never alongside an edit or write.
        executionMode: "sequential",
        async execute(_id, params: { pages?: string[] }, signal) {
          const { result, used } = await opts.bukit.buildThen(opts.project, cwd, signal, (root, basePath) =>
            renderCheck({ project: opts.project, root, basePath, pages: params.pages, signal }),
          );
          if (!used) return json({ checked: false, build: formatBuild(result) });
          if (!used.ok) return json({ checked: false, error: used.error });
          const { pages, issues, notes } = used;
          return json({
            checked: true,
            pages,
            issues,
            ...(notes.length > 0 ? { notes } : {}),
            ...(issues.length === 0
              ? { note: "The render check found nothing. It does not replace the self-check." }
              : {}),
          });
        },
      });
    }
  }
  return tools;
}

/**
 * theme_design_system (plan 14 D9): put the other design system's tokens.yaml and style.css in the theme,
 * only while both files are still one system's bundled originals (Q31), so a switch never loses the
 * user's changes. The write lands in the change set like any other.
 */
function designSystemTool(themeName: string, themeDemo: string, cwd: string, gate: PathGate): ToolDefinition {
  const tokensPath = `themes/${themeName}/tokens.yaml`;
  const stylePath = `themes/${themeName}/assets/style.css`;
  return {
    name: "theme_design_system",
    label: "Theme design system",
    description:
      "Switch the theme to the other design system (see the theme-design skill): writes its tokens.yaml and assets/style.css in place of the theme's. Only while both files are still the bundled originals of a design system; once the look has been changed it refuses, since switching would lose those changes. Call it only after the user has agreed to the switch, or when they asked you to finish without asking.",
    parameters: object(
      {
        system: {
          type: "string",
          enum: [...DesignSystem.options],
          description: "default (the neutral one) or material",
        },
      },
      ["system"],
    ),
    // It writes the working copy: never alongside an edit, write or build.
    executionMode: "sequential",
    async execute(_id, params: { system: DesignSystem }) {
      const target = DesignSystem.safeParse(params.system);
      if (!target.success) return json({ switched: false, error: "system must be default or material" });
      const read = await workingCopyFiles(cwd, gate).read([tokensPath, stylePath]);
      const current = unchangedDesignSystem(themeDemo, { tokens: read.get(tokensPath), style: read.get(stylePath) });
      if (current === null) {
        return json({
          switched: false,
          error: `${tokensPath} or ${stylePath} has been changed (or is missing), so switching would lose those changes. Tell the user, and keep the current look unless they want to start over.`,
        });
      }
      if (current === target.data) return json({ switched: false, note: `The theme already uses ${current}.` });
      const files = designSystemFiles(themeDemo, target.data);
      // Both paths pass the gate before either is written, so a refusal never leaves half a switch.
      const tokensReal = gate.check(path.join(cwd, tokensPath), "write");
      const styleReal = gate.check(path.join(cwd, stylePath), "write");
      await writeChecked(tokensReal, files.tokens);
      await writeChecked(styleReal, files.style);
      return json({ switched: true, from: current, to: target.data, files: [tokensPath, stylePath] });
    },
  };
}

const PALETTE_USE = [
  "Offer the palettes in the design direction by name, each with one line from its note, and let the user choose.",
  "Write the chosen palette's colors into tokens.yaml `colors`. For a light palette, set the `--color-*` variables of the",
  "`@media (prefers-color-scheme: dark)` block in the CSS to its darkScheme. A dark palette has one scheme: remove that",
  "block, set `color-scheme: dark` on :root, and use the dark colors of the content palettes (Notion) outside their media",
  "query. The code block keeps a dark background in both schemes. Then run theme_lint.",
].join(" ");

/** The AI's working copy as theme_coverage reads it: through the gate, without symlinks (design 4.1). */
export function workingCopyFiles(cwd: string, gate: PathGate): ThemeFiles {
  return {
    list: async (dir) => filesUnder(cwd, dir, gate, /./),
    read: async (paths) => {
      const out = new Map<string, string>();
      for (const rel of paths) {
        try {
          const real = gate.check(path.join(cwd, rel), "read");
          const st = fs.statSync(real, { throwIfNoEntry: false });
          if (st?.isFile() && st.size <= MAX_COVERAGE_FILE_BYTES) out.set(rel, fs.readFileSync(real, "utf8"));
        } catch (err) {
          if (!(err instanceof GateError)) throw err;
        }
      }
      return out;
    },
  };
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

/** Where Notion content came from in an offline check or build (plan 5.5). */
const notionNote = (notion: NotionNote | undefined) => (notion ? { notionData: notionNoteText(notion) } : {});

function formatCheck({ commit: _, removed, notion, ...rest }: CheckResult) {
  return { ...rest, ...notionNote(notion), ...removedNote(removed) };
}

const OUTCOME_TEXT: Record<BuildResult["outcome"], string> = {
  ok: "The build succeeded.",
  config_or_content_error: "The build failed: a configuration or content error (exit code 2).",
  render_error: "The build failed: a template rendering error (exit code 3).",
  stopped: "The build was stopped.",
  failed: "Bukit failed to run the build.",
  base_url: "The build did not run: site.baseUrl is not a path the preview can be served under.",
};

function formatBuild(r: BuildResult) {
  return {
    succeeded: r.outcome === "ok",
    result: OUTCOME_TEXT[r.outcome],
    pages: r.pages,
    messages: r.messages,
    output: r.output,
    ...(r.audit ? { seoGeo: auditText(r.audit) } : {}),
    ...notionNote(r.notion),
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

/** Uploaded files in the theme's static/uploads directory, for the model to reference (design 4.6). */
function mediaInfo(config: Record<string, unknown>, cwd: string) {
  const baseUrl = isRecord(config.site) ? config.site.baseUrl : undefined;
  let dir: string;
  try {
    dir = mediaDir(cwd, config);
  } catch (err) {
    return { error: err instanceof SiteError ? err.code : String(err) };
  }
  const files: { name: string; size: number; mime: string; url: string; viewable: boolean }[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { dir: path.relative(cwd, dir).split(path.sep).join("/"), files };
    }
    return { error: String(err) };
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    if (files.length >= 200) break;
    if (entry.name.startsWith(".") || !entry.isFile() || entry.isSymbolicLink()) continue;
    const abs = path.join(dir, entry.name);
    const stat = fs.lstatSync(abs, { throwIfNoEntry: false });
    if (!stat?.isFile()) continue;
    const head = readHead(abs, 16);
    const mime = head ? sniffMedia(head) : null;
    files.push({
      name: entry.name,
      size: stat.size,
      mime: mime ?? "application/octet-stream",
      url: mediaUrl(baseUrl, entry.name),
      viewable: mime === "image/png" || mime === "image/jpeg" || mime === "image/gif" || mime === "image/webp",
    });
  }
  return { dir: path.relative(cwd, dir).split(path.sep).join("/"), files };
}

function readHead(file: string, bytes: number): Buffer | null {
  try {
    const fd = fs.openSync(file, "r");
    try {
      const buffer = Buffer.alloc(bytes);
      const read = fs.readSync(fd, buffer, 0, bytes, 0);
      return buffer.subarray(0, read);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
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
    for (const rel of filesUnder(cwd, dir, gate, MARKDOWN_FILE)) {
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

/** Files under `dir` whose names match `pattern`, relative to the working copy, sorted; no symlinks, no .git. */
function filesUnder(cwd: string, dir: string, gate: PathGate, pattern: RegExp): string[] {
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
      else if (e.isFile() && pattern.test(e.name)) found.push(childRel);
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
