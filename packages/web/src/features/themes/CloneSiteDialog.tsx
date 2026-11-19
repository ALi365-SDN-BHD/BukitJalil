import { type Theme, ThemeName } from "@bukitjalil/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Globe } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { selectedModelReadsImages } from "@/features/chat/attachments";
import { setComposerDraft, setComposerImages } from "@/features/chat/drafts";
import { DirPicker, joinPath } from "@/features/sites/DirPicker";
import { IdentityFields, useIdentity } from "@/features/sites/identity";
import { folderFromName, LANGUAGES } from "@/features/sites/NewSiteDialog";
import { useI18n } from "@/i18n";
import { api, fileUrl, keys } from "@/lib/api";
import { type CapturePreflight, type CaptureProgress, type CaptureResult, desktopBridge } from "@/lib/desktop";
import { fileToBase64 } from "@/lib/files";
import { themeKey } from "@/lib/project";

/**
 * Clone the user's own site into a theme (theme development design 6): preflight the addresses (same origin,
 * robots.txt, http), capture them in the desktop app, then start a theme project and a conversation that
 * converts `_capture/` into the theme. Desktop only; without the bridge the entry is a note.
 */
export function CloneSiteDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { m, t, locale, errorOf } = useI18n();
  const n = m.themes.clone;
  const desktop = desktopBridge();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: keys.settings, queryFn: api.settings });
  const models = useQuery({ queryKey: keys.models, queryFn: api.models });
  const identity = useIdentity();
  const [homepage, setHomepage] = useState("");
  const [more, setMore] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [images, setImages] = useState(false);
  const [fonts, setFonts] = useState(false);
  const [preflight, setPreflight] = useState<CapturePreflight | null>(null);
  const [captured, setCaptured] = useState<CaptureResult | null>(null);
  const [progress, setProgress] = useState<CaptureProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"check" | "capture" | null>(null);
  const [name, setName] = useState("");
  const [themeName, setThemeName] = useState<string | null>(null);
  const [language, setLanguage] = useState({ "zh-CN": "zh-CN", en: "en-US", ms: "ms-MY" }[locale]);
  const [parent, setParent] = useState<string | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const directory = themeName ?? folderFromName(name, "theme");
  const directoryValid = ThemeName.safeParse(directory).success;
  const start = parent ?? settings.data?.lastParentDir ?? null;
  const target = start ? joinPath(start, folder ?? folderFromName(name, "theme")) : null;
  const urls = [homepage, ...more.split("\n")].map((x) => x.trim()).filter(Boolean);

  useEffect(() => {
    if (!desktop) return;
    return desktop.onCaptureProgress(setProgress);
  }, [desktop]);

  const edit = (fn: () => void) => {
    fn();
    setPreflight(null);
    setCaptured(null);
    setError(null);
  };

  const check = async () => {
    if (!desktop) return;
    setBusy("check");
    setError(null);
    try {
      const result = await desktop.capturePreflight(urls);
      if (!result.ok) setError(result.error);
      else {
        setPreflight(result.result);
        setProgress(null);
        setName(result.result.pages[0]?.url ? new URL(result.result.pages[0].url).hostname : "");
      }
    } finally {
      setBusy(null);
    }
  };

  const capture = async () => {
    if (!desktop) return;
    setBusy("capture");
    setError(null);
    setProgress({ phase: "page", url: urls[0] ?? "", index: 0, total: urls.length });
    try {
      const result = await desktop.startCapture({ urls, images, fonts, authorized });
      if (!result.ok) setError(result.error);
      else {
        setCaptured(result.result);
        setName(result.result.title || new URL(result.result.pages[0]?.url ?? "https://site").hostname);
        setThemeName(null);
        setFolder(null);
      }
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const create = useMutation({
    mutationFn: async () => {
      if (!captured || !target) throw new Error("no capture");
      await identity.save();
      const theme: Theme = await api.createTheme({
        name: name.trim(),
        themeName: directory,
        path: target,
        language,
        origin: "clone",
        captureId: captured.captureId,
        authorized: true,
      });
      const session = await api.createSession(themeKey(theme.id));
      setComposerDraft(session.id, n.draft);
      // Attach the home screenshot when the model reads images (design 6.3); the AI can also read it.
      if (selectedModelReadsImages(models.data) === true) {
        const shot = await fetch(fileUrl(themeKey(theme.id), "main", "_reference/capture-1-1280.png", "raw"));
        if (shot.ok) {
          const data = await fileToBase64(new File([await shot.blob()], "capture-1-1280.png", { type: "image/png" }));
          setComposerImages(session.id, [{ id: Date.now(), name: "capture-1-1280.png", mimeType: "image/png", data }]);
        }
      }
      void queryClient.invalidateQueries({ queryKey: keys.themes });
      void queryClient.invalidateQueries({ queryKey: keys.settings });
      navigate(`/themes/${theme.id}/sessions/${session.id}`);
      onCreated();
      onClose();
    },
  });

  const note = (text: string) => (
    <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs">{text}</p>
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={m.common.close} className="max-w-xl" data-testid="clone-site-dialog">
        <DialogTitle className="flex items-center gap-2">
          <Globe className="size-4" /> {n.title}
        </DialogTitle>
        <DialogDescription>{n.description}</DialogDescription>
        <form
          className="flex min-h-0 flex-col gap-4 overflow-y-auto"
          onSubmit={(e) => {
            e.preventDefault();
            if (captured) create.mutate();
            else if (preflight) void capture();
            else void check();
          }}
        >
          {!captured && (
            <>
              <Field label={n.homepage} htmlFor="clone-homepage">
                <Input
                  id="clone-homepage"
                  required
                  inputMode="url"
                  placeholder="https://example.com/"
                  value={homepage}
                  data-testid="clone-homepage"
                  onChange={(e) => edit(() => setHomepage(e.target.value))}
                />
              </Field>
              <Field label={n.morePages} htmlFor="clone-pages" hint={n.morePagesHint}>
                <textarea
                  id="clone-pages"
                  className="min-h-20 w-full resize-y rounded-md border bg-background px-3 py-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  value={more}
                  data-testid="clone-pages"
                  onChange={(e) => edit(() => setMore(e.target.value))}
                />
              </Field>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={authorized}
                  data-testid="clone-authorized"
                  onChange={(e) => setAuthorized(e.target.checked)}
                />
                <span>{n.authorized}</span>
              </label>
              <p className="text-xs text-muted-foreground">{n.copyright}</p>
              <fieldset className="flex flex-wrap items-center gap-3 text-sm">
                <legend className="text-sm font-medium">{n.options}</legend>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={images} onChange={(e) => setImages(e.target.checked)} />
                  {n.images}
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={fonts} onChange={(e) => setFonts(e.target.checked)} />
                  {n.fonts}
                </label>
              </fieldset>
              <p className="text-xs text-muted-foreground">{n.optionsHint}</p>
              {preflight && (
                <div className="flex flex-col gap-2" data-testid="clone-preflight">
                  {preflight.http && note(n.http)}
                  {preflight.pages.some((p) => !p.robotsAllowed) && (
                    <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs">
                      <p>{n.robots}</p>
                      <ul className="ml-4 list-disc font-mono">
                        {preflight.pages
                          .filter((p) => !p.robotsAllowed)
                          .map((p) => (
                            <li key={p.url}>{p.url}</li>
                          ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
              {progress && (
                <p className="text-xs text-muted-foreground" data-testid="clone-progress">
                  {n.capturing} {t(n.progress, { index: progress.index + 1, total: progress.total })}
                </p>
              )}
              {error && (
                <p role="alert" className="text-sm text-destructive" data-testid="clone-error">
                  {n.failed}: {error}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={onClose}>
                  {m.common.cancel}
                </Button>
                {!preflight ? (
                  <Button
                    type="submit"
                    variant="outline"
                    data-testid="clone-check"
                    disabled={busy !== null || urls.length === 0 || !authorized}
                  >
                    {busy === "check" ? n.checking : n.check}
                  </Button>
                ) : (
                  <Button type="submit" data-testid="clone-start" disabled={busy !== null || !authorized}>
                    <Download /> {busy === "capture" ? n.capturing : n.start}
                  </Button>
                )}
              </div>
            </>
          )}
          {captured && (
            <>
              <p className="text-sm" data-testid="clone-result">
                {t(n.result, { pages: captured.pages.length, files: captured.files })}
              </p>
              <Field label={m.themes.new.name} htmlFor="clone-name">
                <Input
                  id="clone-name"
                  required
                  maxLength={200}
                  value={name}
                  data-testid="clone-name"
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <Field label={m.themes.new.themeName} htmlFor="clone-theme-name" hint={m.themes.new.themeNameHint}>
                <Input
                  id="clone-theme-name"
                  required
                  maxLength={64}
                  value={directory}
                  aria-invalid={!directoryValid}
                  data-testid="clone-theme-name"
                  onChange={(e) => setThemeName(e.target.value)}
                />
              </Field>
              <Field label={m.newSite.language} htmlFor="clone-language" hint={m.themes.new.languageHint}>
                <select
                  id="clone-language"
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
              <Field label={m.newSite.parent} htmlFor="clone-parent">
                <DirPicker id="clone-parent" value={start} onChange={setParent} />
              </Field>
              <Field
                label={m.newSite.folder}
                htmlFor="clone-folder"
                hint={target ? t(m.newSite.folderHint, { path: target }) : undefined}
              >
                <Input
                  id="clone-folder"
                  required
                  pattern="[^/\\]+"
                  value={folder ?? folderFromName(name, "theme")}
                  onChange={(e) => setFolder(e.target.value)}
                />
              </Field>
              {identity.missing && <IdentityFields draft={identity.draft} onChange={identity.setDraft} />}
              {create.error && (
                <p role="alert" className="text-sm text-destructive">
                  {errorOf(create.error)}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={onClose}>
                  {m.common.cancel}
                </Button>
                <Button
                  type="submit"
                  data-testid="clone-create"
                  disabled={create.isPending || !target || !name.trim() || !directoryValid || !identity.ready}
                >
                  {create.isPending ? n.creating : n.create}
                </Button>
              </div>
            </>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
