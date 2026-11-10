import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { PiModules } from "./pi.ts";

/**
 * A scripted model for end-to-end tests and trying the UI without a key, registered only when the server
 * starts with BUKITJALIL_FAKE_MODEL=1. It streams slowly enough to watch: it looks at the site with
 * site_info, then answers in Markdown, quoting the request. It never touches the network.
 */
export const FAKE_PROVIDER = "bukitjalil-fake";

export function registerFakeModel(runtime: ModelRuntime, { ai }: PiModules): void {
  const faux = ai.fauxProvider({
    provider: FAKE_PROVIDER,
    models: [{ id: "fake-1", name: "BukitJalil fake model", reasoning: true }],
    tokensPerSecond: 60,
    tokenSize: { min: 2, max: 5 },
  });
  type Step = Parameters<typeof faux.setResponses>[0][number];
  // Each reply queues the next, so the script never runs out.
  const reply: Step = (context) => {
    faux.appendResponses([reply]);
    const last = context.messages.at(-1);
    if (last?.role === "toolResult") {
      const request = lastUserText(context.messages);
      return ai.fauxAssistantMessage(
        [
          `I looked at the site. You asked: **${request}**`,
          "",
          "This is the fake model, so nothing was changed. With a real model I would:",
          "",
          "1. Read the pages involved",
          "2. Edit them in the working copy",
          "3. Run the check and the build",
        ].join("\n"),
      );
    }
    return ai.fauxAssistantMessage(
      [
        ai.fauxThinking("The user wants a change. Look at the site first."),
        ai.fauxText("Let me look at the site first."),
        ai.fauxToolCall("site_info", {}),
      ],
      { stopReason: "toolUse" },
    );
  };
  faux.setResponses([reply]);
  runtime.registerNativeProvider(faux.provider);
}

function lastUserText(messages: readonly { role: string; content?: unknown }[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    if (Array.isArray(m.content)) {
      return m.content
        .flatMap((b: { type?: string; text?: string }) => (b.type === "text" && b.text ? [b.text] : []))
        .join(" ");
    }
  }
  return "";
}
