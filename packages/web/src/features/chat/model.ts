import type { ChatMessage, SessionMessage } from "@bukitjalil/shared";
import type { LiveTool } from "./live";

/** Pi's content blocks, as far as the chat shows them. */
type Block =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "toolCall"; id: string; name: string; arguments: unknown }
  | { type: "image"; mimeType?: string }
  | { type: string };

export type ToolState = "running" | "ok" | "error" | "not_run";

export interface ToolView {
  id: string;
  name: string;
  args: unknown;
  state: ToolState;
  /** The result's text, or the live partial result while running. */
  output: string;
}

export type ItemPart =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool"; tool: ToolView };

export type ChatItem =
  | { kind: "user"; key: string; entryId: string | null; text: string; images: number }
  | {
      kind: "assistant";
      key: string;
      entryId: string | null;
      parts: ItemPart[];
      error: string | null;
      aborted: boolean;
    };

const blocksOf = (message: ChatMessage): Block[] => {
  const content = message.content;
  if (typeof content === "string") return [{ type: "text", text: content }];
  return Array.isArray(content) ? (content as Block[]) : [];
};

/** The text of a tool result (or partial result): its text blocks, else its JSON. */
export function resultText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  const content = (value as { content?: unknown }).content;
  if (Array.isArray(content)) {
    const texts = content.flatMap((b) =>
      b && typeof b === "object" && (b as Block).type === "text" ? [(b as { text: string }).text] : [],
    );
    if (texts.length > 0) return texts.join("\n");
  }
  return JSON.stringify(value, null, 2);
}

/**
 * The chat as a list of items: user messages, and assistant messages with their tool calls joined to the
 * results that follow (Pi stores those as separate toolResult messages, which are not shown on their own).
 */
export function chatItems(
  messages: { entryId: string | null; message: ChatMessage }[],
  live: { tools: Record<string, LiveTool>; running: boolean },
): ChatItem[] {
  const results = new Map<string, ChatMessage>();
  for (const { message } of messages) {
    if (message.role === "toolResult" && typeof message.toolCallId === "string")
      results.set(message.toolCallId, message);
  }
  const items: ChatItem[] = [];
  messages.forEach(({ entryId, message }, i) => {
    const key = entryId ?? `live-${i}`;
    if (message.role === "user") {
      const blocks = blocksOf(message);
      const text = blocks.flatMap((b) => (b.type === "text" ? [(b as { text: string }).text] : [])).join("\n");
      items.push({ kind: "user", key, entryId, text, images: blocks.filter((b) => b.type === "image").length });
      return;
    }
    if (message.role !== "assistant") return;
    const parts: ItemPart[] = [];
    for (const block of blocksOf(message)) {
      if (block.type === "text" && (block as { text: string }).text.trim() !== "") {
        parts.push({ kind: "text", text: (block as { text: string }).text });
      } else if (block.type === "thinking" && (block as { thinking: string }).thinking.trim() !== "") {
        parts.push({ kind: "thinking", text: (block as { thinking: string }).thinking });
      } else if (block.type === "toolCall") {
        const call = block as { id: string; name: string; arguments: unknown };
        parts.push({ kind: "tool", tool: toolView(call, results.get(call.id), live.tools[call.id], live.running) });
      }
    }
    const stop = message.stopReason;
    const error = stop === "error" && typeof message.errorMessage === "string" ? message.errorMessage : null;
    items.push({ kind: "assistant", key, entryId, parts, error, aborted: stop === "aborted" });
  });
  return items;
}

export type ModelErrorKind = "auth" | "limit" | "overloaded" | "network" | "context";

/**
 * What kind of failure a provider's error message describes (plan M5 layer 2), so the chat can say what
 * to do about it; null when it is none of the known kinds. Providers word these differently, so this
 * looks for status codes and the usual phrases.
 */
export function modelErrorKind(message: string): ModelErrorKind | null {
  const text = message.toLowerCase();
  if (
    /\b(401|403)\b|unauthori[sz]ed|(invalid|incorrect).{0,20}(api[ _-]?key|token|credential)|authentication|permission denied|forbidden/.test(
      text,
    )
  )
    return "auth";
  if (/\b429\b|rate.?limit|too many requests|quota|insufficient.{0,10}(balance|credit|funds)|billing/.test(text))
    return "limit";
  if (/context.{0,20}(length|window|too long)|maximum.{0,20}tokens|prompt is too long|too many tokens/.test(text))
    return "context";
  if (/\b(529|503)\b|overloaded|unavailable|capacity/.test(text)) return "overloaded";
  if (
    /fetch failed|network|econn(refused|reset)|enotfound|etimedout|eai_again|socket hang up|timed? ?out|getaddrinfo/.test(
      text,
    )
  )
    return "network";
  return null;
}

function toolView(
  call: { id: string; name: string; arguments: unknown },
  result: ChatMessage | undefined,
  live: LiveTool | undefined,
  running: boolean,
): ToolView {
  const base = { id: call.id, name: call.name, args: call.arguments };
  if (result) return { ...base, state: result.isError ? "error" : "ok", output: resultText(result) };
  if (live?.done) return { ...base, state: live.isError ? "error" : "ok", output: resultText(live.result) };
  if (running) return { ...base, state: "running", output: resultText(live?.partial) };
  return { ...base, state: "not_run", output: "" };
}

/** Stored messages first, then those that ended live since (without entry ids: they cannot be forked yet). */
export function mergeMessages(fetched: SessionMessage[], live: ChatMessage[]) {
  return [...fetched, ...live.map((message) => ({ entryId: null, message }))];
}

/** A short target for a tool card's title: the path, pattern or section it works on. */
export function toolTarget(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const a = args as Record<string, unknown>;
  for (const key of ["path", "pattern", "section", "collection"]) {
    if (typeof a[key] === "string" && a[key] !== "") return a[key] as string;
  }
  return "";
}

/**
 * The AI's summary of the latest run: the argument of its last successful `summarize_changes` call after
 * the last user message. It comes from the stored messages, so it survives a reload, and a later run
 * without one shows none.
 */
export function latestSummary(items: ChatItem[]): string | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (!item || item.kind === "user") return null;
    for (let j = item.parts.length - 1; j >= 0; j--) {
      const part = item.parts[j];
      if (part?.kind !== "tool" || part.tool.name !== "summarize_changes" || part.tool.state !== "ok") continue;
      const summary = (part.tool.args as { summary?: unknown } | null)?.summary;
      if (typeof summary === "string" && summary.trim() !== "") return summary.trim();
    }
  }
  return null;
}

/** What changes the height of the list's end, for following new output: cheap to compute on every delta. */
export function tailSignature(items: ChatItem[]): string {
  const last = items.at(-1);
  if (!last) return "0";
  if (last.kind === "user") return `${items.length}:u`;
  const parts = last.parts.map((p) => (p.kind === "tool" ? `${p.tool.state}${p.tool.output.length}` : p.text.length));
  return `${items.length}:${parts.join(",")}:${last.error ?? ""}:${last.aborted}`;
}
