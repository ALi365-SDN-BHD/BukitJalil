import { History } from "lucide-react";
import { useI18n } from "@/i18n";
import { shortOid } from "@/lib/format";

/** Marks a change set that restores an earlier version (plan 7.4). */
export function RestoreNote({ commit }: { commit: string }) {
  const { m, t } = useI18n();
  return (
    <p className="flex items-center gap-1.5 text-xs text-sky-700 dark:text-sky-400" data-testid="restore-note">
      <History className="size-3.5" aria-hidden />
      {t(m.history.restoreNote, { commit: shortOid(commit) })}
    </p>
  );
}
