import type { ChatMessage, ServerEventInput } from "@bukitjalil/shared";
import type { AgentEvent, AgentService } from "../agent/service.ts";
import type { BuildService } from "../builds/service.ts";
import type { EventHub } from "./hub.ts";

/** Send session and build events to the hub (plan 9.2); returns the function that disconnects them. */
export function connectEvents(hub: EventHub, agent: AgentService, builds: BuildService): () => void {
  const translate = agentEventTranslator();
  const stopAgent = agent.subscribe((event) => {
    for (const e of translate(event)) hub.publish(e);
  });
  const stopBuilds = builds.onEvent(({ type, build }) => hub.publish({ type, siteId: build.siteId, data: { build } }));
  return () => {
    stopAgent();
    stopBuilds();
  };
}

/**
 * Turn the agent's events into stream events. Pi's text deltas become `message.delta` with the offset into
 * the session's current assistant message, so a client can also take a merged replay (offset 0).
 * Other Pi events (turns, queue updates, compaction, retries) are not sent.
 */
export function agentEventTranslator(): (event: AgentEvent) => ServerEventInput[] {
  /** sessionId -> length of the streamed text of its current assistant message. */
  const streamed = new Map<string, number>();
  return (event) => {
    const { siteId, sessionId } = event;
    const base = { siteId, sessionId };
    if (event.type === "status") {
      if (event.status !== "running") streamed.delete(sessionId);
      const data = event.error ? { status: event.status, error: event.error } : { status: event.status };
      return [{ ...base, type: "session.status", data }];
    }
    if (event.type === "summary") return [{ ...base, type: "session.summary", data: { summary: event.summary } }];
    if (event.type === "session") return [{ ...base, type: "session.updated", data: { session: event.session } }];
    if (event.type === "deleted") {
      streamed.delete(sessionId);
      return [{ ...base, type: "session.deleted", data: {} }];
    }
    const e = event.event;
    switch (e.type) {
      case "message_start":
        if (e.message.role === "assistant") streamed.set(sessionId, 0);
        return [];
      case "message_update": {
        const update = e.assistantMessageEvent;
        if (update.type !== "text_delta" || update.delta === "") return [];
        const offset = streamed.get(sessionId) ?? 0;
        streamed.set(sessionId, offset + update.delta.length);
        return [{ ...base, type: "message.delta", data: { offset, text: update.delta } }];
      }
      case "message_end":
        streamed.delete(sessionId);
        // The system prompt is not part of the conversation the user sees.
        if (e.message.role === "system") return [];
        return [{ ...base, type: "message.end", data: { message: e.message as unknown as ChatMessage } }];
      case "tool_execution_start":
        return [
          { ...base, type: "tool.start", data: { toolCallId: e.toolCallId, toolName: e.toolName, args: e.args } },
        ];
      case "tool_execution_update":
        return [
          {
            ...base,
            type: "tool.update",
            data: { toolCallId: e.toolCallId, toolName: e.toolName, partialResult: e.partialResult },
          },
        ];
      case "tool_execution_end":
        return [
          {
            ...base,
            type: "tool.end",
            data: { toolCallId: e.toolCallId, toolName: e.toolName, result: e.result, isError: e.isError },
          },
        ];
      case "agent_settled":
        return [{ ...base, type: "run.settled", data: { aborted: e.aborted } }];
      default:
        return [];
    }
  };
}
