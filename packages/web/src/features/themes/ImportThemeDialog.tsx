import type { Theme, ThemeImportInspection } from "@bukitjalil/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileArchive, FolderOpen, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { DirPicker, joinPath } from "@/features/sites/DirPicker";
import { IdentityFields, useIdentity } from "@/features/sites/identity";
import { folderFromName, LANGUAGES } from "@/features/sites/NewSiteDialog";
import { useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";
import { desktopBridge } from "@/lib/desktop";

/**
 * Import a theme folder or zip (theme development design 5): inspect first (nothing is written), pick one of
 * the themes it holds (its extends parents come along), then make a new theme project from the sample site.
 * A folder that is also a Bukit site can go to the site importer instead.
 */
export function ImportThemeDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (theme: Theme) => void }) {
  const { m, t, locale, errorOf } = useI18n();
  const n = m.themes.importDialog;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const settings = useQuery({ queryKey: keys.settings, queryFn: api.settings });
  const identity = useIdentity();
  const [source, setSource] = useState<string | null>(null);
  const [inspected, setInspected] = useState<{ source: string; result: ThemeImportInspection } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [language, setLanguage] = useState({ "zh-CN": "zh-CN", en: "en-US", ms: "ms-MY" }[locale]);
  const [parent, setParent] = useState<string | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const desktop = desktopBridge();
  const inspection = inspected?.result ?? null;
  const themes = inspection?.themes ?? [];
  const chosen = themes.find((x) => x.id === selected) ?? themes.find((x) => x.missingParent === null) ?? null;
  const usable = chosen !== null && chosen.missingParent === null;
  const start = parent ?? settings.data?.lastParentDir ?? null;
  const folderName = folder ?? folderFromName(name, "theme");
  const target = start ? joinPath(start, folderName) : null;

  // A picked theme supplies the project's name; the user can still change it before importing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a different theme resets the name
  useEffect(() => {
    if (chosen) setName(chosen.displayName ?? chosen.name);
  }, [chosen?.id]);

  const inspect = useMutation({
    mutationFn: (path: string) => api.inspectTheme(path),
    onSuccess: (result, path) => {
      setInspected({ source: path, result });
      setSelected(result.themes.find((x) => x.missingParent === null)?.id ?? null);
    },
  });
  const run = useMutation({
    mutationFn: async () => {
      if (!inspection || !chosen || !target) throw new Error("not inspected");
      await identity.save();
      return api.importTheme({
        source: inspection.path,
        theme: chosen.id,
        path: target,
        name: name.trim(),
        language,
      });
    },
    onSuccess: (theme) => {
      void queryClient.invalidateQueries({ queryKey: keys.themes });
      void queryClient.invalidateQueries({ queryKey: keys.settings });
      onCreated(theme);
      onClose();
    },
  });
  const pick = (path: string) => {
    setSource(path);
    setInspected(null);
    inspect.reset();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={m.common.close} className="max-w-xl">
        <DialogTitle className="flex items-center gap-2">
          <Upload className="size-4" /> {n.title}
        </DialogTitle>
        <DialogDescription>{n.description}</DialogDescription>
        <form
          className="flex min-h-0 flex-col gap-4 overflow-y-auto"
          onSubmit={(e) => {
            e.preventDefault();
            run.mutate();
          }}
        >
          <Field label={n.source} htmlFor="theme-import-source" hint={n.sourceHint}>
            <div className="flex items-center gap-2">
              <Input
                id="theme-import-source"
                required
                value={source ?? ""}
                data-testid="theme-import-source"
                onChange={(e) => pick(e.target.value)}
              />
              {desktop && (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      const path = await desktop.pickFolder(source ?? undefined);
                      if (path) pick(path);
                    }}
                  >
                    <FolderOpen /> {m.dirPicker.choose}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      const path = await desktop.pickFile(source ?? undefined);
                      if (path) pick(path);
                    }}
                  >
                    <FileArchive /> {n.chooseZip}
                  </Button>
                </>
              )}
            </div>
          </Field>
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              data-testid="theme-import-inspect"
              disabled={!source || inspect.isPending}
              onClick={() => source && inspect.mutate(source)}
            >
              {inspect.isPending ? n.inspecting : n.inspect}
            </Button>
          </div>
          {inspect.error && (
            <p role="alert" className="text-sm text-destructive">
              {errorOf(inspect.error)}
            </p>
          )}
          {inspection && themes.length === 0 && !inspection.site && (
            <p className="text-sm text-muted-foreground">{n.nothing}</p>
          )}
          {inspection?.site && (
            <div className="flex flex-col gap-2 rounded-md border p-2 text-sm" data-testid="theme-import-site">
              <p className="font-medium">{n.site}</p>
              <p className="text-xs text-muted-foreground">{n.siteHint}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="self-start"
                data-testid="theme-import-as-site"
                onClick={() => {
                  navigate("/", { state: { importPath: inspection.path } });
                  onClose();
                }}
              >
                {n.importAsSite}
              </Button>
            </div>
          )}
          {themes.length > 0 && (
            <fieldset className="flex flex-col gap-1" data-testid="theme-import-candidates">
              <legend className="text-sm font-medium">{n.themes}</legend>
              {themes.map((x) => (
                <label
                  key={x.id}
                  className={`flex items-start gap-2 rounded-md border p-2 text-sm ${x.missingParent ? "opacity-60" : ""}`}
                >
                  <input
                    type="radio"
                    name="theme-candidate"
                    className="mt-1"
                    checked={chosen?.id === x.id}
                    disabled={x.missingParent !== null}
                    data-testid={`theme-candidate-${x.id}`}
                    onChange={() => setSelected(x.id)}
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium">{x.displayName ?? x.name}</span>
                    <code className="text-xs text-muted-foreground">themes/{x.dir}</code>
                    {x.includes.length > 1 && (
                      <span className="text-xs text-muted-foreground">+ {x.includes.slice(0, -1).join(", ")}</span>
                    )}
                    {x.missingParent !== null && (
                      <span className="text-xs text-destructive">
                        {t(n.missingParent, { parent: x.missingParent })}
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          {inspection && themes.length > 0 && (
            <>
              <div className="flex flex-col gap-3 rounded-md border p-2">
                <p className="text-sm font-medium">{n.target}</p>
                <Field label={m.themes.new.name} htmlFor="theme-import-name">
                  <Input
                    id="theme-import-name"
                    required
                    maxLength={200}
                    value={name}
                    data-testid="theme-import-name"
                    onChange={(e) => setName(e.target.value)}
                  />
                </Field>
                <Field label={m.newSite.language} htmlFor="theme-import-language" hint={m.themes.new.languageHint}>
                  <select
                    id="theme-import-language"
                    className="h-9 rounded-md border bg-background px-2 text-sm"
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                  >
                    {LANGUAGES.map((l) => (
                      <option key={l.code} value={l.code}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={m.newSite.parent} htmlFor="theme-import-parent">
                  <DirPicker id="theme-import-parent" value={start} onChange={setParent} />
                </Field>
                <Field
                  label={m.newSite.folder}
                  htmlFor="theme-import-folder"
                  hint={target ? t(m.newSite.folderHint, { path: target }) : undefined}
                >
                  <Input
                    id="theme-import-folder"
                    required
                    pattern="[^/\\]+"
                    value={folderName}
                    onChange={(e) => setFolder(e.target.value)}
                  />
                </Field>
              </div>
              {identity.missing && <IdentityFields draft={identity.draft} onChange={identity.setDraft} />}
              {run.error && (
                <p role="alert" className="text-sm text-destructive">
                  {errorOf(run.error)}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={onClose}>
                  {m.common.cancel}
                </Button>
                <Button
                  type="submit"
                  data-testid="theme-import-confirm"
                  disabled={run.isPending || !usable || !target || !name.trim() || !identity.ready}
                >
                  {run.isPending ? n.importing : n.import}
                </Button>
              </div>
            </>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
