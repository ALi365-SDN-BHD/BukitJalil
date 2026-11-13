import { parseDocument } from "yaml";
import { isRecord } from "../bukit/guard.ts";

const MAX_ALIASES = 100;

export type YamlResult = { value: unknown; error: null } | { value: null; error: string };

/**
 * Parse YAML for display (config, theme and front matter panels). Duplicate keys and alias bombs are
 * errors; nothing here decides safety, which is the guard's job (plan 8.5). `asText` keeps every scalar
 * as a string, the way Bukit (YamlDotNet) reads site.yaml: an unquoted all-digit databaseId stays as written.
 */
export function parseYaml(text: string, opts: { asText?: boolean } = {}): YamlResult {
  try {
    const doc = parseDocument(text, {
      uniqueKeys: true,
      prettyErrors: false,
      ...(opts.asText ? { schema: "failsafe" as const } : {}),
    });
    if (doc.errors.length > 0) return { value: null, error: doc.errors[0]?.message ?? "invalid YAML" };
    return { value: doc.toJS({ maxAliasCount: MAX_ALIASES }), error: null };
  } catch (err) {
    return { value: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Front matter of a Markdown file: the YAML between a leading "---" line and the next "---" (or "...")
 * line. A file without front matter has an empty mapping.
 */
export function parseFrontMatter(text: string): YamlResult {
  const body = text.startsWith("﻿") ? text.slice(1) : text;
  const first = /^---[ \t]*\r?\n/.exec(body);
  if (!first) return { value: {}, error: null };
  const rest = body.slice(first[0].length);
  const end = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m.exec(rest);
  if (!end) return { value: null, error: "front matter is not closed" };
  const parsed = parseYaml(rest.slice(0, end.index));
  if (parsed.error !== null) return parsed;
  if (parsed.value === null || parsed.value === undefined) return { value: {}, error: null };
  return isRecord(parsed.value) ? parsed : { value: null, error: "front matter is not a mapping" };
}
