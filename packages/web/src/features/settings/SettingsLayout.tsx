import type { ReactNode } from "react";

export const settingsSelectClass =
  "h-9 w-full rounded-md border bg-background px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:w-56 dark:bg-input/30";

/** A titled group of setting rows, separated by hairlines as in the desktop settings layout. */
export function SettingsSection({
  title,
  description,
  action,
  divided = true,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  /** Hairlines between rows; off when the rows belong to one field group. */
  divided?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{title}</h2>
        {action}
      </div>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      <div className={`mt-2 flex flex-col ${divided ? "divide-y" : ""}`}>{children}</div>
    </section>
  );
}

/** Label and description on the left, the control on the right (stacked on narrow screens). */
export function SettingsRow({
  label,
  description,
  children,
  testId,
}: {
  label: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className="flex flex-col gap-3 py-5 md:flex-row md:items-center md:justify-between md:gap-8"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <div className="text-sm">{label}</div>
        {description && <div className="text-xs text-muted-foreground">{description}</div>}
      </div>
      {children && (
        <div className="flex w-full shrink-0 flex-col items-start gap-2 md:w-auto md:items-end">{children}</div>
      )}
    </div>
  );
}
