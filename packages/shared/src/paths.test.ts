import { describe, expect, it } from "vitest";
import { SettingsPatch } from "./settings.ts";
import { CreateSiteRequest, InspectImportRequest } from "./sites.ts";

describe("absolute paths", () => {
  it("accepts macOS, Linux and Windows absolute paths", () => {
    for (const p of ["/Users/me/site", "C:\\Users\\me\\site", "d:/sites/blog", "\\\\server\\share\\site"]) {
      expect(InspectImportRequest.safeParse({ path: p }).success, p).toBe(true);
    }
  });

  it("refuses relative paths, drive-relative paths and empty strings", () => {
    for (const p of ["site", "./site", "C:site", "\\site", "\\\\\\x", ""]) {
      expect(InspectImportRequest.safeParse({ path: p }).success, p).toBe(false);
    }
  });

  it("uses the same rule for a new site and for the Bukit path", () => {
    expect(CreateSiteRequest.safeParse({ name: "S", path: "C:\\Sites\\s", language: "en-US" }).success).toBe(true);
    expect(SettingsPatch.safeParse({ bukitPath: "C:\\tools\\bukit.exe" }).success).toBe(true);
    expect(SettingsPatch.safeParse({ bukitPath: "bukit.exe" }).success).toBe(false);
  });
});
