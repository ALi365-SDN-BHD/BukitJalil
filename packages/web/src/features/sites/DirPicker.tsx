import { useQuery } from "@tanstack/react-query";
import { ArrowUp, Folder, FolderOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { api } from "@/lib/api";
import { desktopBridge } from "@/lib/desktop";

/**
 * Directory picker (plan 5.2): lists one level of subfolders through GET /api/fs/dirs. `value` is the
 * folder currently chosen; clicking a subfolder goes into it. In the desktop app (plan M7) the system
 * folder dialog takes the place of the list.
 */
export function DirPicker({
  id,
  value,
  onChange,
}: {
  /** Id of the path field, for a surrounding <label>. */
  id?: string;
  value: string | null;
  onChange: (path: string) => void;
}) {
  const { m, errorOf } = useI18n();
  const [hidden, setHidden] = useState(false);
  const dirs = useQuery({ queryKey: ["dirs", value, hidden], queryFn: () => api.dirs(value, hidden), retry: false });
  const current = dirs.data?.path ?? value;

  // The first answer tells where "no path" (the home directory) is.
  useEffect(() => {
    if (value === null && dirs.data) onChange(dirs.data.path);
  }, [value, dirs.data, onChange]);

  const desktop = desktopBridge();
  if (desktop) {
    return (
      <div className="flex flex-col gap-2" data-testid="dir-picker">
        <div className="flex items-center gap-2">
          <PathInput id={id} current={current} onSubmit={onChange} />
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid="dir-choose"
            onClick={async () => {
              const path = await desktop.pickFolder(current ?? undefined);
              if (path) onChange(path);
            }}
          >
            <FolderOpen /> {m.dirPicker.choose}
          </Button>
        </div>
        {dirs.error && (
          <p className="text-xs text-destructive" role="alert">
            {errorOf(dirs.error)}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border p-2" data-testid="dir-picker">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          aria-label={m.dirPicker.up}
          title={m.dirPicker.up}
          disabled={!dirs.data?.parent}
          onClick={() => dirs.data?.parent && onChange(dirs.data.parent)}
        >
          <ArrowUp />
        </Button>
        <PathInput id={id} current={current} onSubmit={onChange} />
      </div>
      <ul className="h-44 overflow-y-auto text-sm" aria-label={m.dirPicker.label}>
        {dirs.isPending && <li className="p-2 text-muted-foreground">{m.common.loading}</li>}
        {dirs.error && (
          <li className="p-2 text-destructive" role="alert">
            {errorOf(dirs.error)}
          </li>
        )}
        {dirs.data?.dirs.length === 0 && <li className="p-2 text-muted-foreground">{m.dirPicker.empty}</li>}
        {dirs.data?.dirs.map((name) => (
          <li key={name}>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-accent"
              onClick={() => onChange(joinPath(dirs.data.path, name))}
            >
              <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">{name}</span>
            </button>
          </li>
        ))}
      </ul>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
        {m.dirPicker.showHidden}
      </label>
    </div>
  );
}

/** The current folder as text; typing a path and pressing Enter goes there. */
function PathInput({
  id,
  current,
  onSubmit,
}: {
  id?: string;
  current: string | null;
  onSubmit: (path: string) => void;
}) {
  const { m } = useI18n();
  const [text, setText] = useState(current ?? "");
  useEffect(() => setText(current ?? ""), [current]);
  return (
    <input
      id={id}
      aria-label={m.dirPicker.path}
      title={current ?? ""}
      data-testid="dir-current"
      className="min-w-0 flex-1 rounded border bg-background px-2 py-1 font-mono text-xs"
      value={text}
      spellCheck={false}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        // Inside a form, Enter would submit it.
        e.preventDefault();
        const path = text.trim();
        if (path.startsWith("/") && path !== current) onSubmit(path);
      }}
      onBlur={() => setText(current ?? "")}
    />
  );
}

export const joinPath = (dir: string, name: string) => (dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`);
