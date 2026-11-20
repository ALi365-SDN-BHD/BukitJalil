import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";
import { useSecurityStatus } from "./LockGate";

/** Lock the app now (plan 6.9); only the desktop app has a PIN. Running work carries on while locked. */
export function LockButton() {
  const { m } = useI18n();
  const queryClient = useQueryClient();
  const status = useSecurityStatus();
  const lock = useMutation({
    mutationFn: api.lock,
    onSuccess: (data) => queryClient.setQueryData(keys.security, data),
  });
  if (status.data?.mode !== "pin") return null;
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      className="shrink-0"
      aria-label={m.lock.lockTitle}
      title={m.lock.lockTitle}
      data-testid="lock-app"
      disabled={lock.isPending}
      onClick={() => lock.mutate()}
    >
      <LockKeyhole className="size-4" />
    </Button>
  );
}
