import type { NotionDatabaseUse, Site } from "@bukitjalil/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { setComposerDraft } from "@/features/chat/drafts";
import { useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";
import { DirPicker, joinPath } from "./DirPicker";
import { IdentityFields, useIdentity } from "./identity";

const LANGUAGES = [
  { code: "zh-CN", label: "简体中文 (zh-CN)" },
  { code: "en-US", label: "English (en-US)" },
  { code: "zh-TW", label: "繁體中文 (zh-TW)" },
  { code: "ms-MY", label: "Bahasa Melayu (ms-MY)" },
  { code: "ja-JP", label: "日本語 (ja-JP)" },
];

/** A folder name from the site name: ASCII letters, digits and dashes, or "site" when nothing is left. */
export function folderFromName(name: string): string {
  const slug = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "site";
}

/** New site from the starter (plan 5.2). */
export function NewSiteDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (site: Site, sessionId?: string) => void;
}) {
  const { m, t, locale, errorOf } = useI18n();
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: keys.settings, queryFn: api.settings });
  const dataSources = useQuery({ queryKey: keys.dataSources, queryFn: api.dataSources });
  const identity = useIdentity();
  const [name, setName] = useState("");
  const [language, setLanguage] = useState(locale === "en" ? "en-US" : "zh-CN");
  const [multilingual, setMultilingual] = useState(false);
  const [parent, setParent] = useState<string | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const [notionId, setNotionId] = useState("");
  const [notionPicks, setNotionPicks] = useState<Record<string, NotionDatabaseUse>>({});
  const folderName = folder ?? folderFromName(name);
  const start = parent ?? settings.data?.lastParentDir ?? null;
  const target = start ? joinPath(start, folderName) : null;

  const notionSources = dataSources.data ?? [];
  const databases = useQuery({
    queryKey: ["notion-databases", notionId],
    queryFn: () => api.notionDatabases(notionId),
    enabled: notionId !== "",
    // A missing token or offline mode will not fix itself by retrying inside the picker.
    retry: false,
  });

  // Drop checked databases that disappeared from the list (or when the source changes).
  useEffect(() => {
    if (!notionId) {
      setNotionPicks({});
      return;
    }
    const list = databases.data?.databases;
    if (!list) return;
    setNotionPicks((picks) => {
      const next = Object.fromEntries(Object.entries(picks).filter(([id]) => list.some((db) => db.id === id)));
      return Object.keys(next).length === Object.keys(picks).length ? picks : next;
    });
  }, [notionId, databases.data]);

  const pickedDatabases = (databases.data?.databases ?? []).flatMap((database) => {
    const use = notionPicks[database.id];
    return use ? [{ databaseId: database.id, title: database.title, use }] : [];
  });
  const notionReady = notionId === "" || (pickedDatabases.length > 0 && !databases.isPending && !databases.error);

  const create = useMutation({
    mutationFn: async () => {
      if (!target) throw new Error("no folder");
      await identity.save();
      const site = await api.createSite({
        name: name.trim(),
        path: target,
        language,
        ...(notionId ? { dataSourceIds: [notionId], notionDatabases: pickedDatabases } : {}),
      });
      if (!multilingual) return { site };
      const session = await api.createSession(site.id);
      const draft = t(m.newSite.multilingualDraft, { language });
      if (settings.data?.model) {
        try {
          await api.sendMessage(session.id, { text: draft, mode: "prompt" });
        } catch {
          // No usable model after all: leave the prompt in the composer instead of losing it.
          setComposerDraft(session.id, draft);
        }
      } else {
        setComposerDraft(session.id, draft);
      }
      void queryClient.invalidateQueries({ queryKey: keys.sessions(site.id) });
      return { site, sessionId: session.id };
    },
    onSuccess: ({ site, sessionId }) => {
      void queryClient.invalidateQueries({ queryKey: keys.sites });
      void queryClient.invalidateQueries({ queryKey: keys.settings });
      onCreated(site, sessionId);
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={m.common.close} className="max-w-xl">
        <DialogTitle>{m.newSite.title}</DialogTitle>
        <DialogDescription>{m.newSite.description}</DialogDescription>
        <form
          className="flex min-h-0 flex-col gap-4 overflow-y-auto"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Field label={m.newSite.name} htmlFor="site-name">
            <Input id="site-name" required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={m.newSite.language} htmlFor="site-language" hint={m.newSite.languageHint}>
            <div className="flex flex-wrap items-center gap-4">
              <select
                id="site-language"
                className="h-9 min-w-40 flex-1 rounded-md border bg-background px-2 text-sm"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
              >
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
              <label className="flex shrink-0 items-center gap-2 whitespace-nowrap text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-foreground"
                  checked={multilingual}
                  onChange={(e) => setMultilingual(e.target.checked)}
                  data-testid="new-site-multilingual"
                />
                {m.newSite.multilingual}
              </label>
            </div>
            {multilingual && (
              <p className="mt-1 text-xs text-muted-foreground" data-testid="new-site-multilingual-hint">
                {m.newSite.multilingualHint}
              </p>
            )}
          </Field>
          <Field label={m.newSite.parent} htmlFor="site-parent">
            {open && <DirPicker id="site-parent" value={start} onChange={setParent} />}
          </Field>
          <Field
            label={m.newSite.folder}
            htmlFor="site-folder"
            hint={target ? t(m.newSite.folderHint, { path: target }) : undefined}
          >
            <Input
              id="site-folder"
              required
              pattern="[^\/\\]+"
              value={folderName}
              onChange={(e) => setFolder(e.target.value)}
            />
          </Field>

          <div className="flex flex-col gap-2" data-testid="new-site-data-sources">
            <div>
              <p className="text-sm font-medium">{m.newSite.dataSources}</p>
              <p className="text-xs text-muted-foreground">{m.newSite.dataSourcesHint}</p>
            </div>
            {dataSources.isPending ? (
              <p className="text-xs text-muted-foreground">{m.common.loading}</p>
            ) : dataSources.error ? (
              <p role="alert" className="text-xs text-destructive">
                {errorOf(dataSources.error)}
              </p>
            ) : notionSources.length === 0 ? (
              <p className="text-xs text-muted-foreground">{m.newSite.noDataSources}</p>
            ) : (
              <>
                <select
                  className="h-9 rounded-md border bg-background px-2 text-sm"
                  value={notionId}
                  onChange={(e) => {
                    setNotionId(e.target.value);
                    setNotionPicks({});
                  }}
                  data-testid="new-site-notion-source"
                >
                  <option value="">{m.newSite.noNotion}</option>
                  {notionSources.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.name}
                    </option>
                  ))}
                </select>
                {notionId && databases.isPending && (
                  <p className="text-xs text-muted-foreground">{m.newSite.notionDatabasesLoading}</p>
                )}
                {notionId && databases.error && (
                  <p role="alert" className="text-xs text-destructive">
                    {errorOf(databases.error)}
                  </p>
                )}
                {notionId && databases.data && databases.data.databases.length === 0 && (
                  <p className="text-xs text-muted-foreground">{m.newSite.notionDatabasesEmpty}</p>
                )}
                {notionId && databases.data && databases.data.databases.length > 0 && (
                  <div
                    className="max-h-56 divide-y overflow-auto rounded-md border"
                    data-testid="new-site-notion-databases"
                  >
                    {databases.data.databases.map((database) => {
                      const use = notionPicks[database.id];
                      return (
                        <div key={database.id} className="flex items-center gap-2 px-2 py-1.5">
                          <input
                            type="checkbox"
                            className="size-4 shrink-0 accent-foreground"
                            checked={!!use}
                            aria-label={database.title}
                            onChange={(e) =>
                              setNotionPicks((picks) => {
                                const next = { ...picks };
                                if (e.target.checked) next[database.id] = "post";
                                else delete next[database.id];
                                return next;
                              })
                            }
                            data-testid={`new-site-notion-db-${database.id}`}
                          />
                          <span className="min-w-0 flex-1 truncate text-sm">{database.title}</span>
                          {use && (
                            <select
                              className="h-7 shrink-0 rounded-md border bg-background px-1 text-xs"
                              value={use}
                              onChange={(e) =>
                                setNotionPicks((picks) => ({
                                  ...picks,
                                  [database.id]: e.target.value as NotionDatabaseUse,
                                }))
                              }
                              aria-label={m.newSite.notionUse}
                              data-testid={`new-site-notion-use-${database.id}`}
                            >
                              <option value="post">{m.newSite.notionUsePost}</option>
                              <option value="page">{m.newSite.notionUsePage}</option>
                              <option value="data">{m.newSite.notionUseData}</option>
                            </select>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>

          {identity.missing && <IdentityFields draft={identity.draft} onChange={identity.setDraft} />}
          {create.error && (
            <p role="alert" className="text-sm text-destructive">
              {errorOf(create.error)}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {m.common.cancel}
            </Button>
            <Button
              type="submit"
              data-testid="new-site-create"
              disabled={create.isPending || !target || !name.trim() || !identity.ready || !notionReady}
            >
              {create.isPending ? m.newSite.creating : m.newSite.create}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
