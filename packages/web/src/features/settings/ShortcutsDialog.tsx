import { useEffect } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/i18n";
import { dialogOpen, isTypingTarget } from "@/lib/keyboard";

/** "?" outside a text field opens the shortcut list (plan M5 layer 3). */
export function useShortcutsKey(open: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?" || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target) || dialogOpen()) return;
      e.preventDefault();
      open();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
}

/** The keyboard shortcuts, as a list. */
export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { m } = useI18n();
  const rows: [string, string][] = [
    ["Enter", m.shortcuts.send],
    ["Shift+Enter", m.shortcuts.newline],
    ["Esc", m.shortcuts.stop],
    ["Alt+1 … Alt+7", m.shortcuts.panels],
    ["?", m.shortcuts.help],
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={m.common.close} data-testid="shortcuts-dialog">
        <DialogTitle>{m.shortcuts.title}</DialogTitle>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
          {rows.map(([keys, what]) => (
            <div key={keys} className="contents">
              <dt>
                <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">{keys}</kbd>
              </dt>
              <dd className="text-muted-foreground">{what}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-muted-foreground">{m.shortcuts.mac}</p>
      </DialogContent>
    </Dialog>
  );
}
