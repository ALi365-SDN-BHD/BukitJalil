import type { ImportInspection, Site } from "@bukitjalil/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";
import { DirPicker } from "./DirPicker";
import { IdentityFields, useIdentity } from "./identity";
import { ReasonList } from "./ReasonList";

/** Import an existing Bukit site (plan 5.1): inspect first (read-only), then import. */
export function ImportDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (site: Site) => void;
}) {
  const { m, t, errorOf } = useI18n();
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: keys.settings, queryFn: api.settings });
  const identity = useIdentity();
  const [dir, setDir] = useState<string | null>(null);
  // The inspection with the folder it was asked for: an answer for a folder the user has since left is
  // ignored, so Import always acts on the folder shown.
  const [inspected, setInspected] = useState<{ dir: string; result: ImportInspection } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [name, setName] = useState("");
  const current = dir ?? settings.data?.lastParentDir ?? null;
  const inspection = inspected && inspected.dir === current ? inspected.result : null;

  const pick = (path: string) => {
    setDir(path);
    setConfirmed(false);
    inspect.reset();
  };

  const inspect = useMutation({
    mutationFn: (path: string) => api.inspectImport(path),
    onSuccess: (result, path) => setInspected({ dir: path, result }),
  });

  const run = useMutation({
    mutationFn: async () => {
      if (!inspection) throw new Error("not inspected");
      const base = { path: inspection.path, ...(name.trim() ? { name: name.trim() } : {}) };
      if (inspection.kind === "git") return api.importSite(base);
      await identity.save();
      return api.importSite({ ...base, initGit: { files: inspection.files } });
    },
    onSuccess: (site) => {
      void queryClient.invalidateQueries({ queryKey: keys.sites });
      void queryClient.invalidateQueries({ queryKey: keys.settings });
      onImported(site);
      onOpenChange(false);
    },
  });

  const canImport =
    inspection !== null && !run.isPending && (inspection.kind === "git" || (confirmed && identity.ready));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={m.common.close} className="max-w-xl">
        <DialogTitle>{m.importSite.title}</DialogTitle>
        <DialogDescription>{m.importSite.description}</DialogDescription>
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
          {open && <DirPicker value={current} onChange={pick} />}
          <Button
            type="button"
            variant="outline"
            disabled={!current || inspect.isPending}
            onClick={() => current && inspect.mutate(current)}
          >
            {inspect.isPending ? m.importSite.inspecting : m.importSite.inspect}
          </Button>
          {inspect.error && (
            <p role="alert" className="text-sm text-destructive">
              {errorOf(inspect.error)}
            </p>
          )}
          {inspection?.kind === "git" && (
            <div className="flex flex-col gap-2 text-sm" data-testid="inspect-result">
              <p>{t(m.importSite.git, { branch: inspection.branch })}</p>
              {inspection.readOnly && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2">
                  <p>{m.importSite.readOnly}</p>
                  <ReasonList reasons={inspection.readOnly} />
                </div>
              )}
            </div>
          )}
          {inspection?.kind === "not_git" && (
            <div className="flex flex-col gap-2 text-sm" data-testid="inspect-result">
              <p>{t(m.importSite.notGit, { count: inspection.files.length })}</p>
              <ul className="max-h-40 overflow-y-auto rounded-md border p-2 font-mono text-xs">
                {inspection.files.map((f) => (
                  <li key={f} className="truncate">
                    {f}
                  </li>
                ))}
              </ul>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                {m.importSite.confirmFiles}
              </label>
              {identity.missing && <IdentityFields draft={identity.draft} onChange={identity.setDraft} />}
            </div>
          )}
          {inspection && (
            <Field label={m.importSite.name} htmlFor="import-name">
              <Input id="import-name" maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
          )}
          {run.error && (
            <p role="alert" className="text-sm text-destructive">
              {errorOf(run.error)}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {m.common.cancel}
          </Button>
          <Button type="button" disabled={!canImport} onClick={() => run.mutate()}>
            {run.isPending ? m.importSite.importing : m.importSite.import}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
