import type { FileResponse, PanelRef, TreeEntryView } from "@bukitjalil/shared";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Download, File, FileSymlink, Folder, Package } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { api, fileUrl, keys } from "@/lib/api";
import { formatSize, shortOid } from "@/lib/format";
import { langFor } from "@/lib/highlight";
import { CodeView } from "./CodeView";
import { PanelError, PanelLoading, RefSwitch } from "./common";
import { MarkdownView, splitFrontMatter } from "./MarkdownView";

/** File panel (plan 5.3, 10.2): a lazily loaded tree from git objects and a read-only file view. */
export function FilesPanel({ siteId }: { siteId: string }) {
  const { m } = useI18n();
  const [params, setParams] = useSearchParams();
  const selected = params.get("file");
  const ref: PanelRef = "main";
  const select = (path: string) =>
    setParams(
      (p) => {
        p.set("file", path);
        return p;
      },
      { replace: true },
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <RefSwitch />
      <div className="flex min-h-0 flex-1">
        <nav className="w-56 shrink-0 overflow-auto border-r py-1 text-sm" data-testid="file-tree">
          <TreeLevel siteId={siteId} refName={ref} path="" depth={0} selected={selected} onSelect={select} />
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          {selected ? (
            <FileView key={selected} siteId={siteId} refName={ref} path={selected} />
          ) : (
            <p className="p-6 text-sm text-muted-foreground">{m.files.select}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function TreeLevel(props: {
  siteId: string;
  refName: PanelRef;
  path: string;
  depth: number;
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const { m, errorOf } = useI18n();
  const tree = useQuery({
    queryKey: keys.panel(props.siteId, "tree", props.refName, props.path),
    queryFn: () => api.tree(props.siteId, props.refName, props.path),
  });
  const pad = { paddingLeft: `${props.depth * 12 + 8}px` };
  if (tree.isPending)
    return (
      <p className="py-1 text-muted-foreground" style={pad}>
        {m.common.loading}
      </p>
    );
  if (tree.error)
    return (
      <p className="py-1 text-destructive" style={pad}>
        {errorOf(tree.error)}
      </p>
    );
  if (tree.data.entries.length === 0)
    return (
      <p className="py-1 text-muted-foreground" style={pad}>
        {m.files.emptyDir}
      </p>
    );
  return (
    <ul>
      {tree.data.entries.map((e) => (
        <TreeItem key={e.path} entry={e} {...props} />
      ))}
    </ul>
  );
}

function TreeItem({
  entry,
  ...props
}: {
  entry: TreeEntryView;
  siteId: string;
  refName: PanelRef;
  depth: number;
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  // Folders on the way to the selected file start open.
  const [open, setOpen] = useState(() => !!props.selected?.startsWith(`${entry.path}/`));
  const isDir = entry.kind === "dir";
  const Icon = isDir ? Folder : entry.kind === "symlink" ? FileSymlink : entry.kind === "submodule" ? Package : File;
  const active = props.selected === entry.path;
  return (
    <li>
      <button
        type="button"
        className={`flex w-full items-center gap-1 py-0.5 pr-2 text-left ${active ? "bg-accent font-medium" : "hover:bg-accent/60"}`}
        style={{ paddingLeft: `${props.depth * 12 + 4}px` }}
        aria-expanded={isDir ? open : undefined}
        onClick={() => (isDir ? setOpen(!open) : props.onSelect(entry.path))}
      >
        {isDir ? (
          open ? (
            <ChevronDown className="size-3 shrink-0" />
          ) : (
            <ChevronRight className="size-3 shrink-0" />
          )
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate">{entry.name}</span>
      </button>
      {isDir && open && <TreeLevel {...props} path={entry.path} depth={props.depth + 1} />}
    </li>
  );
}

function FileView({ siteId, refName, path }: { siteId: string; refName: PanelRef; path: string }) {
  const { m, t, locale } = useI18n();
  const file = useQuery({
    queryKey: keys.panel(siteId, "file", refName, path),
    queryFn: () => api.file(siteId, refName, path),
  });
  const [rendered, setRendered] = useState(true);

  const header = (extra?: React.ReactNode) => (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3 text-xs">
      <code className="min-w-0 flex-1 truncate" title={path} data-testid="file-path">
        {path}
      </code>
      {extra}
      {file.data && file.data.kind !== "symlink" && file.data.kind !== "submodule" && (
        <Button asChild size="xs" variant="ghost">
          <a href={fileUrl(siteId, refName, path, "download")} download>
            <Download /> {m.files.download}
          </a>
        </Button>
      )}
    </div>
  );

  if (file.isPending)
    return (
      <>
        {header()}
        <PanelLoading />
      </>
    );
  if (file.error)
    return (
      <>
        {header()}
        <PanelError error={file.error} />
      </>
    );
  const f: FileResponse = file.data;

  if (f.kind === "text") {
    const markdown = langFor(path) === "markdown";
    const { frontMatter, body } = markdown ? splitFrontMatter(f.content) : { frontMatter: null, body: f.content };
    return (
      <>
        {header(
          markdown && (
            <div className="flex rounded-md border p-0.5">
              {[true, false].map((r) => (
                <button
                  key={String(r)}
                  type="button"
                  aria-pressed={rendered === r}
                  className={`rounded px-2 py-0.5 ${rendered === r ? "bg-accent" : "text-muted-foreground"}`}
                  onClick={() => setRendered(r)}
                >
                  {r ? m.files.rendered : m.files.source}
                </button>
              ))}
            </div>
          ),
        )}
        <div className="min-h-0 flex-1 overflow-auto">
          {markdown && rendered ? (
            <>
              {frontMatter !== null && (
                <details className="border-b px-3 py-2 text-xs" open>
                  <summary className="cursor-pointer text-muted-foreground">{m.files.frontMatter}</summary>
                  <CodeView code={frontMatter} lang="yaml" />
                </details>
              )}
              <MarkdownView body={body} />
            </>
          ) : (
            <CodeView code={f.content} lang={langFor(path)} />
          )}
        </div>
      </>
    );
  }

  let note: string;
  if (f.kind === "image") {
    return (
      <>
        {header()}
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-[repeating-conic-gradient(var(--muted)_0_25%,transparent_0_50%)] bg-[length:16px_16px] p-4">
          <img
            src={fileUrl(siteId, refName, path, "raw")}
            alt={path}
            className="max-h-full max-w-full"
            data-testid="file-image"
          />
        </div>
      </>
    );
  }
  if (f.kind === "binary") note = t(m.files.binary, { size: formatSize(f.size, locale) });
  else if (f.kind === "too_large") note = t(m.files.tooLarge, { size: formatSize(f.size, locale) });
  else if (f.kind === "symlink") note = t(m.files.symlink, { target: f.target });
  else note = t(m.files.submodule, { target: shortOid(f.target) });
  return (
    <>
      {header()}
      <p className="p-6 text-sm text-muted-foreground" data-testid="file-note">
        {note}
      </p>
    </>
  );
}
