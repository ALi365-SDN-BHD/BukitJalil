/** Pi skills bundled with BukitJalil and managed in Settings. */

/** Skills the session workflow depends on; they cannot be turned off (each where its project kind uses it). */
export const REQUIRED_SKILLS = ["site-editing", "theme-development"] as const;

/** Skills only theme projects load (theme development design 4.1). */
export const THEME_SKILLS: readonly string[] = ["theme-development"];
/** Skills only sites load: a theme project is never published. */
export const SITE_ONLY_SKILLS: readonly string[] = ["publishing"];

export type SkillSource = "bukit" | "bukitjalil" | "other";

export interface SkillInfo {
  name: string;
  description: string;
  source: SkillSource;
  /** Always enabled, even if the stored list names it. */
  required: boolean;
  enabled: boolean;
}

export interface SkillDiagnostic {
  type: "warning" | "error" | "collision";
  message: string;
  /** File the diagnostic refers to, when Pi reports one. */
  path?: string;
}

export interface SkillsResponse {
  skills: SkillInfo[];
  diagnostics: SkillDiagnostic[];
}

export function isRequiredSkill(name: string): boolean {
  return (REQUIRED_SKILLS as readonly string[]).includes(name);
}
