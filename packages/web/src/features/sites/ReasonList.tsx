import type { SiteReason } from "@bukitjalil/shared";
import { useI18n } from "@/i18n";

/** Why a site is read-only (plan 5.1), each reason with where it was found. */
export function ReasonList({ reasons }: { reasons: SiteReason[] }) {
  const { m } = useI18n();
  return (
    <ul className="mt-1 list-disc pl-5 text-sm" data-testid="reasons">
      {reasons.map((r, i) => (
        // Reasons have no id; the same code can repeat for different places.
        // biome-ignore lint/suspicious/noArrayIndexKey: a static list
        <li key={i}>
          {m.reasons[r.code]}
          {r.where && <code className="ml-1 text-xs text-muted-foreground">{r.where}</code>}
          {r.detail && <span className="ml-1 text-xs text-muted-foreground">({r.detail})</span>}
        </li>
      ))}
    </ul>
  );
}
