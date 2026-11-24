import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { skillReadRoots } from "../src/agent/skills.ts";

let base: string;

beforeAll(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bj-skill-roots-")));
});
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

describe("skill read roots", () => {
  it("keeps enabled skill directories and skips a symlink that points outside", () => {
    const skillsDir = path.join(base, "skills");
    const realDir = path.join(skillsDir, "real");
    const outside = path.join(base, "outside");
    fs.mkdirSync(realDir, { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(realDir, "SKILL.md"), "# real\n");
    fs.writeFileSync(path.join(outside, "SKILL.md"), "# outside\n");
    fs.symlinkSync(outside, path.join(skillsDir, "evil"), "dir");

    const skipped: string[] = [];
    const roots = skillReadRoots(
      [
        { name: "real", baseDir: realDir, filePath: path.join(realDir, "SKILL.md") },
        { name: "evil", baseDir: path.join(skillsDir, "evil"), filePath: path.join(skillsDir, "evil", "SKILL.md") },
      ],
      skillsDir,
      (name) => skipped.push(name),
    );

    expect(roots).toEqual([fs.realpathSync.native(realDir)]);
    expect(skipped).toEqual(["evil"]);
  });

  it("allows only the file for a root-level Markdown skill", () => {
    const skillsDir = path.join(base, "root-skills");
    fs.mkdirSync(skillsDir, { recursive: true });
    const file = path.join(skillsDir, "root.md");
    fs.writeFileSync(file, "# root\n");

    expect(skillReadRoots([{ name: "root", baseDir: skillsDir, filePath: file }], skillsDir)).toEqual([
      fs.realpathSync.native(file),
    ]);
  });
});

describe("references between BukitJalil's skills", () => {
  const skill = (name: string) =>
    fs.readFileSync(path.join(import.meta.dirname, "../../../skills/bukitjalil", name, "SKILL.md"), "utf8");

  it("points theme-design's interface text at the copy tells in content-writing", () => {
    expect(skill("content-writing")).toMatch(/^## Read like a person wrote it$/m);
    expect(skill("content-writing")).toContain("adapted from taste-skill's copy tells, MIT");
    expect(skill("theme-design").replace(/\s+/g, " ")).toContain(
      'follows "Read like a person wrote it" in `content-writing`',
    );
  });

  it("has theme-design suggest a design system and switch it with theme_design_system (plan 14 D9)", () => {
    const text = skill("theme-design").replace(/\s+/g, " ");
    expect(text).toContain("- design system, in a new theme made from a description only");
    expect(text).toContain("When the user agrees to the other design system, call `theme_design_system`");
    expect(text).toContain("say which one and why in `summarize_changes`");
  });
});
