import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pruneCaptures } from "./capture-store.ts";

describe("leftover captures (design 6.2)", () => {
  it("removes capture folders older than the limit and nothing else", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bj-captures-"));
    const old = path.join(dir, "a".repeat(32));
    const fresh = path.join(dir, "b".repeat(32));
    const other = path.join(dir, "notes");
    for (const d of [old, fresh, other]) fs.mkdirSync(d);
    fs.writeFileSync(path.join(old, "manifest.json"), "{}");
    const hourAgo = (Date.now() - 60 * 60 * 1000) / 1000;
    const twoDaysAgo = (Date.now() - 48 * 60 * 60 * 1000) / 1000;
    fs.utimesSync(old, twoDaysAgo, twoDaysAgo);
    fs.utimesSync(fresh, hourAgo, hourAgo);
    fs.utimesSync(other, twoDaysAgo, twoDaysAgo);

    pruneCaptures(dir);
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
    expect(fs.existsSync(other)).toBe(true);
    pruneCaptures(path.join(dir, "missing"));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
