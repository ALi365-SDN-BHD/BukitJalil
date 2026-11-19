import { ThemeName } from "@bukitjalil/shared";
import { Field, Input } from "@/components/ui/input";
import { DirPicker, joinPath } from "@/features/sites/DirPicker";
import { IdentityFields, type useIdentity } from "@/features/sites/identity";
import { folderFromName, LANGUAGES } from "@/features/sites/NewSiteDialog";
import { useI18n } from "@/i18n";

type Identity = ReturnType<typeof useIdentity>;

/** The directory and target a new theme project will get from the shared fields. */
export function themeTarget(input: {
  name: string;
  themeName: string | null;
  folder: string | null;
  parent: string | null;
  lastParentDir?: string | null;
  fallback?: string;
}) {
  const fallback = input.fallback ?? "theme";
  const directory = input.themeName ?? folderFromName(input.name, fallback);
  const folderName = input.folder ?? folderFromName(input.name, fallback);
  const start = input.parent ?? input.lastParentDir ?? null;
  return {
    directory,
    directoryValid: ThemeName.safeParse(directory).success,
    folderName,
    start,
    target: start ? joinPath(start, folderName) : null,
  };
}

/**
 * The project fields the three "new theme" dialogs share (design 2, 4, 5, 6): name, theme directory when
 * the user may choose it, language, parent folder, new folder and commit identity. The dialog keeps its
 * own source fields and computed create request.
 */
export function ThemeProjectFields({
  name,
  onName,
  themeName,
  onThemeName,
  language,
  onLanguage,
  parent,
  onParent,
  folder,
  onFolder,
  lastParentDir,
  identity,
  children,
}: {
  name: string;
  onName: (value: string) => void;
  /** Omit when the theme's directory comes from the source and cannot be changed (import). */
  themeName?: string;
  onThemeName?: (value: string) => void;
  language: string;
  onLanguage: (value: string) => void;
  parent: string | null;
  onParent: (value: string) => void;
  folder: string | null;
  onFolder: (value: string) => void;
  lastParentDir: string | null | undefined;
  identity: Identity;
  /** Description, images or other dialog-specific fields shown after the theme directory. */
  children?: React.ReactNode;
}) {
  const { m, t } = useI18n();
  const n = m.themes.new;
  const target = themeTarget({ name, themeName: themeName ?? null, folder, parent, lastParentDir });
  return (
    <>
      <Field label={n.name} htmlFor="theme-project-name">
        <Input id="theme-project-name" required maxLength={200} value={name} onChange={(e) => onName(e.target.value)} />
      </Field>
      {onThemeName && (
        <Field label={n.themeName} htmlFor="theme-dir-name" hint={n.themeNameHint}>
          <Input
            id="theme-dir-name"
            required
            maxLength={64}
            value={target.directory}
            aria-invalid={!target.directoryValid}
            data-testid="new-theme-dir"
            onChange={(e) => onThemeName(e.target.value)}
          />
        </Field>
      )}
      {children}
      <Field label={m.newSite.language} htmlFor="theme-language" hint={n.languageHint}>
        <select
          id="theme-language"
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={language}
          onChange={(e) => onLanguage(e.target.value)}
        >
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label={m.newSite.parent} htmlFor="theme-parent">
        <DirPicker id="theme-parent" value={target.start} onChange={onParent} />
      </Field>
      <Field
        label={m.newSite.folder}
        htmlFor="theme-folder"
        hint={target.target ? t(m.newSite.folderHint, { path: target.target }) : undefined}
      >
        <Input
          id="theme-folder"
          required
          pattern="[^/\\]+"
          value={target.folderName}
          onChange={(e) => onFolder(e.target.value)}
        />
      </Field>
      {identity.missing && <IdentityFields draft={identity.draft} onChange={identity.setDraft} />}
    </>
  );
}
