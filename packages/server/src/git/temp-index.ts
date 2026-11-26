import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { GitRunner } from "./run.ts";

/** Apply NUL-terminated index-info entries to a committed tree without touching a checkout. */
export async function editedTree(git: GitRunner, cwd: string, base: string, entries: string, tmpDir: string) {
  fs.mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
  const indexFile = path.join(tmpDir, `edit-${crypto.randomBytes(8).toString("hex")}.index`);
  try {
    await git.run(["read-tree", "--end-of-options", base], { cwd, indexFile });
    await git.run(["update-index", "-z", "--index-info"], { cwd, indexFile, input: entries });
    return (await git.text(["write-tree"], { cwd, indexFile })).trim();
  } finally {
    fs.rmSync(indexFile, { force: true });
    fs.rmSync(`${indexFile}.lock`, { force: true });
  }
}
