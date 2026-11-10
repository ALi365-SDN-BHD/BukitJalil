import { ChevronRight, CircleAlert, CircleCheck, CircleDashed, Loader2 } from "lucide-react";
import { useI18n } from "@/i18n";
import { type ToolView, toolTarget } from "./model";

const MAX_PREVIEW_LINES = 40;

/**
 * One tool call (plan 10.2): folded to its name, target and state; open, its arguments and result.
 * `edit` shows its replacements and `write` the start of what it wrote, as a small diff.
 */
export function ToolCard({ tool }: { tool: ToolView }) {
  const { m } = useI18n();
  const target = toolTarget(tool.args);
  return (
    <details
      className="group rounded-md border bg-muted/30 text-xs"
      data-testid="tool-card"
      data-tool={tool.name}
      data-state={tool.state}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-2 py-1.5 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3 shrink-0 transition-transform group-open:rotate-90" aria-hidden />
        <StateIcon state={tool.state} />
        <span className="font-mono font-medium">{tool.name}</span>
        {target && <span className="min-w-0 truncate font-mono text-muted-foreground">{target}</span>}
        <span className="ml-auto shrink-0 text-muted-foreground">{m.chat.tool[tool.state]}</span>
      </summary>
      <div className="flex flex-col gap-2 border-t px-2 py-2">
        <ToolArgs tool={tool} />
        <section>
          <h4 className="mb-1 font-medium text-muted-foreground">{m.chat.tool.result}</h4>
          {tool.output ? (
            <pre
              className={`max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-background p-2 ${tool.state === "error" ? "text-destructive" : ""}`}
            >
              {tool.output}
            </pre>
          ) : (
            <p className="text-muted-foreground">{m.chat.tool.noResult}</p>
          )}
        </section>
      </div>
    </details>
  );
}

function StateIcon({ state }: { state: ToolView["state"] }) {
  if (state === "running") return <Loader2 className="size-3.5 shrink-0 animate-spin text-sky-600" aria-hidden />;
  if (state === "ok") return <CircleCheck className="size-3.5 shrink-0 text-emerald-600" aria-hidden />;
  if (state === "error") return <CircleAlert className="size-3.5 shrink-0 text-destructive" aria-hidden />;
  return <CircleDashed className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />;
}

function ToolArgs({ tool }: { tool: ToolView }) {
  const { m } = useI18n();
  const args = (tool.args ?? {}) as Record<string, unknown>;
  if (tool.name === "edit" && Array.isArray(args.edits)) {
    return (
      <section>
        <h4 className="mb-1 font-medium text-muted-foreground">{m.chat.tool.edits}</h4>
        <div className="flex flex-col gap-1" data-testid="tool-diff">
          {(args.edits as { oldText?: unknown; newText?: unknown }[]).map((e, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: edits in order
            <Diff key={i} removed={String(e.oldText ?? "")} added={String(e.newText ?? "")} />
          ))}
        </div>
      </section>
    );
  }
  if (tool.name === "write" && typeof args.content === "string") {
    return (
      <section>
        <h4 className="mb-1 font-medium text-muted-foreground">{m.chat.tool.newFile}</h4>
        <div data-testid="tool-diff">
          <Diff removed="" added={args.content} />
        </div>
      </section>
    );
  }
  return (
    <section>
      <h4 className="mb-1 font-medium text-muted-foreground">{m.chat.tool.args}</h4>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-background p-2">
        {JSON.stringify(tool.args, null, 2)}
      </pre>
    </section>
  );
}

/** Removed lines then added lines, each cut to the first MAX_PREVIEW_LINES. */
function Diff({ removed, added }: { removed: string; added: string }) {
  const lines = (text: string) => (text === "" ? [] : text.split("\n"));
  const cut = (all: string[]) => (all.length > MAX_PREVIEW_LINES ? [...all.slice(0, MAX_PREVIEW_LINES), "…"] : all);
  return (
    <pre className="max-h-72 overflow-auto rounded bg-background p-2 font-mono leading-5">
      {cut(lines(removed)).map((l, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: lines in order
        <div key={`-${i}`} className="bg-destructive/10 text-destructive">
          - {l}
        </div>
      ))}
      {cut(lines(added)).map((l, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: lines in order
        <div key={`+${i}`} className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
          + {l}
        </div>
      ))}
    </pre>
  );
}
