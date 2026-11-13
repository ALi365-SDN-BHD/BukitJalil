import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";

/**
 * How tokens and model keys are kept (plan 6.7), above every settings section. Nothing is shown when they
 * are encrypted and no plain file is left.
 */
export function SecretsNotice() {
  const { m, errorOf } = useI18n();
  const s = m.secrets;
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: keys.secrets, queryFn: api.secrets });
  const [confirming, setConfirming] = useState(false);
  const reset = useMutation({
    mutationFn: api.resetSecrets,
    onSuccess: (data) => {
      setConfirming(false);
      queryClient.setQueryData(keys.secrets, data);
    },
  });
  const data = status.data;
  if (!data || (data.mode === "encrypted" && !data.plainFiles)) return null;

  if (data.mode === "plain") {
    return (
      <p className="rounded-md border px-3 py-2 text-xs text-muted-foreground" data-testid="secrets-notice">
        {s.plain}
      </p>
    );
  }
  if (data.mode === "encrypted") {
    return (
      <p role="alert" className="rounded-md border border-amber-500/40 px-3 py-2 text-sm" data-testid="secrets-notice">
        {s.plainLeft}
      </p>
    );
  }
  return (
    <div
      role="alert"
      className="flex flex-col gap-2 rounded-md border border-destructive/40 px-3 py-2 text-sm"
      data-testid="secrets-notice"
    >
      <p>{s.unavailable[data.reason ?? "locked"]}</p>
      {data.plainFiles && data.reason !== "reset" && <p className="text-muted-foreground">{s.plainUsed}</p>}
      {/* Only a key that cannot be unlocked is worth resetting; the rest is fixed by starting again. */}
      {data.reason === "locked" && (
        <div className="flex flex-wrap items-center gap-2">
          {confirming ? (
            <>
              <span>{s.resetConfirm}</span>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={reset.isPending}
                onClick={() => reset.mutate()}
                data-testid="secrets-reset-confirm"
              >
                {s.reset}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                {m.common.cancel}
              </Button>
            </>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setConfirming(true)}
              data-testid="secrets-reset"
            >
              {s.reset}
            </Button>
          )}
        </div>
      )}
      {reset.error && <p className="text-destructive">{errorOf(reset.error)}</p>}
    </div>
  );
}
