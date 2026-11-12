import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JsonFile, JsonFileError } from "../src/store/json-file.ts";

let base: string;

beforeAll(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bj-json-file-")));
});
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

describe("JsonFile", () => {
  it("separates a missing file from an unreadable one", () => {
    const file = path.join(base, "missing.json");
    const json = new JsonFile(file);
    expect(json.read()).toBeUndefined();

    fs.writeFileSync(file, "{");
    expect(() => json.read()).toThrow(JsonFileError);
    expect(() => json.read()).toThrow(/invalid JSON/);
  });

  it("refuses a value that would be too large to read back", () => {
    const file = path.join(base, "small.json");
    const json = new JsonFile(file, { maxBytes: 64 });
    json.write({ ok: true });
    const before = fs.readFileSync(file, "utf8");

    let error: unknown;
    try {
      json.write({ text: "x".repeat(100) });
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(JsonFileError);
    expect(error).toMatchObject({ code: "storage.too_large" });
    expect(fs.readFileSync(file, "utf8")).toBe(before);
  });

  it("cleans only its own temporary files", () => {
    const dir = path.join(base, "cleanup");
    fs.mkdirSync(dir);
    const file = path.join(dir, "data.json");
    const json = new JsonFile(file);
    json.write({ ok: true });
    const stale = path.join(dir, ".data.json-abcdef123456.tmp");
    const unrelated = path.join(dir, "other.tmp");
    fs.writeFileSync(stale, "stale");
    fs.writeFileSync(unrelated, "other");

    expect(json.cleanupTempFiles()).toBe(1);
    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(unrelated)).toBe(true);
    expect(json.read()).toEqual({ ok: true });
  });
});
