import type { Site } from "@bukitjalil/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
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
  onCreated: (site: Site) => void;
}) {
  const { m, t, locale, errorOf } = useI18n();
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: keys.settings, queryFn: api.settings });
  const identity = useIdentity();
  const [name, setName] = useState("");
  const [language, setLanguage] = useState(locale === "en" ? "en-US" : "zh-CN");
  const [parent, setParent] = useState<string | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const folderName = folder ?? folderFromName(name);
  const start = parent ?? settings.data?.lastParentDir ?? null;
  const target = start ? joinPath(start, folderName) : null;

  const create = useMutation({
    mutationFn: async () => {
      if (!target) throw new Error("no folder");
      await identity.save();
      return api.createSite({ name: name.trim(), path: target, language });
    },
    onSuccess: (site) => {
      void queryClient.invalidateQueries({ queryKey: keys.sites });
      void queryClient.invalidateQueries({ queryKey: keys.settings });
      onCreated(site);
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
          <div className="grid grid-cols-[2fr_1fr] gap-3">
            <Field label={m.newSite.name} htmlFor="site-name">
              <Input id="site-name" required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label={m.newSite.language} htmlFor="site-language">
              <select
                id="site-language"
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
          </div>
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
              disabled={create.isPending || !target || !name.trim() || !identity.ready}
            >
              {create.isPending ? m.newSite.creating : m.newSite.create}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
