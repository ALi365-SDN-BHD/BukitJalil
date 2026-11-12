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
