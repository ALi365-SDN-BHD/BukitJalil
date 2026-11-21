import {
  CONTENT_TEXT_MAX,
  type ContentDatabase,
  type ContentProperty,
  type ContentSchemaProperty,
  type ContentValue,
} from "@bukitjalil/shared";
import { useIsMutating, useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n";
import { api, keys } from "@/lib/api";
import { contentDatabasePath } from "@/lib/project";
import { changeOf, draftKey, saveKey, useDraft } from "./draft";
import { emptyValue, NEW_PAGE, useContentPage } from "./hooks";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The open entry's properties in the right column (plan 5.6): editable types get a control, the others read
 * grey. Changes join the draft the middle column's save sends; the title is edited there.
 */
export function PropertyForm({
  sourceId,
  databaseId,
  pageId,
  database,
}: {
  sourceId: string;
  databaseId: string;
  pageId: string;
  database: ContentDatabase;
}) {
  const { m, errorOf } = useI18n();
  const isNew = pageId === NEW_PAGE;
  const page = useContentPage(sourceId, databaseId, pageId);
  const key = draftKey(sourceId, databaseId, pageId);
  const draft = useDraft(key);
  // The middle column's save sends these too: nothing changes while it runs, so nothing typed is lost.
  const saving = useIsMutating({ mutationKey: saveKey(key) }) > 0;
  const schema = new Map(database.properties.map((p) => [p.name, p]));

  if (!isNew && page.isPending) return <p className="p-4 text-sm text-muted-foreground">{m.common.loading}</p>;
  if (!isNew && page.error) {
    return (
      <p role="alert" className="p-4 text-sm text-destructive">
        {errorOf(page.error)}
      </p>
    );
  }
  // A new page shows the editable properties empty; an existing one, what Notion returned.
  const properties: ContentProperty[] = isNew
    ? database.properties.flatMap((p) => {
        const value = emptyValue(p);
        return value ? [{ name: p.name, type: p.type, value, display: "" }] : [];
      })
    : (page.data?.properties ?? []);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-testid="content-property-form">
      <fieldset disabled={saving} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-4 text-sm">
        {properties
          .filter((p) => p.type !== "title")
          .map((p) => (
            <PropertyField
              key={p.name}
              property={p}
              schema={schema.get(p.name)}
              value={changeOf(draft.changes, p.name) ?? p.value}
              onChange={(value) => draft.set(p.name, value, p.value, page.data?.lastEditedTime ?? "")}
            />
          ))}
      </fieldset>
      {!isNew && page.data && (
        <TrashButton sourceId={sourceId} databaseId={databaseId} pageId={pageId} title={page.data.title} />
      )}
    </div>
  );
}

function PropertyField({
  property,
  schema,
  value,
  onChange,
}: {
  property: ContentProperty;
  schema: ContentSchemaProperty | undefined;
  value: ContentValue | null;
  onChange: (value: ContentValue) => void;
}) {
  const { m, t } = useI18n();
  const id = useId();
  const label = (
    <label htmlFor={id} className="flex items-baseline gap-2 font-medium">
      <span className="min-w-0 truncate">{property.name}</span>
      <span className="shrink-0 font-mono text-xs font-normal text-muted-foreground">{property.type}</span>
    </label>
  );
  const wrap = (control: React.ReactNode, hint?: string) => (
    <div className="flex flex-col gap-1.5" data-testid={`content-property-${property.name}`}>
      {label}
      {control}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );

  if (!value || (value.type === "date" && [value.start, value.end].some((d) => d !== null && !DATE_ONLY.test(d)))) {
    const display =
      property.type === "relation" ? t(m.content.relationCount, { count: property.display }) : property.display;
    return wrap(
      <p id={id} className="rounded-md bg-muted/50 px-3 py-2 text-muted-foreground">
        {display || m.content.none}
      </p>,
      value ? m.content.dateWithTime : m.content.readOnly,
    );
  }
  const options = (current: string[]) => {
    const names = schema?.options?.map((o) => o.name) ?? [];
    return [...names, ...current.filter((x) => !names.includes(x))];
  };

  switch (value.type) {
    case "title":
    case "rich_text":
      return wrap(
        <textarea
          id={id}
          className="min-h-20 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
          value={value.text}
          maxLength={CONTENT_TEXT_MAX}
          onChange={(e) => onChange({ type: value.type, text: e.target.value })}
        />,
        property.formatted ? m.content.plainTextOnly : undefined,
      );
    case "number":
      return wrap(
        <NumberInput id={id} value={value.number} onChange={(number) => onChange({ type: "number", number })} />,
      );
    case "select":
    case "status":
      return wrap(
        <select
          id={id}
          className="h-9 w-full rounded-md border bg-background px-2 text-sm dark:bg-input/30"
          value={value.option ?? ""}
          onChange={(e) => onChange({ type: value.type, option: e.target.value || null })}
        >
          {(value.type === "select" || value.option === null) && <option value="">{m.content.none}</option>}
          {options(value.option ? [value.option] : []).map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>,
      );
    case "multi_select":
      return wrap(
        <fieldset id={id} aria-label={property.name} className="m-0 flex flex-wrap gap-1.5 border-0 p-0">
          {options(value.options).map((name) => {
            const on = value.options.includes(name);
            return (
              <button
                key={name}
                type="button"
                aria-pressed={on}
                className={`rounded-full border px-2.5 py-0.5 text-xs ${on ? "border-foreground bg-foreground text-background" : "hover:bg-accent"}`}
                onClick={() =>
                  onChange({
                    type: "multi_select",
                    options: on ? value.options.filter((x) => x !== name) : [...value.options, name],
                  })
                }
              >
                {name}
              </button>
            );
          })}
        </fieldset>,
      );
    case "date":
      return wrap(
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id={id}
            type="date"
            className="w-auto"
            aria-label={m.content.startDate}
            value={value.start ?? ""}
            onChange={(e) =>
              onChange({ type: "date", start: e.target.value || null, end: e.target.value ? value.end : null })
            }
          />
          <span className="text-muted-foreground">→</span>
          <Input
            type="date"
            className="w-auto"
            aria-label={m.content.endDate}
            disabled={!value.start}
            min={value.start ?? undefined}
            value={value.end ?? ""}
            onChange={(e) => onChange({ type: "date", start: value.start, end: e.target.value || null })}
          />
        </div>,
      );
    case "checkbox":
      return wrap(
        <input
          id={id}
          type="checkbox"
          className="size-4 self-start"
          checked={value.checked}
          onChange={(e) => onChange({ type: "checkbox", checked: e.target.checked })}
        />,
      );
    default:
      return wrap(
        <Input
          id={id}
          type={value.type === "url" ? "url" : value.type === "email" ? "email" : "tel"}
          value={value.text ?? ""}
          maxLength={2000}
          onChange={(e) => onChange({ type: value.type, text: e.target.value || null })}
        />,
      );
  }
}

/** A number as text, or null for empty; anything else (`-`, `1e`) is not a number yet. */
function parseNumber(text: string): number | null | undefined {
  if (text.trim() === "") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * A number typed as text: a number input reports a half-typed `-3` as empty, and setting the value then
 * wipes the `-`. What is not a number yet stays in the field and leaves the value as it was.
 */
function NumberInput({
  id,
  value,
  onChange,
}: {
  id: string;
  value: number | null;
  onChange: (n: number | null) => void;
}) {
  const [state, setState] = useState({ text: value === null ? "" : String(value), value });
  let text = state.text;
  if (value !== state.value) {
    // Changed from outside (a reload or a cleared draft) unless the text already says it.
    text = parseNumber(state.text) === value ? state.text : value === null ? "" : String(value);
    setState({ text, value });
  }
  return (
    <Input
      id={id}
      inputMode="decimal"
      value={text}
      aria-invalid={parseNumber(text) === undefined}
      onChange={(e) => {
        const n = parseNumber(e.target.value);
        setState({ text: e.target.value, value: n === undefined ? value : n });
        if (n !== undefined) onChange(n);
      }}
    />
  );
}

/** Move the page to Notion's trash, after asking: it leaves the sites at their next full build. */
function TrashButton({
  sourceId,
  databaseId,
  pageId,
  title,
}: {
  sourceId: string;
  databaseId: string;
  pageId: string;
  title: string;
}) {
  const { m, t, errorOf } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const trash = useMutation({
    mutationFn: () => api.trashContentPage(sourceId, databaseId, pageId),
    onSuccess: () => {
      setConfirm(false);
      queryClient.removeQueries({ queryKey: keys.contentPage(sourceId, databaseId, pageId) });
      void queryClient.invalidateQueries({ queryKey: keys.contentEntries(sourceId, databaseId) });
      navigate(contentDatabasePath(sourceId, databaseId));
    },
  });
  return (
    <div className="mt-auto border-t p-4">
      <Button
        size="sm"
        variant="ghost"
        className="text-destructive hover:text-destructive"
        onClick={() => setConfirm(true)}
        data-testid="content-trash"
      >
        <Trash2 /> {m.content.trash}
      </Button>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent closeLabel={m.common.close}>
          <DialogTitle>{t(m.content.trashTitle, { title: title || m.content.untitled })}</DialogTitle>
          <DialogDescription>{m.content.trashBody}</DialogDescription>
          {trash.error && (
            <p role="alert" className="text-sm text-destructive">
              {errorOf(trash.error)}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              {m.common.cancel}
            </Button>
            <Button
              variant="destructive"
              disabled={trash.isPending}
              onClick={() => trash.mutate()}
              data-testid="content-trash-confirm"
            >
              {m.content.trash}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
