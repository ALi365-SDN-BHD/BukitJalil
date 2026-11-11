import type { Settings } from "@bukitjalil/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Field, Input } from "@/components/ui/input";
import { useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";

export interface IdentityDraft {
  name: string;
  email: string;
}

/**
 * The commit identity (plan 5.2): needed before BukitJalil makes a commit. When settings have none, the
 * fields are prefilled from the global git identity; `save` stores them before the commit is made.
 */
export function useIdentity() {
  const settings = useQuery({ queryKey: keys.settings, queryFn: api.settings });
  const missing = !!settings.data && (!settings.data.commitName || !settings.data.commitEmail);
  const global = useQuery({ queryKey: ["git-identity"], queryFn: api.identity, enabled: missing });
  const [draft, setDraft] = useState<IdentityDraft>({ name: "", email: "" });
  useEffect(() => {
    if (global.data)
      setDraft((d) => ({ name: d.name || global.data.name || "", email: d.email || global.data.email || "" }));
  }, [global.data]);
  const save = async (): Promise<Settings | null> =>
    missing ? api.updateSettings({ commitName: draft.name.trim(), commitEmail: draft.email.trim() }) : null;
  return { missing, draft, setDraft, save, ready: !missing || (draft.name.trim() !== "" && draft.email.trim() !== "") };
}

export function IdentityFields({ draft, onChange }: { draft: IdentityDraft; onChange: (d: IdentityDraft) => void }) {
  const { m } = useI18n();
  return (
    <fieldset className="flex flex-col gap-3 rounded-md border p-3">
      <legend className="px-1 text-sm font-medium">{m.identity.title}</legend>
      <p className="text-xs text-muted-foreground">{m.identity.hint}</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label={m.identity.name} htmlFor="commit-name">
          <Input id="commit-name" value={draft.name} onChange={(e) => onChange({ ...draft, name: e.target.value })} />
        </Field>
        <Field label={m.identity.email} htmlFor="commit-email">
          <Input
            id="commit-email"
            type="email"
            value={draft.email}
            onChange={(e) => onChange({ ...draft, email: e.target.value })}
          />
        </Field>
      </div>
    </fieldset>
  );
}
