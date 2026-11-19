import { describe, expect, it } from "vitest";
import { fileUrl, keys } from "@/lib/api";
import { projectPath } from "@/lib/project";

// Theme development design 3.3 (T0 layer 3): the views address a site or a theme project by its key.
const site = "0123456789abcdef";
const theme = "themes/fedcba9876543210";

describe("project addressing", () => {
  it("puts a site under /sites and a theme project under /themes", () => {
    expect(projectPath(site)).toBe(`/sites/${site}`);
    expect(projectPath(theme)).toBe("/themes/fedcba9876543210");
    expect(fileUrl(theme, "change", "a b.png", "raw")).toBe(
      "/api/themes/fedcba9876543210/file?ref=change&path=a+b.png&as=raw",
    );
    expect(fileUrl(site, "main", "x.md", "download")).toBe(`/api/sites/${site}/file?ref=main&path=x.md&as=download`);
  });

  it("keeps a site's record and list keys and gives a theme project its own", () => {
    expect(keys.project(site)).toEqual(keys.site(site));
    expect(keys.projects(site)).toEqual(keys.sites);
    expect(keys.project(theme)).toEqual(["theme", "fedcba9876543210"]);
    expect(keys.projects(theme)).toEqual(["themes"]);
  });
});
