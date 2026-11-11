import type { ModelsResponse, ProviderInfo, ProviderTestResult, Settings, ThinkingLevel } from "@bukitjalil/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, PlugZap } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";

/** The levels offered in the UI; Pi clamps them to what the model supports. */
const LEVELS: ThinkingLevel[] = ["off", "low", "medium", "high"];

const selectClass =
  "h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30";

/**
 * Providers that can be used from here, with a key first, then by name. A provider without a key that
 * can neither take one here nor read one from the environment (sign-in only, such as OpenAI Codex) is
 * left out.
 */
function usableProviders(providers: ProviderInfo[]): ProviderInfo[] {
  return providers
    .filter((p) => p.key.configured || p.keyEditable || p.envKey)
    .sort((a, b) => Number(b.key.configured) - Number(a.key.configured) || a.name.localeCompare(b.name));
}

/**
 * Model settings (plan 6.5): the provider and model conversations use, the provider's API key (only its
 * last four characters are ever shown), the thinking level, and a connection test. Everything here saves
 * on its own; the settings form's Save button is not involved.
 */
export function ModelSection() {
  const { m, errorOf } = useI18n();
  const models = useQuery({ queryKey: keys.models, queryFn: api.models });
  if (models.isPending) return <p className="text-sm text-muted-foreground">{m.common.loading}</p>;
  if (models.error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {errorOf(models.error)}
      </p>
    );
  return <ModelForm data={models.data} />;
}

function ModelForm({ data }: { data: ModelsResponse }) {
  const { m, t, errorOf } = useI18n();
  const s = m.settings.model;
  const queryClient = useQueryClient();
  const providers = useMemo(() => usableProviders(data.providers), [data.providers]);
  const initial = data.selected && !data.selectedMissing ? data.selected : null;
  const [providerId, setProviderId] = useState(initial?.provider ?? providers[0]?.id ?? "");
  const provider = providers.find((p) => p.id === providerId) ?? providers[0];
  const [modelId, setModelId] = useState(initial?.id ?? provider?.models[0]?.id ?? "");
  const model = provider?.models.find((x) => x.id === modelId) ?? provider?.models[0];
  const [level, setLevel] = useState<ThinkingLevel>(
    LEVELS.includes(data.thinkingLevel) ? data.thinkingLevel : "medium",
  );
  const [test, setTest] = useState<ProviderTestResult | null>(null);

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

  if (!provider || !model) return <p className="text-sm text-muted-foreground">{s.none}</p>;
  const selected = data.selected;
  const isCurrent =
    !!selected && selected.provider === provider.id && selected.id === model.id && data.thinkingLevel === level;
  const currentProvider = selected ? data.providers.find((p) => p.id === selected.provider) : undefined;
  const currentModel = currentProvider?.models.find((x) => x.id === selected?.id);

  return (
    <section className="flex flex-col gap-3 rounded-md border p-3" data-testid="model-section">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium">{s.title}</h3>
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

      <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-sm">
        <label htmlFor="model-provider">{s.provider}</label>
        <select
          id="model-provider"
          className={selectClass}
          value={provider.id}
          data-testid="model-provider"
          onChange={(e) => {
            const next = providers.find((p) => p.id === e.target.value);
            setProviderId(e.target.value);
            setModelId(next?.models[0]?.id ?? "");
            // A test result belongs to the model it ran on.
            setTest(null);
          }}
        >
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.key.configured ? `${p.name} ✓` : p.name}
            </option>
          ))}
        </select>

        <label htmlFor="model-id">{s.model}</label>
        <select
          id="model-id"
          className={selectClass}
          value={model.id}
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

        {model.reasoning && (
          <>
            <label htmlFor="model-thinking">{s.thinking}</label>
            <select
              id="model-thinking"
              className={selectClass}
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
          </>
        )}
      </div>

      {/* Remounted per provider, so a half-typed key never carries over to another provider. */}
      <KeyControl key={provider.id} provider={provider} />

      <div className="flex flex-wrap items-center gap-2">
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
    </section>
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
    <div className="flex flex-col gap-2 rounded-md bg-muted/40 p-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs" data-testid="model-key-status">
          {status}
        </span>
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
      </div>
      {!provider.keyEditable && !key.configured && provider.envKey && (
        <p className="text-xs text-muted-foreground">{s.keyNotEditable}</p>
      )}
      {showField && (
        <div className="flex gap-2">
          <Input
            type="password"
            // Not "off": browsers ignore that for password fields and offer to save the key.
            autoComplete="one-time-code"
            spellCheck={false}
            aria-label={t(s.keyLabel, { provider: provider.name })}
            placeholder={t(s.keyLabel, { provider: provider.name })}
            value={value}
            data-testid="model-key-input"
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                // Inside the settings form: save the key, not the form.
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
      {showField && <p className="text-xs text-muted-foreground">{s.keyHint}</p>}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {errorOf(error)}
        </p>
      )}
    </div>
  );
}
