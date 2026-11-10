import { z } from "zod";
import type { Build } from "./builds.ts";

/** AI sessions and the event stream (plan 6.2, 9.1, 9.2). */

export type SessionStatus = "idle" | "queued" | "running";

export interface SessionInfo {
  id: string;
  siteId: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  status: SessionStatus;
}

/**
 * A message as Pi stores it (user, assistant, toolResult, ...). The server passes Pi's shape through; the
 * UI reads the fields it knows.
 */
export interface ChatMessage {
  role: string;
  [key: string]: unknown;
}

/** One message of the session's current branch; `entryId` is what a fork starts from. */
export interface SessionMessage {
  entryId: string;
  message: ChatMessage;
}

export interface SessionDetail {
  session: SessionInfo;
  messages: SessionMessage[];
}

export const MAX_MESSAGE_CHARS = 100_000;

export const SessionTitle = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((s) => !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(s), "must not contain control characters");

export const SessionPatch = z.object({ title: SessionTitle.nullable() }).strict();
export type SessionPatch = z.infer<typeof SessionPatch>;

/**
 * prompt and steer: a running session gets the message as a steering message, an idle one starts a run.
 * followUp: a running session gets it after the current run ends.
 */
export const SendMessageRequest = z
  .object({
    text: z
      .string()
      .max(MAX_MESSAGE_CHARS)
      .refine((s) => s.trim() !== "", "must not be empty"),
    mode: z.enum(["prompt", "steer", "followUp"]).default("prompt"),
  })
  .strict();
export type SendMessageRequest = z.infer<typeof SendMessageRequest>;

/** Pi session entry ids are short hex strings. */
export const ForkRequest = z.object({ entryId: z.string().regex(/^[0-9a-f]{1,64}$/) }).strict();
export type ForkRequest = z.infer<typeof ForkRequest>;

// --- event stream (plan 9.2) ---

type SessionScoped<T extends string, D> = { type: T; siteId: string; sessionId: string; data: D };

/**
 * Events on GET /api/events, one connection per tab for all sites; the UI dispatches by `siteId`.
 * `id` is the SSE event id (for Last-Event-ID).
 */
export type ServerEvent = { id: string } & (
  | SessionScoped<"session.status", { status: SessionStatus; error?: string }>
  /**
   * Streamed text of the session's current assistant message: the text from `offset` on. Offset 0 starts a
   * new message (or, after a reconnect, replaces the text so far).
   */
  | SessionScoped<"message.delta", { offset: number; text: string }>
  | SessionScoped<"message.end", { message: ChatMessage }>
  | SessionScoped<"tool.start", { toolCallId: string; toolName: string; args: unknown }>
  | SessionScoped<"tool.update", { toolCallId: string; toolName: string; partialResult: unknown }>
  | SessionScoped<"tool.end", { toolCallId: string; toolName: string; result: unknown; isError: boolean }>
  | SessionScoped<"run.settled", { aborted: boolean }>
  /** A session was created, renamed or forked from another: its place in the session list. */
  | SessionScoped<"session.updated", { session: SessionInfo }>
  | SessionScoped<"session.deleted", Record<string, never>>
  /** summarize_changes: the AI's description of its changes (kept with the change set from M4). */
  | SessionScoped<"session.summary", { summary: string }>
  | { type: "build.start" | "build.end"; siteId: string; data: { build: Build } }
  /** Events were lost (buffer overflow or server restart): refetch sessions, messages and change sets. */
  | { type: "resync"; data: Record<string, never> }
);

/** A ServerEvent before the hub gives it an id. */
export type ServerEventInput = ServerEvent extends infer E ? (E extends unknown ? Omit<E, "id"> : never) : never;
