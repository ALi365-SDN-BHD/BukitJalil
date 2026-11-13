import { type Appearance, type Locale, SUPPORTED_LOCALES } from "@bukitjalil/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Keyboard, Monitor, Moon, Sun } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { localeNames, useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";
import { setAppearance } from "@/lib/theme";
import { SettingsRow, SettingsSection, settingsSelectClass } from "./SettingsLayout";
import { ShortcutsDialog } from "./ShortcutsDialog";

const APPEARANCES = [
  { value: "system", Icon: Monitor },
  { value: "light", Icon: Sun },
  { value: "dark", Icon: Moon },
] as const;

/** Language and appearance (plan 10.1, M5 layer 3); both save as soon as they change. */
export function GeneralSection() {
  const { m, t, locale, errorOf } = useI18n();
  const queryClient = useQueryClient();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const settings = useQuery({ queryKey: keys.settings, queryFn: api.settings, retry: false });
  const save = useMutation({
    mutationFn: api.updateSettings,
    onSuccess: (data) => queryClient.setQueryData(keys.settings, data),
  });

  if (settings.isPending) return <p className="text-sm text-muted-foreground">{m.common.loading}</p>;
  if (settings.error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {errorOf(settings.error)}
      </p>
    );
  if (!settings.data) return null;

  const data = settings.data;
  const changeAppearance = (next: Appearance) => {
    setAppearance(next);
    // Painted at once; a failed save puts the saved choice back, as the control shows it.
    save.mutate({ appearance: next }, { onError: () => setAppearance(data.appearance) });
  };

  return (
    <div className="flex flex-col gap-3">
      <SettingsSection title={m.settings.sections.general}>
        <SettingsRow label={m.settings.language}>
          <select
            id="locale"
            data-testid="locale-select"
            className={settingsSelectClass}
            value={data.locale ?? locale}
            onChange={(e) => save.mutate({ locale: e.target.value as Locale })}
          >
            {SUPPORTED_LOCALES.map((l) => (
              <option key={l} value={l}>
                {localeNames[l]}
              </option>
            ))}
          </select>
        </SettingsRow>
        <SettingsRow label={m.settings.appearance}>
          <fieldset className="m-0 inline-flex min-w-0 items-center rounded-md border bg-muted p-0.5">
            <legend className="sr-only">{m.settings.appearance}</legend>
            {APPEARANCES.map(({ value, Icon }) => (
              <button
                key={value}
                type="button"
                data-testid={`appearance-${value}`}
                aria-label={m.settings.appearances[value]}
                aria-pressed={data.appearance === value}
                title={m.settings.appearances[value]}
                onClick={() => changeAppearance(value)}
                className={`flex size-8 items-center justify-center rounded ${
                  data.appearance === value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="size-4" />
              </button>
            ))}
          </fieldset>
        </SettingsRow>
        <SettingsRow label={m.shortcuts.open}>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setShortcutsOpen(true)}
            data-testid="settings-shortcuts"
          >
            <Keyboard /> {m.shortcuts.view}
          </Button>
        </SettingsRow>
      </SettingsSection>
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      {save.error && (
        <p role="alert" data-testid="save-error" className="text-xs text-destructive">
          {t(m.settings.saveFailed, { reason: errorOf(save.error) })}
        </p>
      )}
    </div>
  );
}
