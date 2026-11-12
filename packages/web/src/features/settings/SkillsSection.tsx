import type { SkillInfo, SkillsResponse } from "@bukitjalil/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";
import { SettingsRow, SettingsSection } from "./SettingsLayout";

/** Settings → Skills: which of BukitJalil's bundled Pi skills the next message loads. */
export function SkillsSection() {
  const { m, t, errorOf } = useI18n();
  const queryClient = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const skills = useQuery({ queryKey: keys.skills, queryFn: api.skills, retry: false });
  const save = useMutation({
    mutationFn: (vars: { name: string; enabled: boolean; disabledSkills: string[] }) =>
      api.updateSettings({ disabledSkills: vars.disabledSkills }),
    onSuccess: (data, vars) => {
      queryClient.setQueryData(keys.settings, data);
      queryClient.setQueryData<SkillsResponse>(keys.skills, (old) =>
        old
          ? { ...old, skills: old.skills.map((s) => (s.name === vars.name ? { ...s, enabled: vars.enabled } : s)) }
          : old,
      );
      setError(null);
      void queryClient.invalidateQueries({ queryKey: keys.skills });
    },
    onError: setError,
  });

  if (skills.isPending) return <p className="text-sm text-muted-foreground">{m.common.loading}</p>;
  if (skills.error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {errorOf(skills.error)}
      </p>
    );
  if (!skills.data) return null;
  const data = skills.data;
  if (data.skills.length === 0) return <p className="text-sm text-muted-foreground">{m.skills.noSkills}</p>;

  const groups = [
    { source: "bukitjalil" as const, title: m.skills.sources.bukitjalil },
    { source: "bukit" as const, title: m.skills.sources.bukit },
    { source: "other" as const, title: m.skills.sources.other },
  ];
  const nextDisabled = (skill: SkillInfo, enabled: boolean): string[] =>
    data.skills
      .filter((s) => !s.required)
      .filter((s) => (s.name === skill.name ? !enabled : !s.enabled))
      .map((s) => s.name);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-base font-semibold">{m.skills.title}</h1>
        <p className="text-sm text-muted-foreground">{m.skills.description}</p>
        <p className="text-xs text-muted-foreground">{m.skills.applyNext}</p>
        {data.diagnostics.length > 0 && (
          <p role="alert" className="text-xs text-amber-700 dark:text-amber-400">
            {t(m.skills.diagnostics, { count: data.diagnostics.length })}
          </p>
        )}
        {error !== null && (
          <p role="alert" className="text-xs text-destructive">
            {errorOf(error)}
          </p>
        )}
      </div>
      {groups.map((group) => {
        const items = data.skills.filter((skill) => skill.source === group.source);
        if (items.length === 0) return null;
        return (
          <SettingsSection key={group.source} title={group.title}>
            {items.map((skill) => (
              <SettingsRow
                key={skill.name}
                testId={`skill-${skill.name}`}
                label={
                  <span className="flex items-center gap-2">
                    {skill.name}
                    {skill.required && <Badge tone="neutral">{m.skills.required}</Badge>}
                  </span>
                }
                description={skill.description}
              >
                <Switch
                  checked={skill.enabled}
                  disabled={skill.required || save.isPending}
                  onCheckedChange={(enabled) =>
                    save.mutate({ name: skill.name, enabled, disabledSkills: nextDisabled(skill, enabled) })
                  }
                  label={skill.name}
                  testId={`skill-toggle-${skill.name}`}
                />
              </SettingsRow>
            ))}
          </SettingsSection>
        );
      })}
    </div>
  );
}
