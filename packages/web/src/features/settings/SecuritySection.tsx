import { PIN_PATTERN } from "@bukitjalil/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { PinField, useSecurityStatus } from "@/features/security/LockGate";
import { useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";
import { SettingsSection } from "./SettingsLayout";

/** The app lock (plan 6.9): changing the PIN encrypts the whole database again. */
export function SecuritySection() {
  const { m, errorOf } = useI18n();
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
  );
}
