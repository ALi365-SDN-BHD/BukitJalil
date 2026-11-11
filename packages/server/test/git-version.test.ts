import { describe, expect, it } from "vitest";
import { checkGit, parseGitVersion, versionAtLeast } from "../src/git/version.ts";

describe("git version check", () => {
  it("parses common version strings", () => {
    expect(parseGitVersion("git version 2.39.5 (Apple Git-154)\n")).toBe("2.39.5");
    expect(parseGitVersion("git version 2.45.2.windows.1")).toBe("2.45.2");
    expect(parseGitVersion("nonsense")).toBeNull();
  });

  it("compares versions numerically", () => {
    expect(versionAtLeast("2.38.0", "2.38.0")).toBe(true);
    expect(versionAtLeast("2.39.5", "2.38.0")).toBe(true);
    expect(versionAtLeast("2.100.0", "2.38.0")).toBe(true);
    expect(versionAtLeast("2.37.9", "2.38.0")).toBe(false);
    expect(versionAtLeast("1.99", "2.38.0")).toBe(false);
  });

  it("reports a missing git", async () => {
    expect(await checkGit("/nonexistent/git")).toEqual({ ok: false, version: null, problem: "missing" });
  });

  it("finds the local git", async () => {
    const res = await checkGit();
    expect(res.version).not.toBeNull();
  });
});
