import { IDLE_MINUTES, type IdleMinutes, PIN_PATTERN } from "@bukitjalil/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { PinField, useSecurityStatus } from "@/features/security/LockGate";
import { useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";
import { SettingsRow, SettingsSection, settingsSelectClass } from "./SettingsLayout";

/** The app lock (plan 6.9): changing the PIN encrypts the whole database again; idle locking, off by default. */
export function SecuritySection() {
  const { m, t, errorOf } = useI18n();
  const queryClient = useQueryClient();
  const status = useSecurityStatus();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [mismatch, setMismatch] = useState(false);
  const ids = { current: useId(), next: useId(), confirm: useId() };
  const change = useMutation({
    mutationFn: () => api.changePin(current, next),
    onSuccess: (data) => {
      queryClient.setQueryData(keys.security, data);
      setCurrent("");
      setNext("");
      setConfirm("");
    },
  });
  const idle = useMutation({
    mutationFn: (minutes: IdleMinutes | null) => api.setIdleMinutes(minutes),
    onSuccess: (data) => queryClient.setQueryData(keys.security, data),
  });
  if (!status.data) return null;
  if (status.data.mode === "dev") {
    return (
      <SettingsSection title={m.settings.sections.security}>
        <p className="py-3 text-sm text-muted-foreground" data-testid="security-dev">
          {m.lock.settingsDev}
        </p>
      </SettingsSection>
    );
  }
  const valid = [current, next, confirm].every((pin) => PIN_PATTERN.test(pin));
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setMismatch(next !== confirm);
    if (next === confirm) change.mutate();
  };
  return (
    <div className="flex flex-col gap-8">
      <SettingsSection title={m.settings.sections.security} description={m.lock.settingsIntro} divided={false}>
        <form onSubmit={onSubmit} className="flex max-w-sm flex-col gap-3 py-3" data-testid="change-pin">
          <PinField
            id={ids.current}
            label={m.lock.currentPin}
            value={current}
            onChange={setCurrent}
            testId="pin-current"
          />
          <PinField id={ids.next} label={m.lock.nextPin} value={next} onChange={setNext} testId="pin-next" />
          <PinField
            id={ids.confirm}
            label={m.lock.confirmNextPin}
            value={confirm}
            onChange={setConfirm}
            testId="pin-next-confirm"
          />
          {mismatch && (
            <p role="alert" className="text-sm text-destructive">
              {m.lock.mismatch}
            </p>
          )}
          {change.error && (
            <p role="alert" className="text-sm text-destructive">
              {errorOf(change.error)}
            </p>
          )}
          {change.isSuccess && (
            <p role="status" className="text-sm text-muted-foreground" data-testid="pin-changed">
              {m.lock.changed}
            </p>
          )}
          <Button type="submit" className="self-start" disabled={!valid || change.isPending} data-testid="pin-change">
            {m.lock.change}
          </Button>
        </form>
      </SettingsSection>
      <SettingsSection title={m.lock.idleTitle}>
        <SettingsRow label={m.lock.idleHint}>
          <select
            data-testid="idle-minutes"
            aria-label={m.lock.idleTitle}
            className={settingsSelectClass}
            value={status.data.idleMinutes ?? ""}
            disabled={idle.isPending}
            onChange={(e) => idle.mutate(e.target.value === "" ? null : (Number(e.target.value) as IdleMinutes))}
          >
            <option value="">{m.lock.idleOff}</option>
            {IDLE_MINUTES.map((minutes) => (
              <option key={minutes} value={minutes}>
                {t(m.lock.idleMinutes, { minutes })}
              </option>
            ))}
          </select>
          {idle.error && (
            <p role="alert" className="text-sm text-destructive">
              {errorOf(idle.error)}
            </p>
          )}
        </SettingsRow>
      </SettingsSection>
    </div>
  );
}
