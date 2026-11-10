import type { HighlighterCore, ThemedToken } from "shiki/core";

/**
 * Read-only code highlighting (plan 2.3, shiki). Loaded on first use as its own chunk, with only the
 * languages a Bukit site uses. The JavaScript regex engine is used because the admin CSP does not allow
 * WebAssembly; tokens are rendered as React elements because it does not allow inline style attributes.
 */
const LANGS = {
  yaml: () => import("shiki/langs/yaml.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  scss: () => import("shiki/langs/scss.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  typescript: () => import("shiki/langs/typescript.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  toml: () => import("shiki/langs/toml.mjs"),
  xml: () => import("shiki/langs/xml.mjs"),
} as const;
export type Lang = keyof typeof LANGS;

const EXTENSIONS: Record<string, Lang> = {
  yaml: "yaml",
  yml: "yaml",
  md: "markdown",
  markdown: "markdown",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  js: "javascript",
  mjs: "javascript",
  ts: "typescript",
  json: "json",
  toml: "toml",
  xml: "xml",
  svg: "xml",
};

/** The language for a file name, or null to show plain text. */
export function langFor(path: string): Lang | null {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return path.includes(".") ? (EXTENSIONS[ext] ?? null) : null;
}

let highlighter: Promise<HighlighterCore> | null = null;

function load(): Promise<HighlighterCore> {
  highlighter ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
      import("shiki/core"),
      import("shiki/engine/javascript"),
    ]);
    return createHighlighterCore({
      themes: [import("shiki/themes/github-light.mjs"), import("shiki/themes/github-dark.mjs")],
      langs: [],
      engine: createJavaScriptRegexEngine(),
    });
  })();
  return highlighter;
}

/** Larger files are shown as plain text: highlighting them would block the page. */
export const MAX_HIGHLIGHT_CHARS = 200_000;

export async function tokenize(code: string, lang: Lang, dark: boolean): Promise<ThemedToken[][]> {
  const h = await load();
  if (!h.getLoadedLanguages().includes(lang)) await h.loadLanguage(LANGS[lang]());
  return h.codeToTokensBase(code, { lang, theme: dark ? "github-dark" : "github-light" });
}
