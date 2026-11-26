import {
  type ContentBlock,
  type ContentDatabase,
  type ContentPage,
  ContentPageCreate,
  type ContentProposal,
  type ContentProposalState,
  type ContentRef,
  type ContentValue,
  ContentValue as ContentValueSchema,
  proposalOpen,
} from "@bukitjalil/shared";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { contentToItems, contentToMarkdown, markdownToContent } from "../data-sources/notion-blocks.ts";
import { displayOfValue, type NotionContentService } from "../data-sources/notion-content.ts";
import { notionId } from "../data-sources/service.ts";
import { asSiteError, SiteError } from "../sites/location.ts";
import type { Db } from "../store/db.ts";

/**
 * The content assistant's proposals (content editor and AI design, A2). The propose tools check a change
 * and record it in their result; nothing is written until the user confirms it in the panel, and the user's
 * decision is kept in `content_proposals` and told to the model with the next message of that conversation.
 */
export const CONTENT_PROPOSE_TOOLS = ["propose_update", "propose_create"] as const;

/** The error of a proposal whose body was written but not its properties: it is not tried again. */
export const PARTIAL = "content.proposal_partial";
/** The error of a new entry Notion did not answer for: it may have been made, so it is not tried again. */
export const UNKNOWN = "content.proposal_unknown";

const isProposeTool = (name: unknown) => (CONTENT_PROPOSE_TOOLS as readonly unknown[]).includes(name);

/** A value as the model gives it, by property type; anything else is refused with what was expected. */
function modelValue(name: string, type: string, raw: unknown, db: ContentDatabase): ContentValue {
  const expect = (what: string): never => {
    throw new Error(`Property "${name}" (${type}) takes ${what}.`);
  };
  let value: unknown;
  switch (type) {
    case "title":
    case "rich_text":
      if (raw !== null && typeof raw !== "string") expect("a string");
      value = { type, text: raw ?? "" };
      break;
    case "number":
      if (raw !== null && typeof raw !== "number") expect("a number or null");
      value = { type, number: raw };
      break;
    case "select":
    case "status": {
      if (raw !== null && typeof raw !== "string") expect("an option name or null");
      const options = db.properties.find((p) => p.name === name)?.options ?? [];
      // Notion makes a new select option when one is named, but not a new status.
      if (type === "status" && raw !== null && !options.some((o) => o.name === raw))
        expect(`one of its options (${options.map((o) => JSON.stringify(o.name)).join(", ")}) or null`);
      value = { type, option: raw };
      break;
    }
    case "multi_select":
      if (!Array.isArray(raw) || raw.some((x) => typeof x !== "string")) expect("an array of option names");
      value = { type, options: raw };
      break;
    case "date":
      if (raw === null || typeof raw === "string") value = { type, start: raw, end: null };
      else if (typeof raw === "object" && raw !== null && "start" in raw)
        value = { type, start: (raw as { start: unknown }).start, end: (raw as { end?: unknown }).end ?? null };
      else expect('a date ("2026-11-22"), {"start", "end"} or null');
      break;
    case "checkbox":
      if (typeof raw !== "boolean") expect("true or false");
      value = { type, checked: raw };
      break;
    case "url":
    case "email":
    case "phone_number":
      if (raw !== null && typeof raw !== "string") expect("a string or null");
      value = { type, text: raw === "" ? null : raw };
      break;
    default:
      throw new Error(`Property "${name}" (${type}) cannot be edited here.`);
  }
  const parsed = ContentValueSchema.safeParse(value);
  if (!parsed.success) throw new Error(`Property "${name}": ${parsed.error.issues[0]?.message ?? "invalid value"}.`);
  return parsed.data;
}

/** The new body from the model's Markdown, checked as a save would check it. */
function bodyOf(markdown: string, keep: readonly string[]): ContentBlock[] {
  let blocks: ContentBlock[];
  try {
    blocks = markdownToContent(markdown);
    contentToItems(blocks);
  } catch (err) {
    if (err instanceof SiteError && err.code === "content.body_invalid")
      throw new Error("The body has Markdown Notion does not take (a link that is not http, https or mailto?).");
    throw err;
  }
  const parsed = ContentPageCreate.safeParse({ properties: {}, blocks });
  if (!parsed.success) throw new Error("The body is too long or has too many blocks.");
  // A kept image stays where it is in Notion, so the kept ones must be this entry's, once each, in order.
  let last = -1;
  for (const b of blocks) {
    if (b.type !== "notion_image") continue;
    const index = keep.indexOf(b.id);
    if (index <= last)
      throw new Error("notion-image: addresses can only keep the images already in this entry's body, in their order.");
    last = index;
  }
  return blocks;
}

export interface ProposeToolOptions {
  content: NotionContentService;
  ref: ContentRef;
  current: () => string | null;
}

type Raw = Record<string, unknown>;
const result = (toolCallId: string, proposal: ContentProposal) => ({
  content: [
    {
      type: "text" as const,
      text: `Proposal ${toolCallId} recorded. The user sees it with a before and after and decides whether it is written to Notion; you are told the outcome with their next message. Do not repeat it unless asked.`,
    },
  ],
  details: { proposal },
});
const VALUES =
  'Values by type: title, rich_text, url, email, phone_number: a string; number: a number; select, status: an option name; multi_select: an array of option names; date: "2026-11-22", "2026-11-22T09:30:00+08:00" or {"start", "end"}; checkbox: true or false. null clears.';

export function createProposeTools({ content, ref, current }: ProposeToolOptions): ToolDefinition[] {
  const { sourceId, databaseId } = ref;
  const properties = {
    type: "object",
    description: `Property values by property name (see read_schema). ${VALUES}`,
    additionalProperties: true,
  };
  const body = {
    type: "string",
    description:
      "The whole new body as Markdown, in the read_entry dialect. Keep an existing image as its ![caption](notion-image:<id>) line.",
    maxLength: 500_000,
  };
  return [
    {
      name: "propose_update",
      label: "Propose a change",
      description:
        "Propose changes to the entry the user has open: properties to change and/or the whole new body. Read it with read_entry first and pass its id and lastEditedTime: if it is not the open entry, or it changed since, the proposal is refused. Nothing is written until the user confirms.",
      parameters: {
        type: "object",
        properties: {
          entryId: { type: "string", description: "The open entry's id, from read_entry.", maxLength: 40 },
          lastEditedTime: { type: "string", description: "lastEditedTime from read_entry.", maxLength: 40 },
          properties,
          body,
        },
        required: ["entryId", "lastEditedTime"],
        additionalProperties: false,
      } as never,
      async execute(
        toolCallId,
        params: { entryId?: string; lastEditedTime?: string; properties?: Raw; body?: string },
      ) {
        const entryId = current();
        if (!entryId) throw new Error("The user has no entry open: an update is only for the open entry.");
        // Named, not assumed: Notion's edit times are by the minute, so two entries can share one.
        if (notionId(params.entryId ?? "") !== entryId)
          throw new Error(
            `The open entry is ${entryId}, not ${params.entryId ?? "none"}: an update is only for the open entry. Ask the user to open the entry, or propose a new one.`,
          );
        const [db, page, current_body] = await Promise.all([
          content.database(sourceId, databaseId),
          content.page(sourceId, databaseId, entryId),
          params.body === undefined ? null : content.body(sourceId, databaseId, entryId),
        ]);
        // What the change was made from: an edit since would be overwritten with what it did not see.
        if (params.lastEditedTime !== page.lastEditedTime)
          throw new Error(
            `The entry was edited at ${page.lastEditedTime}, after the version you read (${params.lastEditedTime ?? "none"}): read it again with read_entry, then propose again.`,
          );
        const changed: ContentProposal["properties"] = [];
        for (const [name, raw] of Object.entries(params.properties ?? {})) {
          const property = page.properties.find((p) => p.name === name);
          if (!property) throw new Error(`The entry has no property "${name}".`);
          if (!property.value) throw new Error(`Property "${name}" (${property.type}) cannot be edited here.`);
          const after = modelValue(name, property.type, raw, db);
          if (JSON.stringify(after) !== JSON.stringify(property.value))
            changed.push({
              name,
              type: property.type,
              before: displayOfValue(property.value),
              revision: property.revision,
              after,
            });
        }
        let bodyChange: ContentProposal["body"] = null;
        let blocks: ContentBlock[] | null = null;
        if (current_body && params.body !== undefined) {
          if (!current_body.editable)
            throw new Error(`This entry's body cannot be edited here (${current_body.unsupported.join(", ")}).`);
          const keep = current_body.blocks.flatMap((b) => (b.type === "notion_image" ? [b.id] : []));
          const next = bodyOf(params.body, keep);
          const before = contentToMarkdown(current_body.blocks);
          const after = contentToMarkdown(next);
          if (after !== before) {
            bodyChange = { before, after, revision: current_body.revision };
            blocks = next;
          }
        }
        if (changed.length === 0 && !bodyChange) throw new Error("Nothing would change: the entry already reads so.");
        return result(toolCallId, {
          kind: "update",
          entryId,
          title: page.title,
          base: page.lastEditedTime,
          properties: changed,
          body: bodyChange,
          blocks,
        });
      },
    },
    {
      name: "propose_create",
      label: "Propose a new entry",
      description:
        "Propose a new entry of the database: its properties and, optionally, its body. Nothing is written until the user confirms.",
      parameters: {
        type: "object",
        properties: { properties, body },
        required: ["properties"],
        additionalProperties: false,
      } as never,
      async execute(toolCallId, params: { properties?: Raw; body?: string }) {
        const db = await content.database(sourceId, databaseId);
        const set: ContentProposal["properties"] = [];
        for (const [name, raw] of Object.entries(params.properties ?? {})) {
          const property = db.properties.find((p) => p.name === name);
          if (!property) throw new Error(`The database has no property "${name}".`);
          if (!property.editable) throw new Error(`Property "${name}" (${property.type}) cannot be edited here.`);
          set.push({ name, type: property.type, before: null, after: modelValue(name, property.type, raw, db) });
        }
        const blocks = params.body === undefined ? null : bodyOf(params.body, []);
        const title = set.find((p) => p.after.type === "title")?.after;
        return result(toolCallId, {
          kind: "create",
          entryId: null,
          title: title?.type === "title" ? title.text : "",
          base: null,
          properties: set,
          body: blocks ? { before: null, after: contentToMarkdown(blocks) } : null,
          blocks,
        });
      },
    },
  ];
}

/** The proposal a tool result in a conversation holds, by its tool call id; null when there is none. */
export function proposalIn(messages: readonly { message: unknown }[], callId: string): ContentProposal | null {
  for (const { message } of messages) {
    const m = message as {
      role?: unknown;
      toolCallId?: unknown;
      toolName?: unknown;
      isError?: unknown;
      details?: unknown;
    };
    if (m.role !== "toolResult" || m.toolCallId !== callId || !isProposeTool(m.toolName) || m.isError) continue;
    const proposal = (m.details as { proposal?: ContentProposal } | undefined)?.proposal;
    return proposal ?? null;
  }
  return null;
}

/** The tool call ids of the proposals in a conversation. */
export function proposalIds(messages: readonly { message: unknown }[]): string[] {
  return messages.flatMap(({ message }) => {
    const m = message as { role?: unknown; toolCallId?: unknown; toolName?: unknown; isError?: unknown };
    return m.role === "toolResult" && isProposeTool(m.toolName) && !m.isError && typeof m.toolCallId === "string"
      ? [m.toolCallId]
      : [];
  });
}

interface DecisionRow {
  call_id: string;
  status: "applied" | "rejected" | "failed";
  entry_id: string | null;
  error: string | null;
}

const stateOf = (row: DecisionRow): ContentProposalState => ({
  callId: row.call_id,
  status: row.status,
  entryId: row.entry_id,
  error: row.error,
});

/**
 * The user's decisions on proposals, by database and tool call: a fork that copied a proposal shares its
 * decision. A written or declined proposal is final; a failed one may be tried again.
 */
export class ContentProposals {
  /** Proposals being written now, so a second click cannot write one twice. */
  private readonly writing = new Set<string>();

  constructor(
    private readonly db: Db,
    private readonly content: NotionContentService,
  ) {}

  states(ref: ContentRef, callIds: readonly string[]): ContentProposalState[] {
    const rows = this.db
      .prepare(
        "SELECT call_id, status, entry_id, error FROM content_proposals WHERE data_source_id = ? AND database_id = ?",
      )
      .all(ref.sourceId, ref.databaseId) as DecisionRow[];
    const decided = new Map(rows.map((r) => [r.call_id, stateOf(r)]));
    return callIds.map((callId) => decided.get(callId) ?? { callId, status: "pending", entryId: null, error: null });
  }

  /** Write a proposal to Notion. A failure is recorded and returned, not thrown: the card shows it. */
  async apply(
    ref: ContentRef,
    sessionId: string,
    callId: string,
    proposal: ContentProposal,
  ): Promise<ContentProposalState> {
    const key = `${ref.sourceId}/${ref.databaseId}/${callId}`;
    if (this.writing.has(key)) throw new SiteError("content.proposal_busy", 409);
    this.assertOpen(ref, callId);
    // The proposal comes back from the conversation: check it as a request would be checked.
    const parsed = ContentPageCreate.safeParse({
      properties: Object.fromEntries(proposal.properties.map((p) => [p.name, p.after])),
      ...(proposal.blocks ? { blocks: proposal.blocks } : {}),
    });
    if (!parsed.success || (proposal.kind === "update" && (!proposal.entryId || !proposal.base)))
      throw new SiteError("content.proposal_invalid", 400);
    const { properties, blocks } = parsed.data;
    this.writing.add(key);
    let entryId: string | null = null;
    let wrote = false;
    try {
      if (proposal.kind === "create") {
        entryId = (
          await this.content.create(ref.sourceId, ref.databaseId, { properties, ...(blocks ? { blocks } : {}) })
        ).id;
      } else {
        entryId = proposal.entryId;
        let base = proposal.base as string;
        const expected = new Map<string, string>();
        let original: ContentPage | undefined;
        for (const p of proposal.properties) {
          if (p.revision) {
            expected.set(p.name, p.revision);
            continue;
          }
          // Proposals saved before field fingerprints existed still carry their reviewed display values.
          original ??= await this.content.page(ref.sourceId, ref.databaseId, entryId as string);
          const field = original.properties.find((f) => f.name === p.name);
          if (
            original.lastEditedTime !== base ||
            !field?.revision ||
            !field.value ||
            field.type !== p.type ||
            displayOfValue(field.value) !== p.before
          )
            throw new SiteError("content.conflict", 409);
          expected.set(p.name, field.revision);
        }
        if (blocks) {
          let revision = proposal.body?.revision;
          if (!revision) {
            const original = await this.content.body(ref.sourceId, ref.databaseId, entryId as string);
            if (
              !original.editable ||
              original.lastEditedTime !== base ||
              contentToMarkdown(original.blocks) !== proposal.body?.before
            )
              throw new SiteError("content.conflict", 409);
            revision = original.revision;
          }
          base = (
            await this.content.saveBody(ref.sourceId, ref.databaseId, entryId as string, {
              lastEditedTime: base,
              revision,
              blocks,
            })
          ).lastEditedTime;
          wrote = true;
        }
        if (Object.keys(properties).length > 0)
          await this.content.update(ref.sourceId, ref.databaseId, entryId as string, {
            lastEditedTime: base,
            properties,
            expected: Object.fromEntries(expected),
          });
      }
      return this.record(ref, sessionId, { callId, status: "applied", entryId, error: null });
    } catch (err) {
      // The body went in but the properties did not: trying again would only conflict with that write. A new
      // page Notion may have made without saying so would be made twice.
      const site = asSiteError(err);
      const unclear = proposal.kind === "create" && (!site || site.code === "content.create_unknown");
      const error = wrote ? PARTIAL : unclear ? UNKNOWN : (site?.code ?? "server.internal");
      const state = this.record(ref, sessionId, { callId, status: "failed", entryId, error });
      // Not a failure Notion or the checks reported: the request fails too, so it is logged.
      if (!wrote && !site) throw err;
      return state;
    } finally {
      this.writing.delete(key);
    }
  }

  reject(ref: ContentRef, sessionId: string, callId: string): ContentProposalState {
    if (this.writing.has(`${ref.sourceId}/${ref.databaseId}/${callId}`))
      throw new SiteError("content.proposal_busy", 409);
    this.assertOpen(ref, callId);
    return this.record(ref, sessionId, { callId, status: "rejected", entryId: null, error: null });
  }

  /**
   * What the user decided in this conversation since the model last heard, as a note for the model; `ack`
   * marks those decisions told once the note is sent.
   */
  notes(sessionId: string): { text: string; ack: () => void } | null {
    const rows = this.db
      .prepare(
        "SELECT data_source_id, database_id, call_id, status, entry_id, error, decided_at FROM content_proposals WHERE session_id = ? AND noted = 0 ORDER BY decided_at",
      )
      .all(sessionId) as (DecisionRow & { data_source_id: string; database_id: string; decided_at: string })[];
    if (rows.length === 0) return null;
    const lines = rows.map((r) =>
      r.status === "applied"
        ? `- ${r.call_id}: written to Notion (entry ${r.entry_id}).`
        : r.status === "rejected"
          ? `- ${r.call_id}: declined by the user; it was not written.`
          : r.error === UNKNOWN
            ? `- ${r.call_id}: Notion did not answer, so the new entry may have been made; the user checks Notion. Do not propose it again unless asked.`
            : `- ${r.call_id}: writing failed (${r.error}); nothing more was written.`,
    );
    return {
      text: ["The user's decisions on your proposals since your last turn:", ...lines].join("\n"),
      ack: () => {
        // Only the decisions as they were told: one made again while the note was sent is told next time.
        const mark = this.db.prepare(
          "UPDATE content_proposals SET noted = 1 WHERE data_source_id = ? AND database_id = ? AND call_id = ? AND session_id = ? AND decided_at = ? AND status = ? AND error IS ? AND entry_id IS ?",
        );
        this.db.transaction(() => {
          for (const r of rows)
            mark.run(
              r.data_source_id,
              r.database_id,
              r.call_id,
              sessionId,
              r.decided_at,
              r.status,
              r.error,
              r.entry_id,
            );
        })();
      },
    };
  }

  /** Refuses a proposal already written, declined, or written in part (writing it again would conflict). */
  private assertOpen(ref: ContentRef, callId: string): void {
    const [state] = this.states(ref, [callId]);
    if (state && !proposalOpen(state)) throw new SiteError("content.proposal_decided", 409);
  }

  private record(ref: ContentRef, sessionId: string, state: ContentProposalState): ContentProposalState {
    this.db
      .prepare(
        `INSERT INTO content_proposals (data_source_id, database_id, call_id, session_id, status, entry_id, error, decided_at, noted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
         ON CONFLICT (data_source_id, database_id, call_id) DO UPDATE SET
           session_id = excluded.session_id, status = excluded.status, entry_id = excluded.entry_id,
           error = excluded.error, decided_at = excluded.decided_at, noted = 0`,
      )
      .run(
        ref.sourceId,
        ref.databaseId,
        state.callId,
        sessionId,
        state.status,
        state.entryId,
        state.error,
        new Date().toISOString(),
      );
    return state;
  }
}
