import path from "node:path";
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
export function createModelRuntime({ pi }: PiModules, piDir: string) {
  return pi.ModelRuntime.create({
    authPath: path.join(piDir, "auth.json"),
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
}

/**
 * Resources for one session (plan 6.4): our system prompt only. No context files (AGENTS.md, CLAUDE.md),
 * prompt templates, themes, discovered skills or extensions, from the site or from the user's home.
 * BukitJalil's skills and the gate extension are added in later steps.
 */
export async function createResourceLoader({ pi }: PiModules, opts: ResourceOptions) {
  const loader = new pi.DefaultResourceLoader({
    cwd: opts.cwd,
    agentDir: opts.piDir,
    settingsManager: opts.settings,
    systemPrompt: opts.systemPrompt,
    noContextFiles: true,
    noPromptTemplates: true,
    noThemes: true,
    noSkills: true,
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
    "- Use only the tools you are given. You cannot run commands.",
    "- Use paths relative to the working directory. Never read or change anything outside it.",
    "- Do not touch .git, build output (dist, .bukit, .cache) or plugin files.",
    "- Reply in the language the user writes in.",
  ].join("\n");
}
