import type { ModelsResponse, ProviderInfo, ProviderTestResult, Settings, ThinkingLevel } from "@bukitjalil/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight, Loader2, PlugZap, Server } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";
import { LocalModelsView } from "./LocalModelsView";
import { OAuthLogin } from "./OAuthLogin";
import { ProviderLogo } from "./ProviderLogo";
import { SettingsRow, settingsSelectClass } from "./SettingsLayout";

/** The levels offered in the UI; Pi clamps them to what the model supports. */
const LEVELS: ThinkingLevel[] = ["off", "low", "medium", "high"];

/**
 * Providers that can be used from here, with a key first, then by name. A provider without a key that
 * can neither take one here nor read one from the environment (sign-in only, such as OpenAI Codex) is
 * left out.
 */
function usableProviders(providers: ProviderInfo[]): ProviderInfo[] {
  return providers
    .filter((p) => p.key.configured || p.keyEditable || p.envKey || p.oauth || p.custom)
    .sort((a, b) => Number(b.key.configured) - Number(a.key.configured) || a.name.localeCompare(b.name));
}

/**
 * Model settings (plan 6.5): a provider list, then the provider's models, API key (only the last four
 * characters are ever shown), thinking level and context window. Everything here saves on its own; the
 * settings form's Save button is not involved.
 */
export function ModelSection() {
  const { m, errorOf } = useI18n();
  const s = m.settings.model;
  const models = useQuery({ queryKey: keys.models, queryFn: api.models });
  if (models.isPending)
    return (
      <div className="flex flex-col gap-3" data-testid="model-section">
        <h2 className="text-base font-semibold">{s.title}</h2>
        <p className="text-sm text-muted-foreground">{m.common.loading}</p>
      </div>
    );
  if (models.error)
    return (
      <div className="flex flex-col gap-3" data-testid="model-section">
        <h2 className="text-base font-semibold">{s.title}</h2>
        <p role="alert" className="text-sm text-destructive">
          {errorOf(models.error)}
        </p>
      </div>
    );
  return <ModelForm data={models.data} />;
}

function ModelForm({ data }: { data: ModelsResponse }) {
  const { m, t, errorOf, locale } = useI18n();
  const s = m.settings.model;
  const queryClient = useQueryClient();
  const providers = useMemo(() => usableProviders(data.providers), [data.providers]);
  const initial = data.selected && !data.selectedMissing ? data.selected : null;
  const [editing, setEditing] = useState<string | null>(null);
  const [modelId, setModelId] = useState(initial?.id ?? providers[0]?.models[0]?.id ?? "");
  const [level, setLevel] = useState<ThinkingLevel>(
    LEVELS.includes(data.thinkingLevel) ? data.thinkingLevel : "medium",
  );
  const [test, setTest] = useState<ProviderTestResult | null>(null);
  const [localOpen, setLocalOpen] = useState(false);
  const refreshModels = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: keys.models });
  }, [queryClient]);

  const provider = editing ? providers.find((p) => p.id === editing) : undefined;
  const model = provider?.models.find((x) => x.id === modelId) ?? provider?.models[0];

  const use = useMutation({
    mutationFn: () =>
      api.updateSettings({ model: { provider: provider?.id ?? "", id: model?.id ?? "" }, thinkingLevel: level }),
    onSuccess: (settings: Settings) => {
      queryClient.setQueryData(keys.settings, settings);
      void queryClient.invalidateQueries({ queryKey: keys.models });
    },
  });
  const runTest = useMutation({
    mutationFn: () => api.testProvider(provider?.id ?? "", model?.id ?? ""),
    onMutate: () => setTest(null),
    onSuccess: setTest,
  });

  const selected = data.selected;
  const currentProvider = selected ? data.providers.find((p) => p.id === selected.provider) : undefined;
  const currentModel = currentProvider?.models.find((x) => x.id === selected?.id);
  const isCurrent =
    !!provider &&
    !!model &&
    !!selected &&
    selected.provider === provider.id &&
    selected.id === model.id &&
    data.thinkingLevel === level;

  const openProvider = (next: ProviderInfo) => {
    setEditing(next.id);
    setModelId(next.models[0]?.id ?? "");
    setTest(null);
  };
  const back = () => {
    setEditing(null);
    setTest(null);
  };

  if (localOpen)
    return (
      <div className="flex flex-col gap-4" data-testid="model-section">
        <LocalModelsView onBack={() => setLocalOpen(false)} onSaved={refreshModels} />
      </div>
    );

  return (
    <div className="flex flex-col gap-5" data-testid="model-section">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">{s.title}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">{s.currentLabel}</span>
          {selected && !data.selectedMissing ? (
            <Badge tone="ok" data-testid="model-current">
              {t(s.current, {
                provider: currentProvider?.name ?? selected.provider,
                model: currentModel?.name ?? selected.id,
              })}
            </Badge>
          ) : (
            <Badge tone="warn" data-testid="model-current">
              {data.selectedMissing && selected ? t(s.missing, { model: selected.id }) : s.notChosen}
            </Badge>
          )}
        </div>
      </div>

      {editing && provider ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={s.backToProviders}
              title={s.backToProviders}
              data-testid="model-back"
              onClick={back}
            >
              <ArrowLeft />
            </Button>
            <h3 className="text-sm font-medium">{provider.name}</h3>
          </div>

          {provider.oauth && <OAuthLogin provider={provider} onDone={refreshModels} />}

          <div className="flex flex-col divide-y">
            {provider.models.length > 0 ? (
              <SettingsRow label={s.model}>
                <select
                  id="model-id"
                  className={settingsSelectClass}
                  value={model?.id ?? ""}
                  data-testid="model-id"
                  onChange={(e) => {
                    setModelId(e.target.value);
                    setTest(null);
                  }}
                >
                  {provider.models.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </SettingsRow>
            ) : (
              <SettingsRow label={s.model} description={s.none} />
            )}

            {model?.reasoning && (
              <SettingsRow label={s.thinking}>
                <select
                  id="model-thinking"
                  className={settingsSelectClass}
                  value={level}
                  data-testid="model-thinking"
                  onChange={(e) => setLevel(e.target.value as ThinkingLevel)}
                >
                  {LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {s.levels[l as keyof typeof s.levels]}
                    </option>
                  ))}
                </select>
              </SettingsRow>
            )}

            {model && (
              <SettingsRow label={s.contextWindow} description={s.contextWindowHint}>
                <span className="text-sm" data-testid="model-context">
                  {new Intl.NumberFormat(locale).format(model.contextWindow)} {s.tokens}
                </span>
              </SettingsRow>
            )}

            {provider.custom && (
              <SettingsRow label={s.localSettings} description={s.localSettingsHint}>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={() => setLocalOpen(true)}
                  data-testid="model-local-manage"
                >
                  {s.localManage}
                </Button>
              </SettingsRow>
            )}

            {/* Remounted per provider, so a half-typed key never carries over to another provider. */}
            {!provider.custom &&
              provider.auth.type !== "oauth" &&
              (provider.keyEditable || provider.key.configured || provider.key.source !== null) && (
                <KeyControl key={provider.id} provider={provider} />
              )}
          </div>

          {model && (
            <>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={use.isPending || isCurrent}
                  data-testid="model-use"
                  onClick={() => use.mutate()}
                >
                  {use.isPending ? m.common.saving : isCurrent ? s.inUse : s.use}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!provider.key.configured || runTest.isPending}
                  title={provider.key.configured ? undefined : s.testNeedsKey}
                  data-testid="model-test"
                  onClick={() => runTest.mutate()}
                >
                  {runTest.isPending ? <Loader2 className="animate-spin" /> : <PlugZap />}
                  {runTest.isPending ? s.testing : s.test}
                </Button>
              </div>
              {test && (
                <p
                  role="status"
                  className={`text-xs ${test.ok ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}`}
                  data-testid="model-test-result"
                >
                  {test.ok
                    ? t(s.testOk, { seconds: (test.latencyMs / 1000).toFixed(1) })
                    : test.timedOut
                      ? s.testTimeout
                      : t(s.testFailed, { reason: test.error ?? "" })}
                </p>
              )}
              {(use.error || runTest.error) && (
                <p role="alert" className="text-xs text-destructive">
                  {errorOf(use.error ?? runTest.error)}
                </p>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            data-testid="local-models-open"
            onClick={() => setLocalOpen(true)}
            className="flex w-full items-center gap-3 rounded-md border bg-muted/40 p-3 text-left transition-colors hover:bg-muted"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-background shadow-xs">
              <Server className="size-4 text-muted-foreground" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{s.localTitle}</span>
              <span className="block text-xs text-muted-foreground">{s.localHint}</span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          </button>
          <p className="text-sm text-muted-foreground">{s.chooseProvider}</p>
          {providers.length === 0 ? (
            <p className="text-sm text-muted-foreground">{s.none}</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {providers.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  data-testid={`model-provider-${p.id}`}
                  aria-current={selected?.provider === p.id ? "true" : undefined}
                  onClick={() => openProvider(p)}
                  className={`flex items-center gap-3 rounded-md border p-3 text-left transition-colors ${
                    selected?.provider === p.id ? "bg-accent/60 ring-1 ring-ring/20" : "bg-muted/40 hover:bg-muted"
                  }`}
                >
                  <ProviderLogo providerId={p.id} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{p.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t(s.providerModels, { count: p.models.length })}
                    </span>
                  </span>
                  {(p.auth.configured || p.key.configured) && (
                    <span
                      role="img"
                      className="size-2 shrink-0 rounded-full bg-emerald-500"
                      aria-label={s.keyConfigured}
                      title={s.keyConfigured}
                    />
                  )}
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** The provider's key: saved here (last four shown), from the environment, or a field to enter one. */
function KeyControl({ provider }: { provider: ProviderInfo }) {
  const { m, t, errorOf } = useI18n();
  const s = m.settings.model;
  const queryClient = useQueryClient();
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState(false);
  const done = () => {
    setValue("");
    setEditing(false);
    void queryClient.invalidateQueries({ queryKey: keys.models });
  };
  const save = useMutation({ mutationFn: () => api.setProviderKey(provider.id, value.trim()), onSuccess: done });
  const remove = useMutation({ mutationFn: () => api.removeProviderKey(provider.id), onSuccess: done });
  const { key } = provider;
  const error = save.error ?? remove.error;

  let status: string;
  if (!key.configured) status = s.keyMissing;
  else if (key.source === "stored") status = t(s.keyStored, { last4: key.last4 ?? "····" });
  else if (key.source === "environment") status = t(s.keyEnv, { name: key.label ?? "" });
  else status = s.keyOther;

  const showField = provider.keyEditable && key.source !== "environment" && (!key.configured || editing);
  return (
    <SettingsRow
      label={t(s.keyLabel, { provider: provider.name })}
      description={
        <span className="flex flex-col gap-1">
          <span data-testid="model-key-status">{status}</span>
          {showField && <span>{s.keyHint}</span>}
          {!provider.keyEditable && !key.configured && provider.envKey && <span>{s.keyNotEditable}</span>}
        </span>
      }
    >
      {key.source === "stored" && !editing && (
        <>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            onClick={() => setEditing(true)}
            data-testid="model-key-change"
          >
            {s.keyChange}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
            data-testid="model-key-remove"
          >
            {s.keyRemove}
          </Button>
        </>
      )}
      {showField && (
        <div className="flex gap-2">
          <Input
            type="password"
            // Not "off": browsers ignore that for password fields and offer to save the key.
            autoComplete="one-time-code"
            spellCheck={false}
            className="md:w-64"
            aria-label={t(s.keyLabel, { provider: provider.name })}
            placeholder={t(s.keyLabel, { provider: provider.name })}
            value={value}
            data-testid="model-key-input"
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                // Save the key, not a surrounding form.
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
            data-testid="model-key-save"
          >
            {save.isPending ? m.common.saving : s.keySave}
          </Button>
          {editing && (
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              {m.common.cancel}
            </Button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {errorOf(error)}
        </p>
      )}
    </SettingsRow>
  );
}
