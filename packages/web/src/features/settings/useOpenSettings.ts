import { useLocation, useNavigate } from "react-router";

export const SETTINGS_SECTIONS = [
  "general",
  "model",
  "skills",
  "publishing",
  "data",
  "extensions",
  "environment",
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

const OLD_SECTIONS: Record<string, SettingsSection> = { identity: "publishing", github: "publishing" };

export function isSettingsSection(value: string | null): value is SettingsSection {
  return SETTINGS_SECTIONS.includes(value as SettingsSection);
}

/** New links use the current ids; old `identity` / `github` links open the merged publishing section. */
export function resolveSettingsSection(value: string | null): SettingsSection {
  const old = value ? OLD_SECTIONS[value] : undefined;
  if (old) return old;
  return isSettingsSection(value) ? value : "general";
}

/** Open the settings page, remembering the page the user came from for its back button. */
export function useOpenSettings() {
  const navigate = useNavigate();
  const location = useLocation();
  return (section: SettingsSection = "general") =>
    navigate(section === "general" ? "/settings" : `/settings?section=${section}`, {
      state: { from: `${location.pathname}${location.search}` },
    });
}
