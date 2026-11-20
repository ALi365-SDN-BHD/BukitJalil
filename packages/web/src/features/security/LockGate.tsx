import { type Locale, PIN_PATTERN, type SecurityStatus, SUPPORTED_LOCALES } from "@bukitjalil/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LockKeyhole } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { detectLocale, I18nProvider, useI18n } from "@/i18n";
import { ApiRequestError, api, keys, onAppLocked } from "@/lib/api";

const LOCALE_KEY = "bj-locale";

/** The language chosen in the settings, remembered for the lock screen, which cannot read the settings. */
export function rememberLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(LOCALE_KEY, locale);
  } catch {
    // Only a convenience: the lock screen then follows the system language.
  }
}

function lockScreenLocale(): Locale {
  try {
    const saved = window.localStorage.getItem(LOCALE_KEY);
    if (SUPPORTED_LOCALES.includes(saved as Locale)) return saved as Locale;
  } catch {
    // ignore
  }
  return detectLocale(navigator.languages);
}

/** The app lock's state (plan 6.9). */
export function useSecurityStatus() {
  return useQuery({ queryKey: keys.security, queryFn: api.security, retry: false });
}

/**
 * Above the whole app, the event stream included (plan 6.9): while the app is locked or has no PIN yet, only
 * the lock screen is mounted, so nothing else asks the server for data. A failed status request (an expired
 * login, a stopped server) shows the app, which explains it.
 */
export function LockGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  // Looked at again whenever the server answers "locked".
  useEffect(() => onAppLocked(() => void queryClient.invalidateQueries({ queryKey: keys.security })), [queryClient]);
  const status = useSecurityStatus();
  // Only before the first answer: a refetch after an error is pending again, and hiding the app then would
  // unmount and remount it over and over.
  if (status.isPending && !status.isFetched) return null;
  if (status.data?.locked) {
    return (
      <I18nProvider locale={lockScreenLocale()}>
        <LockScreen status={status.data} />
      </I18nProvider>
    );
  }
  return <>{children}</>;
}

/** Seconds left of a wait that ends at `until` (ms), ticking once a second. */
function useCountdown(until: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (until <= Date.now()) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [until]);
  return Math.max(0, Math.ceil((until - now) / 1000));
}

function LockScreen({ status }: { status: SecurityStatus }) {
  const { m, t, errorOf } = useI18n();
  const queryClient = useQueryClient();
  const setup = !status.pinSet;
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [mismatch, setMismatch] = useState(false);
  const [retryUntil, setRetryUntil] = useState(() => Date.now() + status.retryAfterSeconds * 1000);
  const waiting = useCountdown(retryUntil);
  const pinId = useId();
  const confirmId = useId();
  const submit = useMutation({
    mutationFn: () => (setup ? api.setupPin(pin) : api.unlock(pin)),
    onSuccess: (data) => {
      queryClient.setQueryData(keys.security, data);
      // Everything asked for while locked failed; the app below fetches it again.
      void queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] !== keys.security[0] });
    },
    onError: (err) => {
      setPin("");
      setConfirm("");
      if (err instanceof ApiRequestError && err.code === "security.retry_later") {
        setRetryUntil(Date.now() + Number(err.params.seconds ?? 0) * 1000);
      }
    },
  });
  const valid = PIN_PATTERN.test(pin) && (!setup || PIN_PATTERN.test(confirm));
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (setup && pin !== confirm) {
      setMismatch(true);
      return;
    }
    setMismatch(false);
    submit.mutate();
  };
  const error = waiting > 0 ? t(m.lock.retryIn, { seconds: waiting }) : mismatch ? m.lock.mismatch : null;
  const apiError =
    !error && submit.error && !(submit.error instanceof ApiRequestError && submit.error.code === "security.retry_later")
      ? errorOf(submit.error)
      : null;

  return (
    <main className="flex h-dvh items-center justify-center bg-muted/30 p-4 text-foreground" data-testid="lock-screen">
      <form
        onSubmit={onSubmit}
        className="flex w-full max-w-sm flex-col gap-4 rounded-xl border bg-background p-6 shadow-lg"
        aria-labelledby={`${pinId}-title`}
      >
        <div className="flex flex-col items-center gap-2 text-center">
          <LockKeyhole className="size-8 text-muted-foreground" aria-hidden />
          <h1 id={`${pinId}-title`} className="text-lg font-semibold">
            {setup ? m.lock.setupTitle : m.lock.lockedTitle}
          </h1>
          <p className="text-sm text-muted-foreground">{setup ? m.lock.setupHint : m.lock.lockedHint}</p>
        </div>
        <PinField id={pinId} label={m.lock.pin} value={pin} onChange={setPin} autoFocus testId="pin" />
        {setup && (
          <PinField
            id={confirmId}
            label={m.lock.confirmPin}
            value={confirm}
            onChange={setConfirm}
            testId="pin-confirm"
          />
        )}
        {(error ?? apiError) && (
          <p role="alert" className="text-sm text-destructive" data-testid="lock-error">
            {error ?? apiError}
          </p>
        )}
        <Button type="submit" disabled={!valid || waiting > 0 || submit.isPending} data-testid="lock-submit">
          {submit.isPending ? m.lock.working : setup ? m.lock.setup : m.lock.unlock}
        </Button>
      </form>
    </main>
  );
}

/** A 4–8 digit PIN, hidden as it is typed; anything but digits is dropped. */
export function PinField({
  id,
  label,
  value,
  onChange,
  autoFocus,
  testId,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
  testId: string;
}) {
  return (
    <label htmlFor={id} className="flex flex-col gap-1.5 text-sm">
      {label}
      <Input
        id={id}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={8}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 8))}
        data-testid={testId}
      />
    </label>
  );
}
