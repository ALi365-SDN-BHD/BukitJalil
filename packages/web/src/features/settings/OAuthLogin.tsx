import type { ProviderInfo, ProviderLoginEvent, ProviderLoginPrompt } from "@bukitjalil/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n";
import { api } from "@/lib/api";
import { SettingsRow } from "./SettingsLayout";

/**
 * Pi's native OAuth login for a provider that supports subscription accounts (Claude Pro/Max, GitHub
 * Copilot, Kimi, OpenRouter, xAI, ...). The server runs the flow; this panel shows its URL, device code
 * or prompts and polls until it finishes.
 */
export function OAuthLogin({ provider, onDone }: { provider: ProviderInfo; onDone: () => void }) {
  const { m, t, errorOf } = useI18n();
  const s = m.settings.model;
  const queryClient = useQueryClient();
  const [id, setId] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);

  const start = useMutation({
    mutationFn: () => api.startProviderLogin(provider.id),
    onSuccess: ({ id }) => {
      setId(id);
      setFinished(false);
    },
  });
  const status = useQuery({
    queryKey: ["provider-login", provider.id, id],
    queryFn: () => api.providerLogin(provider.id, id as string),
    enabled: id !== null,
    refetchInterval: (q) => (q.state.data?.state === "running" ? 1000 : false),
  });
  const answer = useMutation({
    mutationFn: (value: string) => api.answerProviderLogin(provider.id, id as string, value),
    onSuccess: (data) => queryClient.setQueryData(["provider-login", provider.id, id], data),
  });
  const cancel = useMutation({
    mutationFn: () => api.cancelProviderLogin(provider.id, id as string),
    onSettled: () => {
      setId(null);
      setFinished(false);
    },
  });
  const logout = useMutation({
    mutationFn: () => api.logoutProvider(provider.id),
    onSuccess: onDone,
  });

  const current = status.data;
  const done = current?.state === "done";
  useEffect(() => {
    if (done && !finished) {
      setFinished(true);
      onDone();
    }
  }, [done, finished, onDone]);

  const error = start.error ?? status.error ?? answer.error ?? cancel.error ?? logout.error;

  // Already signed in and not looking at a fresh login: offer the way out.
  if (provider.auth.type === "oauth" && id === null) {
    return (
      <SettingsRow label={s.account} description={s.oauthSignedIn}>
        <Button
          type="button"
          size="xs"
          variant="outline"
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
          data-testid="provider-oauth-logout"
        >
          {logout.isPending ? m.common.saving : s.signOut}
        </Button>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {errorOf(error)}
          </p>
        )}
      </SettingsRow>
    );
  }

  return (
    <>
      <SettingsRow
        label={s.account}
        description={done ? s.oauthSignedIn : provider.oauth?.isSubscription ? s.oauthHint : undefined}
      >
        {id === null && (
          <Button
            type="button"
            size="sm"
            onClick={() => start.mutate()}
            disabled={start.isPending}
            data-testid="provider-oauth-sign-in"
            title={provider.oauth?.loginLabel}
          >
            {start.isPending && <Loader2 className="animate-spin" />}
            {provider.oauth?.loginLabel ?? t(s.signInWith, { provider: provider.name })}
          </Button>
        )}
        {id !== null && current?.state === "running" && (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            onClick={() => cancel.mutate()}
            disabled={cancel.isPending}
            data-testid="provider-oauth-cancel"
          >
            {m.common.cancel}
          </Button>
        )}
        {done && (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            onClick={() => {
              setId(null);
              setFinished(false);
            }}
            data-testid="provider-oauth-close"
          >
            {m.common.close}
          </Button>
        )}
      </SettingsRow>

      {id !== null && current?.state === "running" && (
        <div
          className="flex flex-col gap-2 rounded-md border p-3 text-xs"
          data-testid="provider-oauth-status"
          role="status"
          aria-live="polite"
        >
          {current.events.map((event, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: events are appended in order and never reordered
            <LoginEvent key={index} event={event} />
          ))}
          {current.prompt && (
            <LoginPrompt
              key={`${current.prompt.type}:${current.prompt.message}`}
              prompt={current.prompt}
              busy={answer.isPending}
              onSubmit={(value) => answer.mutate(value)}
            />
          )}
        </div>
      )}
      {done && <p className="text-xs text-emerald-700 dark:text-emerald-400">{s.oauthSignedIn}</p>}
      {current?.state === "error" && current.error && (
        <p role="alert" className="text-xs text-destructive">
          {current.error}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {errorOf(error)}
        </p>
      )}
    </>
  );
}

function LoginEvent({ event }: { event: ProviderLoginEvent }) {
  const { m, t } = useI18n();
  const s = m.settings.model;
  if (event.type === "auth_url") {
    return (
      <div className="flex flex-col gap-1">
        {event.instructions && <p>{event.instructions}</p>}
        <a href={event.url} target="_blank" rel="noreferrer" className="break-all underline">
          {s.openSignInPage}
        </a>
      </div>
    );
  }
  if (event.type === "device_code") {
    return (
      <div className="flex flex-col gap-1">
        <p>{t(s.deviceCode, { code: event.userCode })}</p>
        <a href={event.verificationUri} target="_blank" rel="noreferrer" className="break-all underline">
          {event.verificationUri}
        </a>
      </div>
    );
  }
  if (event.type === "info") {
    return (
      <div className="flex flex-col gap-1">
        <p>{event.message}</p>
        {event.links?.map((link) => (
          <a key={link.url} href={link.url} target="_blank" rel="noreferrer" className="break-all underline">
            {link.label ?? link.url}
          </a>
        ))}
      </div>
    );
  }
  return <p>{event.message}</p>;
}

function LoginPrompt({
  prompt,
  busy,
  onSubmit,
}: {
  prompt: ProviderLoginPrompt;
  busy: boolean;
  onSubmit: (value: string) => void;
}) {
  const { m } = useI18n();
  const [value, setValue] = useState("");

  if (prompt.type === "select") {
    return (
      <div className="flex flex-col gap-2">
        <p>{prompt.message}</p>
        <div className="flex flex-wrap gap-2">
          {prompt.options.map((option) => (
            <Button
              key={option.id}
              type="button"
              size="xs"
              variant="outline"
              disabled={busy}
              title={option.description}
              onClick={() => onSubmit(option.id)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim() && !busy) onSubmit(value.trim());
      }}
    >
      <label htmlFor="oauth-prompt" className="text-xs">
        {prompt.message}
      </label>
      <div className="flex gap-2">
        <Input
          id="oauth-prompt"
          type={prompt.type === "secret" ? "password" : "text"}
          autoComplete="off"
          spellCheck={false}
          placeholder={prompt.placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          data-testid="provider-oauth-prompt"
        />
        <Button type="submit" size="sm" disabled={!value.trim() || busy} data-testid="provider-oauth-answer">
          {busy ? m.common.saving : m.common.save}
        </Button>
      </div>
    </form>
  );
}
