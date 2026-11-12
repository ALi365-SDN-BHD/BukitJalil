import type { Settings } from "@bukitjalil/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";
import { SettingsRow, SettingsSection } from "./SettingsLayout";

/** The commit identity (plan 7.2); prefilled from the global git identity when none is saved. */
export function IdentitySection() {
  const { m, errorOf } = useI18n();
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: keys.settings, queryFn: api.settings });
  const missing = !!settings.data && (!settings.data.commitName || !settings.data.commitEmail);
  const global = useQuery({ queryKey: ["git-identity"], queryFn: api.identity, enabled: missing });
  const [draft, setDraft] = useState<{ name: string; email: string } | null>(null);
  useEffect(() => {
    if (!settings.data || draft || (missing && !global.isFetched)) return;
    setDraft({
      name: settings.data.commitName ?? global.data?.name ?? "",
      email: settings.data.commitEmail ?? global.data?.email ?? "",
    });
  }, [settings.data, draft, missing, global.isFetched, global.data]);

  const save = useMutation({
    mutationFn: (d: NonNullable<typeof draft>) =>
      api.updateSettings({
        commitName: d.name.trim() || null,
        commitEmail: d.email.trim() || null,
      }),
    onSuccess: (data: Settings) => queryClient.setQueryData(keys.settings, data),
  });

  if (settings.error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {errorOf(settings.error)}
      </p>
    );
  if (!draft) return <p className="text-sm text-muted-foreground">{m.common.loading}</p>;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(draft);
      }}
    >
      <SettingsSection title={m.identity.title} description={m.identity.hint} divided={false}>
        <SettingsRow label={m.identity.name}>
          <Input
            id="commit-name"
            className="md:w-80"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </SettingsRow>
        <SettingsRow label={m.identity.email}>
          <Input
            id="commit-email"
            type="email"
            className="md:w-80"
            value={draft.email}
            onChange={(e) => setDraft({ ...draft, email: e.target.value })}
          />
        </SettingsRow>
      </SettingsSection>
      <div className="flex items-center justify-end gap-2 pt-4">
        {save.error && (
          <span role="alert" className="mr-auto text-xs text-destructive">
            {errorOf(save.error)}
          </span>
        )}
        {save.isSuccess && !save.isPending && (
          <span className="mr-auto text-xs text-muted-foreground">{m.settings.saved}</span>
        )}
        <Button type="submit" size="sm" disabled={save.isPending} data-testid="identity-save">
          {save.isPending ? m.common.saving : m.common.save}
        </Button>
      </div>
    </form>
  );
}
