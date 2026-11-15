import type { MediaUploadResult } from "@bukitjalil/shared";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { forwardRef, type ReactNode, useImperativeHandle, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useSessions } from "@/features/chat/sessions";
import { useI18n } from "@/i18n";
import { ApiRequestError, api, keys } from "@/lib/api";

type ItemStatus = "pending" | "uploading" | "done" | "error" | "skipped";
interface Item {
  key: string;
  file: File;
  status: ItemStatus;
  result?: MediaUploadResult;
  error?: unknown;
}

export interface MediaUploadHandle {
  addFiles(files: FileList | File[]): void;
}

interface Props {
  siteId: string;
  /** A read-only site cannot upload; a running or queued conversation adds its own block. */
  disabled?: boolean;
  disabledReason?: string;
  trigger: ReactNode;
  ariaLabel: string;
  size?: "xs" | "sm" | "icon-sm";
  variant?: "outline" | "ghost";
  onUploaded?: (result: MediaUploadResult, file: File) => void;
}

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = /\.(png|jpe?g|gif|webp|pdf)$/i;

/**
 * One shared uploader for the site home, chat composer and changes panel (design 4.7). A file is sent as
 * JSON/base64, one at a time; a duplicate asks for replace or skip. It never writes the site itself.
 */
export const MediaUpload = forwardRef<MediaUploadHandle, Props>(function MediaUpload(
  { siteId, disabled = false, disabledReason, trigger, ariaLabel, size = "sm", variant = "outline", onUploaded },
  ref,
) {
  const { m, t, errorOf, errorText } = useI18n();
  const queryClient = useQueryClient();
  const sessions = useSessions(siteId);
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef<Item[]>([]);
  const running = useRef(false);
  const nextKey = useRef(0);
  const duplicateResolve = useRef<((action: "replace" | "skip") => void) | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [duplicate, setDuplicate] = useState<{ name: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const busy = sessions.data?.some((s) => s.status !== "idle") ?? false;
  const blocked = disabled || busy;

  const update = (itemKey: string, patch: Partial<Item>) =>
    setItems((list) => list.map((item) => (item.key === itemKey ? { ...item, ...patch } : item)));

  const resolveDuplicate = (action: "replace" | "skip") => {
    const resolve = duplicateResolve.current;
    duplicateResolve.current = null;
    setDuplicate(null);
    resolve?.(action);
  };

  const askReplace = (name: string) =>
    new Promise<"replace" | "skip">((resolve) => {
      duplicateResolve.current = resolve;
      setDuplicate({ name });
    });

  // Returns false when the queue should pause: a site.busy error is not the file's fault, and the rest stay
  // pending until one Retry.
  const send = async (item: Item): Promise<boolean> => {
    update(item.key, { status: "uploading", error: undefined });
    try {
      const data = await fileToBase64(item.file);
      let result: MediaUploadResult;
      try {
        result = await api.uploadMedia(siteId, { name: item.file.name, data });
      } catch (err) {
        if (!(err instanceof ApiRequestError) || err.code !== "media.exists") throw err;
        if ((await askReplace(String(err.params.name ?? item.file.name))) === "skip") {
          update(item.key, { status: "skipped" });
          return true;
        }
        result = await api.uploadMedia(siteId, { name: item.file.name, data, replace: true });
      }
      update(item.key, { status: "done", result });
      onUploaded?.(result, item.file);
      void queryClient.invalidateQueries({ queryKey: keys.change(siteId) });
      void queryClient.invalidateQueries({ queryKey: keys.panel(siteId, "tree") });
      return true;
    } catch (err) {
      update(item.key, { status: "error", error: err });
      return !(err instanceof ApiRequestError && err.code === "site.busy");
    }
  };

  const drain = async () => {
    if (running.current) return;
    running.current = true;
    try {
      while (pending.current.length > 0) {
        const item = pending.current.shift();
        if (item && !(await send(item))) break;
      }
    } finally {
      running.current = false;
    }
  };

  const addFiles = (files: FileList | File[]) => {
    if (blocked) return;
    const chosen = [...files].map((file): Item => {
      const item: Item = { key: `${Date.now()}-${nextKey.current++}`, file, status: "pending" };
      if (!ALLOWED.test(file.name)) return { ...item, status: "error", error: new Error(m.media.unsupported) };
      if (file.size > MAX_BYTES) return { ...item, status: "error", error: new Error(m.media.tooLarge) };
      if (file.size === 0) return { ...item, status: "error", error: new Error(errorText("media.empty")) };
      return item;
    });
    const accepted = chosen.filter((item) => item.error === undefined);
    const rejected = chosen.filter((item) => item.error !== undefined);
    if (rejected.length > 0) setItems((list) => [...list, ...rejected]);
    if (accepted.length > 0) {
      pending.current.push(...accepted);
      setItems((list) => [...list, ...accepted]);
      void drain();
    }
  };

  useImperativeHandle(ref, () => ({ addFiles }));

  return (
    <section
      className={`flex flex-col gap-2 ${dragging ? "rounded-md border border-dashed border-ring p-1" : ""}`}
      aria-label={ariaLabel}
      data-testid="media-upload-area"
      onDragOver={(e) => {
        if (blocked) return;
        e.preventDefault();
        e.stopPropagation();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragging(false);
        if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
      }}
    >
      <input
        ref={input}
        type="file"
        multiple
        accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,image/png,image/jpeg,image/gif,image/webp,application/pdf"
        className="hidden"
        onChange={(e) => {
          if (e.target.files) addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <Button
        type="button"
        size={size}
        variant={variant}
        disabled={blocked}
        title={blocked ? (disabled ? disabledReason : m.media.busy) : m.media.uploadHint}
        aria-label={ariaLabel}
        onClick={() => input.current?.click()}
        data-testid="media-upload"
      >
        {trigger}
      </Button>
      {blocked && <p className="text-xs text-muted-foreground">{disabled ? disabledReason : m.media.busy}</p>}
      {dragging && <p className="text-xs text-muted-foreground">{m.media.dropHint}</p>}
      {items.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs" data-testid="media-queue">
          {items.map((item) => (
            <li key={item.key} className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 max-w-48 truncate" title={item.file.name}>
                {item.file.name}
              </span>
              {item.status === "pending" && <span className="text-muted-foreground">{m.media.waiting}</span>}
              {item.status === "uploading" && (
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" /> {m.media.uploading}
                </span>
              )}
              {item.status === "done" && (
                <span className="text-emerald-700 dark:text-emerald-400">{m.media.uploaded}</span>
              )}
              {item.status === "skipped" && <span className="text-muted-foreground">{m.media.skipped}</span>}
              {item.status === "error" && (
                <>
                  <span className="text-destructive">
                    {item.error instanceof ApiRequestError
                      ? errorOf(item.error)
                      : item.error instanceof Error
                        ? item.error.message
                        : errorOf(item.error)}
                  </span>
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    onClick={() => {
                      setItems((list) => list.filter((x) => x.key !== item.key));
                      addFiles([item.file]);
                    }}
                  >
                    {m.media.retry}
                  </Button>
                </>
              )}
              {item.result && <code className="break-all text-muted-foreground">{item.result.url}</code>}
              {item.result?.location && (
                <p className="basis-full text-amber-700 dark:text-amber-400">{m.media.location}</p>
              )}
            </li>
          ))}
        </ul>
      )}
      <Dialog open={duplicate !== null} onOpenChange={(open) => !open && resolveDuplicate("skip")}>
        <DialogContent closeLabel={m.common.close}>
          <DialogTitle>{m.media.duplicateTitle}</DialogTitle>
          <DialogDescription>{t(m.media.duplicateDescription, { name: duplicate?.name ?? "" })}</DialogDescription>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => resolveDuplicate("skip")}>
              {m.media.skip}
            </Button>
            <Button type="button" onClick={() => resolveDuplicate("replace")}>
              {m.media.replace}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
});

async function fileToBase64(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Cannot read the file"));
    reader.readAsDataURL(file);
  });
  const comma = dataUrl.indexOf(",");
  return comma < 0 ? "" : dataUrl.slice(comma + 1);
}
