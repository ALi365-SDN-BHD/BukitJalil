import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import type { GrepToolInput } from "@earendil-works/pi-coding-agent";
import { systemEnv } from "../child-env.ts";
import { GateError, type PathGate } from "./gate.ts";
import type { PiModules } from "./pi.ts";

const run = promisify(execFile);

/** Only enumerate names recursively. Content searches receive checked regular files, never a directory. */
export async function gatedGrep(
  pi: PiModules["pi"],
  gate: PathGate,
  cwd: string,
  req: GrepToolInput,
  signal?: AbortSignal,
) {
  const rg = path.join(pi.getAgentDir(), "bin", process.platform === "win32" ? "rg.exe" : "rg");
  const root = gate.check(path.resolve(cwd, req.path || "."), "list");
  const dir = fs.statSync(root).isDirectory();
  const base = dir ? root : path.dirname(root);
  const options = { cwd: base, env: systemEnv(), signal, windowsHide: true };
  let names: string[];
  if (dir) {
    const glob = req.glob ? ["--glob", req.glob.replace(/^(!?)(?:\.\/)+/, "$1")] : [];
    try {
      const { stdout } = await run(rg, ["--no-config", "--files", "--hidden", "--null", ...glob, "--", "."], {
        ...options,
        maxBuffer: 8 * 1024 * 1024,
      });
      names = stdout.split("\0").filter(Boolean);
    } catch (err) {
      signal?.throwIfAborted();
      if ((err as { code?: unknown }).code === 1) names = [];
      else throw new GateError("Cannot list files for grep; check the glob or search a smaller directory");
    }
  } else names = [path.basename(root)];

  const context = Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(req.context ?? 0)));
  const args = [
    "--no-config",
    "--json",
    "--max-depth=0",
    ...(req.literal ? ["--fixed-strings"] : []),
    ...(req.ignoreCase ? ["--ignore-case"] : []),
    ...(context ? ["--context", String(context)] : []),
    "--",
    req.pattern,
  ];
  const lines: string[] = [];
  let matches = 0;
  let bytes = 0;
  let truncatedLines = false;
  let notice = "";
  const limit = Math.max(1, Math.floor(req.limit ?? 100));
  // Bound command length on Windows too. Prefix every path: a file literally named "-" is not stdin.
  let batch: string[] = [];
  let size = 0;
  async function search() {
    const child = spawn(rg, [...args, ...batch], { ...options, stdio: ["ignore", "pipe", "ignore"] });
    const ended = new Promise<number | null>((resolve) => {
      child.once("error", () => resolve(null));
      child.once("close", resolve);
    });
    const events = createInterface({ input: child.stdout, crlfDelay: Infinity });
    let exhausted = false;
    let lastFile: string | undefined;
    let trailingEnd = 0;
    try {
      for await (const row of events) {
        const event = JSON.parse(row);
        if (event.type !== "match" && event.type !== "context") continue;
        const file = event.data.path?.text;
        if (typeof file !== "string" || !gate.listable(path.resolve(base, file))) continue;
        let match = event.type === "match";
        const number: number = event.data.line_number;
        if (matches >= limit) {
          if (match) notice = `${limit} matches limit reached`;
          if (file !== lastFile || number > trailingEnd) {
            if (notice) break;
            continue;
          }
          match = false;
        } else if (match && ++matches === limit) {
          lastFile = file;
          trailingEnd = number + context;
        }
        const data = event.data.lines;
        const raw: string = data.text ?? Buffer.from(data.bytes, "base64").toString("utf8");
        const { text, wasTruncated } = pi.truncateLine(raw.replace(/\r?\n$/, ""));
        truncatedLines ||= wasTruncated;
        const separator = match ? ":" : "-";
        const line = `${path.relative(base, path.resolve(base, file)).split(path.sep).join("/")}${separator}${number}${separator} ${text}`;
        bytes += Buffer.byteLength(line) + 1;
        if (bytes > pi.DEFAULT_MAX_BYTES) {
          notice = "Output byte limit reached";
          break;
        }
        lines.push(line);
      }
      exhausted = !notice;
    } finally {
      events.close();
      if (!exhausted) child.kill();
    }
    const code = await ended;
    signal?.throwIfAborted();
    if (!notice && code !== 0 && code !== 1) throw new GateError("Search failed; check the pattern and search path");
    batch = [];
    size = 0;
  }
  for (const name of names) {
    signal?.throwIfAborted();
    const file = path.resolve(base, name);
    if (!gate.listable(file) || !fs.lstatSync(file, { throwIfNoEntry: false })?.isFile()) continue;
    const arg = `.${path.sep}${path.relative(base, file)}`;
    if (batch.length && size + arg.length > 12_000) {
      await search();
      if (notice) break;
    }
    batch.push(arg);
    size += arg.length + 3;
  }
  if (batch.length && !notice) await search();
  if (notice || truncatedLines)
    lines.push(`\n[${[notice, truncatedLines ? "Long lines truncated" : ""].filter(Boolean).join(". ")}]`);
  return { content: [{ type: "text" as const, text: lines.join("\n") || "No matches found" }], details: undefined };
}
