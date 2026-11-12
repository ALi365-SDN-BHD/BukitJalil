import type { PublishAccountRequest, PublishAccount as SavedPublishAccount } from "@bukitjalil/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, KeyRound, Loader2, Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";
import { SettingsRow, settingsSelectClass } from "./SettingsLayout";

/** Saved GitHub tokens; a site picks one account when its deploy target is configured. */
export function PublishAccountsSection() {
  const { m, t, errorOf } = useI18n();
  const s = m.settings.publishAccounts;
  const queryClient = useQueryClient();
  const accounts = useQuery({ queryKey: keys.publishAccounts, queryFn: api.publishAccounts });
  const [editing, setEditing] = useState<SavedPublishAccount | "new" | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => api.deletePublishAccount(id),
    onSuccess: () => {
      setConfirming(null);
      void queryClient.invalidateQueries({ queryKey: keys.publishAccounts });
      void queryClient.invalidateQueries({ queryKey: ["deploy"] });
    },
  });

  if (editing)
    return (
      <PublishAccountForm
        initial={editing === "new" ? null : editing}
        onCancel={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void queryClient.invalidateQueries({ queryKey: keys.publishAccounts });
        }}
      />
    );

  return (
    <div className="flex flex-col gap-4" data-testid="publish-accounts">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{s.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{s.hint}</p>
        </div>
        <Button type="button" size="sm" onClick={() => setEditing("new")} data-testid="publish-account-add">
          <Plus /> {s.add}
        </Button>
      </div>

      {accounts.isPending ? (
        <p className="text-sm text-muted-foreground">{m.common.loading}</p>
      ) : accounts.error ? (
        <p role="alert" className="text-sm text-destructive">
          {errorOf(accounts.error)}
        </p>
      ) : accounts.data && accounts.data.length > 0 ? (
        <div className="flex flex-col divide-y rounded-md border" data-testid="publish-account-list">
          {accounts.data.map((account) => (
            <div
              key={account.id}
              className="flex flex-wrap items-center gap-3 p-3"
              data-testid={`publish-account-${account.id}`}
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
                <KeyRound className="size-4 text-muted-foreground" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{account.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {s.platforms[account.platform]} ·{" "}
                  {t(account.hasToken ? s.tokenStored : s.tokenMissing, { last4: account.tokenLast4 ?? "····" })}
                </span>
                <code
                  className="block truncate text-xs text-muted-foreground"
                  data-testid={`publish-account-id-${account.id}`}
                >
                  {account.id}
                </code>
              </span>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => setEditing(account)}
                data-testid={`publish-account-edit-${account.id}`}
              >
                {s.edit}
              </Button>
              {confirming === account.id ? (
                <span className="flex gap-1">
                  <Button
                    type="button"
                    size="xs"
                    variant="destructive"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(account.id)}
                    data-testid={`publish-account-delete-confirm-${account.id}`}
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
                  onClick={() => setConfirming(account.id)}
                  data-testid={`publish-account-delete-${account.id}`}
                >
                  {s.delete}
                </Button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground" data-testid="publish-account-empty">
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

function PublishAccountForm({
  initial,
  onCancel,
  onSaved,
}: {
  initial: SavedPublishAccount | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { m, t, errorOf } = useI18n();
  const s = m.settings.publishAccounts;
  const [platform, setPlatform] = useState<"github">("github");
  const [name, setName] = useState(initial?.name ?? "");
  const [token, setToken] = useState("");
  const hasStoredToken = initial?.hasToken ?? false;
  const save = useMutation({
    mutationFn: () => {
      const body: PublishAccountRequest = {
        name: name.trim(),
        platform,
        ...(token.trim() ? { token: token.trim() } : {}),
      };
      return initial ? api.updatePublishAccount(initial.id, body) : api.createPublishAccount(body);
    },
    onSuccess: onSaved,
  });

  return (
    <div className="flex flex-col gap-4" data-testid="publish-account-form">
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={m.common.back}
          title={m.common.back}
          onClick={onCancel}
          data-testid="publish-account-form-back"
        >
          <ArrowLeft />
        </Button>
        <h2 className="text-base font-semibold">{initial ? s.edit : s.add}</h2>
      </div>

      <div className="flex flex-col divide-y">
        <SettingsRow label={s.platform}>
          <select
            className={settingsSelectClass}
            value={platform}
            onChange={(e) => setPlatform(e.target.value as "github")}
            data-testid="publish-account-platform"
          >
            <option value="github">{s.platforms.github}</option>
          </select>
        </SettingsRow>
        <SettingsRow label={s.name} description={s.nameHint}>
          <Input
            className="md:w-80"
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
            data-testid="publish-account-name"
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
            data-testid="publish-account-token"
          />
        </SettingsRow>
      </div>

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
          disabled={save.isPending || !name.trim() || (!hasStoredToken && !token.trim())}
          onClick={() => save.mutate()}
          data-testid="publish-account-save"
        >
          {save.isPending ? <Loader2 className="animate-spin" /> : null}
          {s.save}
        </Button>
      </div>
    </div>
  );
}
