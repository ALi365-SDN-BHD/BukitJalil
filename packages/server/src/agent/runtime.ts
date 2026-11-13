import path from "node:path";
import { REQUIRED_SKILLS } from "@bukitjalil/shared";
import type { CredentialStore } from "@earendil-works/pi-ai";
import type { SettingsManager } from "@earendil-works/pi-coding-agent";
import type { PiModules } from "./pi.ts";

/**
 * Settings that differ from Pi's defaults (Pi SDK 1.5.1):
 * - cacheWarming: "idle" would send model requests between runs, which costs money
 * - install telemetry and analytics: off
 */
export const SAFE_SETTINGS: NonNullable<Parameters<typeof SettingsManager.inMemory>[0]> = {
  cacheWarming: "off",
  enableInstallTelemetry: false,
  enableAnalytics: false,
};

/**
 * Pi settings for one session, kept in memory so the user's ~/.pi settings are never read (plan 6.1).
 * projectTrusted must be false: an in-memory SettingsManager trusts the project by default, and a trusted
 * project loads `.pi/extensions` (code), `.pi/SYSTEM.md` and `.agents/skills` from the site's files.
 */
export function createSettings({ pi }: PiModules): SettingsManager {
  return pi.SettingsManager.inMemory(structuredClone(SAFE_SETTINGS), { projectTrusted: false });
}

/** Model keys and custom models live in the app's own Pi directory; the model list is never fetched. */
export function createModelRuntime({ pi }: PiModules, piDir: string, credentials?: CredentialStore) {
  return pi.ModelRuntime.create({
    // Encrypted keys (plan 6.7) when the desktop app has a keychain; Pi's auth.json otherwise.
    ...(credentials ? { credentials } : { authPath: path.join(piDir, "auth.json") }),
    modelsPath: path.join(piDir, "models.json"),
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
}

export interface ResourceOptions {
  cwd: string;
  piDir: string;
  settings: SettingsManager;
  systemPrompt: string;
  /** BukitJalil's skills directory; the only skills loaded. */
  skillsDir: string;
  /** Optional skills turned off in Settings; required skills stay on. */
  disabledSkills?: readonly string[];
}

/**
 * Resources for one session (plan 6.4): our system prompt and BukitJalil's skills. No context files
 * (AGENTS.md, CLAUDE.md), prompt templates, themes, discovered skills or extensions, from the site or from
 * the user's home. With noSkills, Pi loads only `additionalSkillPaths`.
 */
export async function createResourceLoader({ pi }: PiModules, opts: ResourceOptions) {
  const off = new Set(opts.disabledSkills ?? []);
  const required = new Set<string>(REQUIRED_SKILLS);
  const loader = new pi.DefaultResourceLoader({
    cwd: opts.cwd,
    agentDir: opts.piDir,
    settingsManager: opts.settings,
    systemPrompt: opts.systemPrompt,
    noContextFiles: true,
    noPromptTemplates: true,
    noThemes: true,
    noSkills: true,
    additionalSkillPaths: [opts.skillsDir],
    // Settings can hide a skill from the prompt; site-editing is part of the site workflow and stays.
    skillsOverride: ({ skills, diagnostics }) => ({
      skills: skills.filter((skill) => !off.has(skill.name) || required.has(skill.name)),
      diagnostics,
    }),
    noExtensions: true,
  });
  await loader.reload();
  return loader;
}

export interface PromptSite {
  name: string;
  /** Where the user keeps the site; the AI works in a copy and never sees this path. */
  path: string;
}

/** BukitJalil's system prompt (plan 6.4). Pi appends the working directory itself. */
export function buildSystemPrompt(site: PromptSite): string {
  return [
    "You are the BukitJalil site assistant. You help the user build and edit one static website made",
    "with Bukit, by reading and changing the site's files.",
    "",
    `The site is "${site.name}". You work in a private copy of it (the working directory below); the`,
    "user reviews your changes before they reach the site.",
    "",
    "Rules:",
    "- Use only the tools you are given. You cannot run commands: where Bukit's skills say `bukit config",
    "  check` or `bukit doctor`, use bukit_check; for `bukit build`, use bukit_build; for `bukit config",
    "  schema`, use bukit_schema. Previews, the dev server, deploys and plugins are handled by BukitJalil.",
    "- Use paths relative to the working directory. Never read or change anything outside it, except",
    "  reading the skill files listed below.",
    "- Do not touch .git, build output (dist, .bukit, .cache) or plugin files.",
    "- Start with site_info (and list_content when you work on content). After changing files, run",
    "  bukit_check, then bukit_build, and fix what they report. When a round of changes is done, call",
    "  summarize_changes with a short description for the user's review.",
    "- Reply in the language the user writes in.",
  ].join("\n");
}
