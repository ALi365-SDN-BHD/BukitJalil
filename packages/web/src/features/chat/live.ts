import type { ChatMessage, ServerEvent } from "@bukitjalil/shared";

/** A tool call as the event stream reports it, before its result message is stored. */
export interface LiveTool {
  name: string;
  args: unknown;
  partial: unknown;
  result: unknown;
  isError: boolean;
  done: boolean;
}

/** A message sent from this tab that the session has not taken in yet. */
export interface PendingMessage {
  id: number;
  text: string;
}

/**
 * What a session's events add to the messages fetched from the server (plan 9.2): the text streaming in,
 * messages ended since, tool progress, how the last run ended, and messages still waiting to be taken in
 * (queued behind another conversation, or a steer / follow-up the AI has not reached yet).
 */
export interface LiveSession {
  /** Streamed text of the current assistant message; null when none is streaming. */
  text: string | null;
  /** Messages that ended since the session was fetched (fetched ones are dropped when shown). */
  messages: ChatMessage[];
  tools: Record<string, LiveTool>;
  /** Error code of the last run, until the next one starts. */
  error: string | null;
  pending: PendingMessage[];
}

export const emptyLive = (): LiveSession => ({ text: null, messages: [], tools: {}, error: null, pending: [] });

/** The text of a user message, as the composer sent it. */
export function userText(message: ChatMessage): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((b) => (b && typeof b === "object" && b.type === "text" ? [String(b.text)] : [])).join("\n");
}

/** The session state after one event; events of other kinds leave it unchanged. */
export function applyEvent(state: LiveSession, event: ServerEvent): LiveSession {
  switch (event.type) {
    case "session.status": {
      const { status, error } = event.data;
      if (status === "running") return { ...state, error: null };
      if (status === "queued") return { ...state, text: null };
      // Idle: the run ended, or the session's waiting messages were dropped; whatever was not taken in
      // by now never will be.
      return { ...state, text: null, error: error ?? null, pending: [] };
    }
    case "message.delta": {
      const { offset, text } = event.data;
      const before = state.text ?? "";
      // A delta past the text we hold cannot be placed; it is dropped until the message ends.
      if (offset > before.length) return state;
      return { ...state, text: before.slice(0, offset) + text };
    }
    case "message.end": {
      const message = event.data.message;
      let pending = state.pending;
      if (message.role === "user") {
        const text = userText(message);
        const i = pending.findIndex((p) => p.text === text);
        if (i >= 0) pending = pending.filter((_, j) => j !== i);
      }
      return {
        ...state,
        text: message.role === "assistant" ? null : state.text,
        messages: [...state.messages, message],
        pending,
      };
    }
    case "tool.start": {
      const { toolCallId, toolName, args } = event.data;
      const tool: LiveTool = { name: toolName, args, partial: null, result: null, isError: false, done: false };
      return { ...state, tools: { ...state.tools, [toolCallId]: tool } };
    }
    case "tool.update": {
      const current = state.tools[event.data.toolCallId];
      if (!current) return state;
      return {
        ...state,
        tools: { ...state.tools, [event.data.toolCallId]: { ...current, partial: event.data.partialResult } },
      };
    }
    case "tool.end": {
      const { toolCallId, toolName, result, isError } = event.data;
      const current = state.tools[toolCallId];
      const tool: LiveTool = {
        name: toolName,
        args: current?.args ?? null,
        partial: null,
        result,
        isError,
        done: true,
      };
      return { ...state, tools: { ...state.tools, [toolCallId]: tool } };
    }
    case "run.settled":
      return { ...state, text: null };
    default:
      return state;
  }
}

/** A message's identity across the stream and the stored session: role and Pi's timestamp. */
export function messageKey(message: ChatMessage): string {
  return `${message.role}:${String(message.timestamp ?? "")}`;
}

/** Messages that ended live and are not yet in the fetched list. */
export function unseen(live: ChatMessage[], fetched: ChatMessage[]): ChatMessage[] {
  const known = new Set(fetched.map(messageKey));
  return live.filter((m) => !known.has(messageKey(m)));
}
