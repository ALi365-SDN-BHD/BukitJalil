import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createLogger } from "../src/log.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bj-log-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("app log", () => {
  it("rotates to one old file when it grows", () => {
    const logger = createLogger(dir);
    // debug does not go to stderr; it still goes to the file.
    logger.log("debug", "first", { text: "x".repeat(6 * 1024 * 1024) });
    logger.log("debug", "second", {});
    expect(fs.existsSync(path.join(dir, "server.log.1"))).toBe(true);
    expect(fs.statSync(path.join(dir, "server.log")).size).toBeLessThan(1024 * 1024);
    expect(fs.readFileSync(path.join(dir, "server.log"), "utf8")).toContain("second");
  });
});
