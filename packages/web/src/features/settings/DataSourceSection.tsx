import type { DataSourceRequest, SavedDataSource } from "@bukitjalil/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Database, Loader2, Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";
import { SettingsRow } from "./SettingsLayout";

/** Saved Notion sources; Markdown is the default and is not saved here. */
export function DataSourceSection() {
  const { m, t, errorOf } = useI18n();
  const s = m.settings.dataSources;
  const queryClient = useQueryClient();
  const sources = useQuery({ queryKey: keys.dataSources, queryFn: api.dataSources });
  const [editing, setEditing] = useState<SavedDataSource | "new" | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteDataSource(id),
    onSuccess: () => {
      setConfirming(null);
      void queryClient.invalidateQueries({ queryKey: keys.dataSources });
    },
  });

  if (editing)
    return (
      <DataSourceForm
        initial={editing === "new" ? null : editing}
        onCancel={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void queryClient.invalidateQueries({ queryKey: keys.dataSources });
          // A new token drops the Notion offline snapshot of the sites using the source (plan 5.5).
          void queryClient.invalidateQueries({ queryKey: ["panel"] });
        }}
      />
    );

  return (
    <div className="flex flex-col gap-4" data-testid="data-sources">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{s.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{s.hint}</p>
        </div>
        <Button type="button" size="sm" onClick={() => setEditing("new")} data-testid="data-source-add">
          <Plus /> {s.add}
        </Button>
      </div>

      {sources.isPending ? (
        <p className="text-sm text-muted-foreground">{m.common.loading}</p>
      ) : sources.error ? (
        <p role="alert" className="text-sm text-destructive">
          {errorOf(sources.error)}
        </p>
      ) : sources.data && sources.data.length > 0 ? (
        <div className="flex flex-col divide-y rounded-md border" data-testid="data-source-list">
          {sources.data.map((source) => (
            <div
              key={source.id}
              className="flex flex-wrap items-center gap-3 p-3"
              data-testid={`data-source-${source.id}`}
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
                <Database className="size-4 text-muted-foreground" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{source.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {source.hasToken ? t(s.tokenStored, { last4: source.tokenLast4 ?? "····" }) : s.tokenMissing}
                </span>
                <code
                  className="block truncate text-xs text-muted-foreground"
                  data-testid={`data-source-id-${source.id}`}
                >
                  {source.id}
                </code>
              </span>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => setEditing(source)}
                data-testid={`data-source-edit-${source.id}`}
              >
                {s.edit}
              </Button>
              {confirming === source.id ? (
                <span className="flex gap-1">
                  <Button
                    type="button"
                    size="xs"
                    variant="destructive"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(source.id)}
                    data-testid={`data-source-delete-confirm-${source.id}`}
                  >
                    {remove.isPending ? <Loader2 className="animate-spin" /> : s.deleteConfirm}
                  </Button>
                  <Button type="button" size="xs" variant="ghost" onClick={() => setConfirming(null)}>
                    {m.common.cancel}
                  </Button>
                </span>
              ) : (
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => setConfirming(source.id)}
                  data-testid={`data-source-delete-${source.id}`}
                >
                  {s.delete}
                </Button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground" data-testid="data-source-empty">
          {s.empty}
        </p>
      )}
      {remove.error && (
        <p role="alert" className="text-xs text-destructive">
          {errorOf(remove.error)}
        </p>
      )}
    </div>
  );
}

const EMPTY = { name: "", token: "" };

function DataSourceForm({
  initial,
  onCancel,
  onSaved,
}: {
  initial: SavedDataSource | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { m, t, errorOf } = useI18n();
  const s = m.settings.dataSources;
  const [name, setName] = useState(initial?.name ?? EMPTY.name);
  const [token, setToken] = useState("");

  const save = useMutation({
    mutationFn: () => {
      const body: DataSourceRequest = {
        platform: "notion",
        name: name.trim(),
        ...(token.trim() ? { token: token.trim() } : {}),
      };
      return initial ? api.updateDataSource(initial.id, body) : api.createDataSource(body);
    },
    onSuccess: onSaved,
  });

  const hasStoredToken = initial?.hasToken ?? false;
  const canSave = name.trim().length > 0 && (hasStoredToken || token.trim().length > 0);

  return (
    <div className="flex flex-col gap-4" data-testid="data-source-form">
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={m.common.back}
          title={m.common.back}
          onClick={onCancel}
          data-testid="data-source-form-back"
        >
          <ArrowLeft />
        </Button>
        <h2 className="text-base font-semibold">{initial ? s.edit : s.add}</h2>
      </div>

      <div className="flex flex-col divide-y">
        <SettingsRow label={s.name} description={s.nameHint}>
          <Input
            className="md:w-80"
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
            data-testid="data-source-name"
          />
        </SettingsRow>
        <SettingsRow
          label={s.token}
          description={
            hasStoredToken && !token ? t(s.tokenStored, { last4: initial?.tokenLast4 ?? "····" }) : s.tokenHint
          }
        >
          <Input
            type="password"
            autoComplete="one-time-code"
            spellCheck={false}
            className="md:w-80"
            value={token}
            placeholder={hasStoredToken ? s.tokenStoredShort : s.token}
            onChange={(e) => setToken(e.target.value)}
            data-testid="data-source-token"
          />
        </SettingsRow>
      </div>

      <p className="text-xs text-muted-foreground">{s.notionNote}</p>

      <div className="flex items-center justify-end gap-2">
        {save.error && (
          <span role="alert" className="mr-auto text-xs text-destructive">
            {errorOf(save.error)}
          </span>
        )}
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          {m.common.cancel}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={save.isPending || !canSave}
          onClick={() => save.mutate()}
          data-testid="data-source-save"
        >
          {save.isPending ? <Loader2 className="animate-spin" /> : null}
          {s.save}
        </Button>
      </div>
    </div>
  );
}
