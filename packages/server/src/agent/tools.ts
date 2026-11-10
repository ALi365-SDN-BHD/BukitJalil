import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { BUILD_DIRS } from "../sites/exclude.ts";
import { GateError, type PathGate, segmentKey, writeChecked } from "./gate.ts";
import type { PiModules } from "./pi.ts";

/** Pi's built-in tools the AI may use (plan 6.3), each replaced by a gated definition. No bash. */
export const BUILTIN_TOOLS = ["read", "grep", "find", "ls", "edit", "write"] as const;

/** Directories `find` never walks into: anywhere, and at the top of the working copy. */
const SKIP_ANYWHERE = new Set([".git", "node_modules"]);
const SKIP_TOP = new Set<string>(BUILD_DIRS);
/** Entries `find` looks at before it stops, so a huge tree cannot stall a run. */
export const MAX_WALK = 20_000;
/** rg glob that leaves out every file or directory named .git, in any case. */
const NO_GIT_GLOB = "!.[gG][iI][tT]";

/** Set by a find call whose walk stopped at MAX_WALK, so its result can say so. */
const findRun = new AsyncLocalStorage<{ stopped: boolean }>();

/** Characters Pi turns into plain spaces before it resolves a path. */
const UNICODE_SPACES = /[   -​  　﻿]/;

export interface ToolOptions {
  /** The working copy; the session's cwd. */
  cwd: string;
  gate: PathGate;
  /** BukitJalil's pinned rg is installed and verified (plan 6.3); grep is refused otherwise. */
  rgReady: () => boolean;
  /** Entries find looks at before it stops; MAX_WALK by default. */
  maxWalk?: number;
}

/**
 * First, quick refusal (plan 6.3): paths Pi would rewrite to somewhere else. The gate in the operations
 * is what enforces the rules; this only tells the model early to use a plain relative path.
 */
export function checkToolPath(value: unknown): void {
  if (value === undefined) return;
  if (typeof value !== "string") throw new GateError("The path must be a string");
  const lower = value.trimStart().toLowerCase();
  if (lower.startsWith("@") || lower.startsWith("~") || lower.startsWith("file:") || UNICODE_SPACES.test(value)) {
    throw new GateError(`Path not allowed: ${value}. Use a path relative to the working directory.`);
  }
}

const GREP_LINE = /^(.+?)(?::\d+: |-\d+- )/;

/** Grep output without lines from .git files and directories (rg searches them because Pi passes --hidden). */
export function dropGitLines(text: string): string {
  const lines = text.split("\n");
  const kept = lines.filter((line) => {
    const file = GREP_LINE.exec(line)?.[1];
    return !file?.split(/[/\\]/).some((part) => part.toLowerCase() === ".git");
  });
  if (kept.length === lines.length) return text;
  return kept.some((line) => GREP_LINE.test(line)) ? kept.join("\n") : "No matches found";
}

/**
 * Files under `base` whose path matches `pattern` the way fd --glob does: basename, or path with a "/".
 * Paths are returned under `shownBase` (the search path as Pi resolved it), so Pi can make them relative.
 */
async function globFiles(
  base: string,
  shownBase: string,
  pattern: string,
  limit: number,
  maxWalk: number,
): Promise<string[]> {
  const glob = pattern.replace(/^(?:\.\/)+/, "");
  const byPath = glob.includes("/");
  const out: string[] = [];
  let seen = 0;
  const walk = async (dir: string, rel: string): Promise<void> => {
    const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (out.length >= limit) return;
      if (++seen > maxWalk) {
        const run = findRun.getStore();
        if (run) run.stopped = true;
        return;
      }
      const key = segmentKey(entry.name);
      if (entry.isSymbolicLink() || SKIP_ANYWHERE.has(key) || (rel === "" && SKIP_TOP.has(key))) continue;
      const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), childRel);
      else if (entry.isFile() && path.posix.matchesGlob(byPath ? childRel : entry.name, glob)) {
        out.push(path.join(shownBase, ...childRel.split("/")));
      }
    }
  };
  await walk(base, "");
  return out;
}

interface PathTool {
  execute(id: string, params: { path?: unknown }, ...rest: never[]): unknown;
}

/** Run checkToolPath on the tool's `path` parameter before the tool itself. */
function checkPathFirst<T extends PathTool>(tool: T): void {
  const execute = tool.execute.bind(tool);
  tool.execute = ((id: string, params: { path?: unknown }, ...rest: never[]) => {
    checkToolPath(params.path);
    return execute(id, params, ...rest);
  }) as T["execute"];
}

/**
 * The six built-in tools with BukitJalil's operations (plan 6.3). Pi hands the operations the final
 * absolute path and, for edit and write, the final content, and the gate checks both there. Each tool's
 * execute first refuses paths Pi would rewrite; grep also needs the installed rg and drops .git lines.
 */
export function createGatedTools({ pi }: PiModules, opts: ToolOptions): ToolDefinition[] {
  const { cwd, gate } = opts;
  const maxWalk = opts.maxWalk ?? MAX_WALK;
  const listable = (p: string) => gate.check(p, "list");

  const read = pi.createReadToolDefinition(cwd, {
    operations: {
      readFile: (p) => fsp.readFile(gate.check(p, "read")),
      access: (p) => fsp.access(gate.check(p, "read"), fs.constants.R_OK),
    },
  });
  const write = pi.createWriteToolDefinition(cwd, {
    operations: {
      writeFile: async (p, content) => {
        const real = gate.check(p, "write");
        gate.checkContent(content);
        await writeChecked(real, content);
      },
      mkdir: async (dir) => {
        await fsp.mkdir(gate.check(dir, "write"), { recursive: true });
      },
    },
  });
  const edit = pi.createEditToolDefinition(cwd, {
    operations: {
      readFile: (p) => fsp.readFile(gate.check(p, "write")),
      writeFile: async (p, content) => {
        const real = gate.check(p, "write");
        gate.checkContent(content);
        await writeChecked(real, content);
      },
      access: (p) => fsp.access(gate.check(p, "write"), fs.constants.R_OK | fs.constants.W_OK),
    },
  });
  const ls = pi.createLsToolDefinition(cwd, {
    operations: {
      exists: (p) => fs.existsSync(listable(p)),
      stat: (p) => fs.statSync(listable(p)),
      readdir: (p) => fs.readdirSync(listable(p)).filter((name) => segmentKey(name) !== ".git"),
    },
  });
  const find = pi.createFindToolDefinition(cwd, {
    operations: {
      exists: (p) => fs.existsSync(listable(p)),
      glob: (pattern, dir, { limit }) => globFiles(listable(dir), dir, pattern, limit, maxWalk),
    },
  });
  const grep = pi.createGrepToolDefinition(cwd, {
    operations: { isDirectory: (p) => fs.statSync(listable(p)).isDirectory() },
  });

  for (const tool of [read, write, edit, ls, find]) checkPathFirst(tool);
  const findExecute = find.execute.bind(find);
  find.execute = async (...args) => {
    const run = { stopped: false };
    const result = await findRun.run(run, () => findExecute(...args));
    if (!run.stopped) return result;
    const note = `\n\n[Search stopped after ${maxWalk} entries; some files may be missing. Search a smaller path.]`;
    return { ...result, content: result.content.map((c) => (c.type === "text" ? { ...c, text: c.text + note } : c)) };
  };
  const grepExecute = grep.execute.bind(grep);
  grep.execute = async (id, params, ...rest) => {
    checkToolPath(params.path);
    if (!opts.rgReady()) {
      throw new GateError("The search tool (rg) is not installed or failed its check; use find and read");
    }
    // Leave .git out of the search itself, so its lines do not use up the match limit; lines are still
    // filtered below for searches that bring their own glob.
    const result = await grepExecute(id, { ...params, glob: params.glob ?? NO_GIT_GLOB }, ...rest);
    return {
      ...result,
      content: result.content.map((c) => (c.type === "text" ? { ...c, text: dropGitLines(c.text) } : c)),
    };
  };
  return [read, write, edit, ls, find, grep] as ToolDefinition[];
}
