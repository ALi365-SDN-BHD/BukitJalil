import type { CustomModelProvider, CustomModelRequest } from "@bukitjalil/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Plus, Server } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";
import { SettingsRow, settingsSelectClass } from "./SettingsLayout";

const DEFAULT_PRESET = {
  id: "ollama" as const,
  name: "Ollama",
  baseUrl: "http://127.0.0.1:11434/v1",
};

const PRESETS: { id: "ollama" | "lmstudio" | "vllm" | "llamacpp" | "custom"; name: string; baseUrl: string }[] = [
  DEFAULT_PRESET,
  { id: "lmstudio", name: "LM Studio", baseUrl: "http://127.0.0.1:1234/v1" },
  { id: "vllm", name: "vLLM", baseUrl: "http://127.0.0.1:8000/v1" },
  { id: "llamacpp", name: "llama.cpp", baseUrl: "http://127.0.0.1:8080/v1" },
  { id: "custom", name: "", baseUrl: "" },
];

/** Manage local and self-hosted OpenAI-compatible models (Ollama, LM Studio, vLLM, llama.cpp, ...). */
export function LocalModelsView({ onBack, onSaved }: { onBack: () => void; onSaved: () => void }) {
  const { m, errorOf } = useI18n();
  const s = m.settings.model;
  const queryClient = useQueryClient();
  const models = useQuery({ queryKey: keys.customModels, queryFn: api.customModels });
  const [editing, setEditing] = useState<CustomModelProvider | "new" | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteCustomModel(id),
    onSuccess: () => {
      setConfirming(null);
      void queryClient.invalidateQueries({ queryKey: keys.customModels });
      onSaved();
    },
  });
  const saved = () => {
    setEditing(null);
    void queryClient.invalidateQueries({ queryKey: keys.customModels });
    onSaved();
  };

  if (editing)
    return (
      <LocalModelForm initial={editing === "new" ? null : editing} onCancel={() => setEditing(null)} onSaved={saved} />
    );

  return (
    <div className="flex flex-col gap-4" data-testid="local-models">
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={m.common.back}
          title={m.common.back}
          data-testid="local-back"
          onClick={onBack}
        >
          <ArrowLeft />
        </Button>
        <h2 className="text-base font-semibold">{s.localTitle}</h2>
        <Button type="button" size="sm" className="ml-auto" onClick={() => setEditing("new")} data-testid="local-add">
          <Plus /> {s.localAdd}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{s.localHint}</p>

      {models.isPending ? (
        <p className="text-sm text-muted-foreground">{m.common.loading}</p>
      ) : models.error ? (
        <p role="alert" className="text-sm text-destructive">
          {errorOf(models.error)}
        </p>
      ) : models.data && models.data.length > 0 ? (
        <div className="flex flex-col divide-y rounded-md border" data-testid="local-list">
          {models.data.map((provider) => (
            <div
              key={provider.id}
              className="flex flex-wrap items-center gap-3 p-3"
              data-testid={`local-row-${provider.id}`}
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
                <Server className="size-4 text-muted-foreground" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{provider.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {provider.model.name} · {provider.baseUrl}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {provider.model.id} · {provider.model.contextWindow.toLocaleString()} tokens
                </span>
              </span>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => setEditing(provider)}
                data-testid={`local-edit-${provider.id}`}
              >
                {s.localEdit}
              </Button>
              {confirming === provider.id ? (
                <span className="flex gap-1">
                  <Button
                    type="button"
                    size="xs"
                    variant="destructive"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(provider.id)}
                    data-testid={`local-delete-confirm-${provider.id}`}
                  >
                    {remove.isPending ? <Loader2 className="animate-spin" /> : s.localDeleteConfirm}
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
                  onClick={() => setConfirming(provider.id)}
                  data-testid={`local-delete-${provider.id}`}
                >
                  {s.localDelete}
                </Button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground" data-testid="local-empty">
          {s.localEmpty}
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

function LocalModelForm({
  initial,
  onCancel,
  onSaved,
}: {
  initial: CustomModelProvider | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { m, errorOf } = useI18n();
  const s = m.settings.model;
  const [name, setName] = useState(initial?.name ?? DEFAULT_PRESET.name);
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? DEFAULT_PRESET.baseUrl);
  const [format, setFormat] = useState<CustomModelRequest["api"]>(initial?.api ?? "openai-completions");
  const [modelId, setModelId] = useState(initial?.model.id ?? "");
  const [modelName, setModelName] = useState(initial?.model.name ?? "");
  const [apiKey, setApiKey] = useState("");
  const [contextWindow, setContextWindow] = useState(String(initial?.model.contextWindow ?? 32_768));
  const [maxTokens, setMaxTokens] = useState(String(initial?.model.maxTokens ?? 4_096));
  const [reasoning, setReasoning] = useState(initial?.model.reasoning ?? false);

  const save = useMutation({
    mutationFn: () => {
      const body: CustomModelRequest = {
        name: name.trim(),
        baseUrl: baseUrl.trim(),
        api: format,
        modelId: modelId.trim(),
        modelName: modelName.trim() || modelId.trim(),
        contextWindow: Number(contextWindow) || 32_768,
        maxTokens: Number(maxTokens) || 4_096,
        reasoning,
      };
      if (apiKey.trim()) body.apiKey = apiKey.trim();
      else if (!initial) body.apiKey = "";
      return initial ? api.updateCustomModel(initial.id, body) : api.createCustomModel(body);
    },
    onSuccess: onSaved,
  });

  const applyPreset = (preset: (typeof PRESETS)[number]) => {
    setName(preset.name);
    setBaseUrl(preset.baseUrl);
  };

  return (
    <div className="flex flex-col gap-4" data-testid="local-form">
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={m.common.back}
          title={m.common.back}
          data-testid="local-form-back"
          onClick={onCancel}
        >
          <ArrowLeft />
        </Button>
        <h2 className="text-base font-semibold">{initial ? s.localEdit : s.localAdd}</h2>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">{s.localPreset}</span>
        {PRESETS.map((preset) => (
          <Button
            key={preset.id}
            type="button"
            size="xs"
            variant="outline"
            onClick={() => applyPreset(preset)}
            data-testid={`local-preset-${preset.id}`}
          >
            {s.localPresets[preset.id]}
          </Button>
        ))}
      </div>

      <div className="flex flex-col divide-y">
        <SettingsRow label={s.localName}>
          <Input className="md:w-80" value={name} onChange={(e) => setName(e.target.value)} data-testid="local-name" />
        </SettingsRow>
        <SettingsRow label={s.localBaseUrl} description={s.localBaseUrlHint}>
          <Input
            className="md:w-80"
            value={baseUrl}
            maxLength={2048}
            placeholder={DEFAULT_PRESET.baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            data-testid="local-base-url"
          />
        </SettingsRow>
        <SettingsRow label={s.localApi}>
          <select
            className={settingsSelectClass}
            value={format}
            onChange={(e) => setFormat(e.target.value as CustomModelRequest["api"])}
            data-testid="local-api"
          >
            <option value="openai-completions">{s.localApiCompletions}</option>
            <option value="openai-responses">{s.localApiResponses}</option>
            <option value="anthropic-messages">{s.localApiAnthropic}</option>
          </select>
        </SettingsRow>
        <SettingsRow label={s.localModelId} description={s.localModelIdHint}>
          <Input
            className="md:w-80"
            value={modelId}
            placeholder="llama3.1:8b"
            onChange={(e) => setModelId(e.target.value)}
            data-testid="local-model-id"
          />
        </SettingsRow>
        <SettingsRow label={s.localModelName} description={s.localModelNameHint}>
          <Input
            className="md:w-80"
            value={modelName}
            onChange={(e) => setModelName(e.target.value)}
            data-testid="local-model-name"
          />
        </SettingsRow>
        <SettingsRow label={s.localApiKey} description={initial?.hasApiKey ? s.localApiKeyStored : s.localApiKeyHint}>
          <Input
            type="password"
            autoComplete="off"
            spellCheck={false}
            className="md:w-80"
            value={apiKey}
            placeholder={initial?.hasApiKey ? s.localApiKeyStored : s.localApiKey}
            onChange={(e) => setApiKey(e.target.value)}
            data-testid="local-api-key"
          />
        </SettingsRow>
        <SettingsRow label={s.localContext}>
          <Input
            type="number"
            min={1}
            className="md:w-40"
            value={contextWindow}
            onChange={(e) => setContextWindow(e.target.value)}
            data-testid="local-context"
          />
        </SettingsRow>
        <SettingsRow label={s.localMaxTokens}>
          <Input
            type="number"
            min={1}
            className="md:w-40"
            value={maxTokens}
            onChange={(e) => setMaxTokens(e.target.value)}
            data-testid="local-max-tokens"
          />
        </SettingsRow>
        <SettingsRow label={s.localReasoning}>
          <input
            type="checkbox"
            className="size-4 accent-foreground"
            aria-label={s.localReasoning}
            checked={reasoning}
            onChange={(e) => setReasoning(e.target.checked)}
            data-testid="local-reasoning"
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
          disabled={save.isPending || !name.trim() || !baseUrl.trim() || !modelId.trim()}
          onClick={() => save.mutate()}
          data-testid="local-save"
        >
          {save.isPending ? <Loader2 className="animate-spin" /> : null}
          {s.localSave}
        </Button>
      </div>
    </div>
  );
}
