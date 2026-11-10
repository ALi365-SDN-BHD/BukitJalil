import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";

/** The GitHub token Bukit gets when publishing (plan 6.5): last four shown, read-only when it comes from the environment. */
export function GitHubTokenSection() {
  const { m, t, errorOf } = useI18n();
  const s = m.settings.github;
  const queryClient = useQueryClient();
  const secrets = useQuery({ queryKey: keys.secrets, queryFn: api.secrets });
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState(false);
  const done = (data: Awaited<ReturnType<typeof api.secrets>>) => {
    setValue("");
    setEditing(false);
    queryClient.setQueryData(keys.secrets, data);
    // Whether a site can be published depends on the token.
    void queryClient.invalidateQueries({ queryKey: ["deploy"] });
  };
  const save = useMutation({ mutationFn: () => api.setSecret("github", value.trim()), onSuccess: done });
  const remove = useMutation({ mutationFn: () => api.removeSecret("github"), onSuccess: done });
  const token = secrets.data?.github;
  const error = secrets.error ?? save.error ?? remove.error;

  let status = m.common.loading;
  if (token && !token.configured) status = s.missing;
  else if (token?.source === "stored") status = t(s.stored, { last4: token.last4 ?? "····" });
  else if (token?.source === "environment") status = t(s.env, { name: token.label });
  const showField = !!token && token.source !== "environment" && (!token.configured || editing);

  return (
    <section className="flex flex-col gap-2 rounded-md border p-3" data-testid="github-token-section">
      <h3 className="text-sm font-medium">{s.title}</h3>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs" data-testid="github-token-status">
          {status}
        </span>
        {token?.source === "stored" && !editing && (
          <>
            <Button type="button" size="xs" variant="ghost" onClick={() => setEditing(true)}>
              {s.change}
            </Button>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
              data-testid="github-token-remove"
            >
              {s.remove}
            </Button>
          </>
        )}
      </div>
      {showField && (
        <div className="flex gap-2">
          <Input
            type="password"
            // Not "off": browsers ignore that for password fields and offer to save the token.
            autoComplete="one-time-code"
            spellCheck={false}
            aria-label={s.label}
            placeholder={s.label}
            value={value}
            data-testid="github-token-input"
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                // Inside the settings form: save the token, not the form.
                e.preventDefault();
                if (value.trim() && !save.isPending) save.mutate();
              }
            }}
          />
          <Button
            type="button"
            size="sm"
            disabled={!value.trim() || save.isPending}
            onClick={() => save.mutate()}
            data-testid="github-token-save"
          >
            {save.isPending ? m.common.saving : s.save}
          </Button>
          {editing && (
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              {m.common.cancel}
            </Button>
          )}
        </div>
      )}
      <p className="text-xs text-muted-foreground">{s.hint}</p>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {errorOf(error)}
        </p>
      )}
    </section>
  );
}
