import { MAX_REFERENCE_IMAGES, type Theme } from "@bukitjalil/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, X } from "lucide-react";
import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/input";
import {
  ATTACH_ACCEPT,
  type Attachment,
  type AttachProblem,
  imageUrl,
  readAttachments,
} from "@/features/chat/attachments";
import { setComposerDraft } from "@/features/chat/drafts";
import { useIdentity } from "@/features/sites/identity";
import { useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";
import { themeKey } from "@/lib/project";
import { ThemeProjectFields, themeTarget } from "./ThemeProjectFields";

/** Open a theme project just created: its first conversation when there is one, else its home. */
export function useOpenCreatedTheme() {
  const navigate = useNavigate();
  return (theme: Theme, sessionId?: string) =>
    navigate(sessionId ? `/themes/${theme.id}/sessions/${sessionId}` : `/themes/${theme.id}`);
}

/**
 * New theme project from a description (theme development design 4): Bukit's starter with the theme renamed
 * and the bundled sample content. The description is put in the first conversation's input, not sent; the
 * reference images go into _reference/ with the first commit.
 */
export function NewThemeDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (theme: Theme, sessionId?: string) => void;
}) {
  const { m, t, locale, errorOf } = useI18n();
  const n = m.themes.new;
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: keys.settings, queryFn: api.settings });
  const identity = useIdentity();
  const [name, setName] = useState("");
  const [themeName, setThemeName] = useState<string | null>(null);
  const [language, setLanguage] = useState({ "zh-CN": "zh-CN", en: "en-US", ms: "ms-MY" }[locale]);
  const [parent, setParent] = useState<string | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [images, setImages] = useState<Attachment[]>([]);
  const [problem, setProblem] = useState<AttachProblem | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const target = themeTarget({ name, themeName, folder, parent, lastParentDir: settings.data?.lastParentDir });

  const addImages = async (files: File[]) => {
    const { added, problem } = await readAttachments(files, images.length);
    setProblem(problem);
    setImages((current) => [...current, ...added].slice(0, MAX_REFERENCE_IMAGES));
  };

  const create = useMutation({
    mutationFn: async () => {
      if (!target.target) throw new Error("no folder");
      await identity.save();
      const theme = await api.createTheme({
        name: name.trim(),
        themeName: target.directory,
        path: target.target,
        language,
        ...(images.length > 0 && { images: images.map(({ mimeType, data }) => ({ mimeType, data })) }),
      });
      const draft = [description.trim(), images.length > 0 ? n.draftImages : ""].filter(Boolean).join("\n\n");
      if (!draft) return { theme };
      // The description waits in the first conversation's input for the user to read and send (design 4).
      const session = await api.createSession(themeKey(theme.id));
      setComposerDraft(session.id, draft);
      void queryClient.invalidateQueries({ queryKey: keys.sessions(themeKey(theme.id)) });
      return { theme, sessionId: session.id };
    },
    onSuccess: ({ theme, sessionId }) => {
      void queryClient.invalidateQueries({ queryKey: keys.themes });
      void queryClient.invalidateQueries({ queryKey: keys.settings });
      onCreated(theme, sessionId);
      onClose();
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={m.common.close} className="max-w-xl">
        <DialogTitle>{n.title}</DialogTitle>
        <DialogDescription>{n.description}</DialogDescription>
        <form
          className="flex min-h-0 flex-col gap-4 overflow-y-auto"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <ThemeProjectFields
            name={name}
            onName={setName}
            themeName={themeName ?? undefined}
            onThemeName={setThemeName}
            language={language}
            onLanguage={setLanguage}
            parent={parent}
            onParent={setParent}
            folder={folder}
            onFolder={setFolder}
            lastParentDir={settings.data?.lastParentDir}
            identity={identity}
          >
            <Field label={n.brief} htmlFor="theme-brief" hint={n.briefHint}>
              <textarea
                id="theme-brief"
                className="min-h-24 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                maxLength={20_000}
                placeholder={n.briefPlaceholder}
                value={description}
                data-testid="new-theme-brief"
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{n.images}</p>
                  <p className="text-xs text-muted-foreground">{n.imagesHint}</p>
                </div>
                <input
                  ref={fileInput}
                  type="file"
                  accept={ATTACH_ACCEPT}
                  multiple
                  hidden
                  data-testid="new-theme-images-input"
                  onChange={(e) => {
                    void addImages(Array.from(e.target.files ?? []));
                    e.target.value = "";
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={images.length >= MAX_REFERENCE_IMAGES}
                  onClick={() => fileInput.current?.click()}
                >
                  <ImagePlus /> {m.chat.attach.short}
                </Button>
              </div>
              {images.length > 0 && (
                <ul className="flex flex-wrap gap-2">
                  {images.map((image) => (
                    <li key={image.id} className="relative" data-testid="new-theme-image">
                      <img
                        src={imageUrl(image) ?? undefined}
                        alt={image.name}
                        className="size-14 rounded border object-cover"
                      />
                      <button
                        type="button"
                        className="absolute -top-1.5 -right-1.5 rounded-full border bg-background p-0.5 text-muted-foreground hover:text-foreground"
                        aria-label={t(m.chat.attach.remove, { name: image.name })}
                        onClick={() => {
                          setImages((current) => current.filter((x) => x.id !== image.id));
                          setProblem(null);
                        }}
                      >
                        <X className="size-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {problem && (
                <p role="alert" className="text-xs text-destructive">
                  {m.chat.attach[problem]}
                </p>
              )}
            </div>
          </ThemeProjectFields>
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
              data-testid="new-theme-create"
              disabled={create.isPending || !target.target || !name.trim() || !target.directoryValid || !identity.ready}
            >
              {create.isPending ? n.creating : n.create}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
