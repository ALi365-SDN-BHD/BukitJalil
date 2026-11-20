import { type Locale, PIN_PATTERN, type SecurityStatus, SUPPORTED_LOCALES } from "@bukitjalil/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LockKeyhole } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
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
  useActivity(status.data?.mode === "pin" && !status.data.locked && status.data.idleMinutes !== null);
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

/** Well under the shortest idle time (1 minute), so a check between two touches never finds active use idle. */
const TOUCH_EVERY_MS = 15_000;

/**
 * While idle locking is on, tell the server the app is in use (plan 6.9): keys, clicks, scrolling and
 * touches, at most every 15 seconds. Background requests do not count, so an open but unused window locks.
 */
function useActivity(enabled: boolean): void {
  const last = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    const onActivity = () => {
      const now = Date.now();
      if (now - last.current < TOUCH_EVERY_MS) return;
      last.current = now;
      // A failure (locked meanwhile, server gone) shows up through the other requests.
      api.touch().catch(() => {});
    };
    const events = ["keydown", "pointerdown", "wheel", "touchstart"] as const;
    for (const type of events) window.addEventListener(type, onActivity, { passive: true });
    return () => {
      for (const type of events) window.removeEventListener(type, onActivity);
    };
  }, [enabled]);
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

/** The lock screen: set up or enter the PIN; a forgotten PIN or an old plain database leads to the reset. */
function LockScreen({ status }: { status: SecurityStatus }) {
  const [forgot, setForgot] = useState(false);
  if (status.legacy || forgot) {
    return <ResetScreen legacy={status.legacy} onCancel={status.legacy ? undefined : () => setForgot(false)} />;
  }
  return <PinScreen status={status} onForgot={() => setForgot(true)} />;
}

/** The centred card every lock screen state is shown in. */
function LockCard({
  title,
  hint,
  onSubmit,
  children,
}: {
  title: string;
  hint: string;
  onSubmit?: (event: FormEvent) => void;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <main className="flex h-dvh items-center justify-center bg-muted/30 p-4 text-foreground" data-testid="lock-screen">
      <form
        onSubmit={onSubmit ?? ((event) => event.preventDefault())}
        className="flex w-full max-w-sm flex-col gap-4 rounded-xl border bg-background p-6 shadow-lg"
        aria-labelledby={titleId}
      >
        <div className="flex flex-col items-center gap-2 text-center">
          <LockKeyhole className="size-8 text-muted-foreground" aria-hidden />
          <h1 id={titleId} className="text-lg font-semibold">
            {title}
          </h1>
          <p className="text-sm text-muted-foreground">{hint}</p>
        </div>
        {children}
      </form>
    </main>
  );
}

function PinScreen({ status, onForgot }: { status: SecurityStatus; onForgot: () => void }) {
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
    <LockCard
      title={setup ? m.lock.setupTitle : m.lock.lockedTitle}
      hint={setup ? m.lock.setupHint : m.lock.lockedHint}
      onSubmit={onSubmit}
    >
      <PinField id={pinId} label={m.lock.pin} value={pin} onChange={setPin} autoFocus testId="pin" />
      {setup && (
        <PinField id={confirmId} label={m.lock.confirmPin} value={confirm} onChange={setConfirm} testId="pin-confirm" />
      )}
      {(error ?? apiError) && (
        <p role="alert" className="text-sm text-destructive" data-testid="lock-error">
          {error ?? apiError}
        </p>
      )}
      <Button type="submit" disabled={!valid || waiting > 0 || submit.isPending} data-testid="lock-submit">
        {submit.isPending ? m.lock.working : setup ? m.lock.setup : m.lock.unlock}
      </Button>
      {/* Also during the wait after wrong PINs: the reset is the way out when the PIN is gone. */}
      {!setup && (
        <Button type="button" variant="link" size="sm" onClick={onForgot} data-testid="lock-forgot">
          {m.lock.forgot}
        </Button>
      )}
    </LockCard>
  );
}

/**
 * Reset after a forgotten PIN, or for a plain database from an earlier version (plan 6.9): says what is
 * deleted and that it cannot be undone. The desktop app restarts the server and opens the app again.
 */
function ResetScreen({ legacy, onCancel }: { legacy: boolean; onCancel?: () => void }) {
  const { m, errorOf } = useI18n();
  const reset = useMutation({ mutationFn: api.resetApp });
  return (
    <LockCard
      title={legacy ? m.lock.legacyTitle : m.lock.resetTitle}
      hint={legacy ? m.lock.legacyHint : m.lock.resetHint}
    >
      {legacy && <p className="text-sm text-muted-foreground">{m.lock.resetHint}</p>}
      {reset.isSuccess ? (
        <p role="status" className="text-sm text-muted-foreground" data-testid="lock-resetting">
          {m.lock.resetting}
        </p>
      ) : (
        <>
          {reset.error && (
            <p role="alert" className="text-sm text-destructive" data-testid="lock-error">
              {errorOf(reset.error)}
            </p>
          )}
          <Button
            type="button"
            variant="destructive"
            disabled={reset.isPending}
            onClick={() => reset.mutate()}
            data-testid="lock-reset"
          >
            {m.lock.resetConfirm}
          </Button>
          {onCancel && (
            <Button type="button" variant="ghost" onClick={onCancel} data-testid="lock-reset-cancel">
              {m.lock.resetCancel}
            </Button>
          )}
        </>
      )}
    </LockCard>
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
