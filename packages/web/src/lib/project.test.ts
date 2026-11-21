import { describe, expect, it } from "vitest";
import { fileUrl, keys } from "@/lib/api";
import { contentDatabasePath, modeOf, projectPath } from "@/lib/project";

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

// Plan 5.6 (content management C0): /content is the third mode.
describe("modes", () => {
  it("tells the mode from the path, by whole segments", () => {
    expect(modeOf("/")).toBe("site");
    expect(modeOf("/sites/abc")).toBe("site");
    expect(modeOf("/themes")).toBe("theme");
    expect(modeOf("/themes/abc/sessions/x")).toBe("theme");
    expect(modeOf("/content")).toBe("content");
    expect(modeOf("/content/sources/ds_1/databases/db_1")).toBe("content");
    expect(modeOf("/contents")).toBe("site");
    expect(modeOf("/themesx")).toBe("site");
  });

  it("addresses a database by its source, escaping both ids", () => {
    expect(contentDatabasePath("ds_1", "db 1/2")).toBe("/content/sources/ds_1/databases/db%201%2F2");
  });
});
