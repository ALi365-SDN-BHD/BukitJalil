import fs from "node:fs";
import path from "node:path";
import {
  isRequiredSkill,
  type SkillDiagnostic,
  type SkillInfo,
  type SkillSource,
  type SkillsResponse,
} from "@bukitjalil/shared";
import type { PiModules } from "./pi.ts";

const SOURCE_ORDER: Record<SkillSource, number> = { bukitjalil: 0, bukit: 1, other: 2 };

function sourceOf(skillsDir: string, filePath: string): SkillSource {
  const top = path.relative(skillsDir, filePath).split(path.sep)[0];
  if (top === "bukit") return "bukit";
  if (top === "bukitjalil") return "bukitjalil";
  return "other";
}

/**
 * The real directories the AI may read for the enabled skills. A skill whose real base directory is
 * outside the real skills directory (a symlink) is skipped, so it cannot widen the read gate.
 */
export function skillReadRoots(
  skills: readonly { name: string; baseDir: string; filePath: string }[],
  skillsDir: string,
  onSkip?: (name: string, reason: string) => void,
): string[] {
  let realSkills: string;
  try {
    realSkills = fs.realpathSync.native(skillsDir);
  } catch {
    return [];
  }
  const roots = new Set<string>();
  const within = (candidate: string, parent: string) => candidate === parent || candidate.startsWith(parent + path.sep);
  for (const skill of skills) {
    let realBase: string;
    let realFile: string;
    try {
      realBase = fs.realpathSync.native(skill.baseDir);
      realFile = fs.realpathSync.native(skill.filePath);
    } catch {
      onSkip?.(skill.name, "cannot resolve");
      continue;
    }
    // A root-level Markdown skill has the skills directory as its base; allow that one file only.
    const root = realBase === realSkills ? realFile : realBase;
    if (!within(root, realSkills)) {
      onSkip?.(skill.name, "outside skills directory");
      continue;
    }
    // A SKILL.md symlink that points outside its skill directory is not part of the skill.
    if (realBase !== realSkills && !within(realFile, realBase)) {
      onSkip?.(skill.name, "file outside skill directory");
      continue;
    }
    roots.add(root);
  }
  return [...roots];
}

/** The skills Pi loads for a session: only BukitJalil's directory, never the site or the user's home. */
export function listSkills(
  pi: PiModules,
  skillsDir: string,
  piDir: string,
  disabled: readonly string[],
): SkillsResponse {
  const off = new Set(disabled);
  const loaded = pi.pi.loadSkills({
    cwd: skillsDir,
    agentDir: piDir,
    skillPaths: [skillsDir],
    includeDefaults: false,
  });
  const skills: SkillInfo[] = loaded.skills
    .map((skill) => {
      const required = isRequiredSkill(skill.name);
      return {
        name: skill.name,
        description: skill.description,
        source: sourceOf(skillsDir, skill.filePath),
        required,
        enabled: required || !off.has(skill.name),
      };
    })
    .sort(
      (a, b) => SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source] || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    );
  const diagnostics: SkillDiagnostic[] = loaded.diagnostics.map((d) => ({
    type: d.type,
    message: d.message,
    ...(d.path ? { path: d.path } : {}),
  }));
  return { skills, diagnostics };
}
