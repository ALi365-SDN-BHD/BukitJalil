import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { PiModules } from "./pi.ts";

/**
 * A scripted model for end-to-end tests and trying the UI without a key, registered only when the server
 * starts with BUKITJALIL_FAKE_MODEL=1. It streams slowly enough to watch and never touches the network.
 * A tag in the latest request picks a script (plan, M3 acceptance); tags, not plain words, so trying the UI
 * never changes a site by accident:
 * - "#faq": reads site.yaml, changes the title (to the text in quotes after "title", if any), writes an FAQ
 *   page, runs bukit_check and summarize_changes; these changes stay in the AI working copy, as a real
 *   model's would
 * - "#auth": tries to read Pi's auth.json outside the working copy
 * - "#plugin": adds a plugin that is not built in to site.yaml, runs bukit_build, then takes the plugin out
 *   again so later builds are not refused
 * - "#fail-key", "#fail-limit", "#fail-network": fails like a provider would (a refused key, a rate limit,
 *   no network), so the chat's error messages can be tried
 * - anything else: looks at the site with site_info
 * Each step is one tool call; it ends with a Markdown answer that quotes the request.
 */
export const FAKE_PROVIDER = "bukitjalil-fake";

/** From the ai/ working copy (worktrees/<siteId>/ai) to the app's pi/auth.json. */
const AUTH_JSON = "../../../pi/auth.json";
const DEFAULT_TITLE = "Hello from BukitJalil";

/** Provider errors, worded like real providers word them. */
const FAILURES: Record<string, string> = {
  key: '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
  limit: "429 Too Many Requests: rate limit exceeded, please retry later",
  network: "TypeError: fetch failed (getaddrinfo ENOTFOUND api.example.invalid)",
};

interface Message {
  role: string;
  content?: unknown;
  isError?: boolean;
}
interface Call {
  tool: string;
  args: Parameters<PiModules["ai"]["fauxToolCall"]>[1];
  note: string;
}

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
    const messages = context.messages as readonly Message[];
    const start = lastUserIndex(messages);
    const request = textOf(messages[start]?.content);
    const results = messages.slice(start + 1).filter((m) => m.role === "toolResult");
    const failure = /#fail-(key|limit|network)\b/i.exec(request)?.[1]?.toLowerCase();
    if (failure) return ai.fauxAssistantMessage([], { stopReason: "error", errorMessage: FAILURES[failure] });
    const call = nextCall(request, results);
    if (call) {
      return ai.fauxAssistantMessage(
        [
          ...(results.length === 0 ? [ai.fauxThinking(`The user asked: ${request}`)] : []),
          ai.fauxText(call.note),
          ai.fauxToolCall(call.tool, call.args),
        ],
        { stopReason: "toolUse" },
      );
    }
    return ai.fauxAssistantMessage(answer(request, results));
  };
  faux.setResponses([reply]);
  runtime.registerNativeProvider(faux.provider);
}

/** The script's next tool call, or null when it is done. */
function nextCall(request: string, results: readonly Message[]): Call | null {
  const step = results.length;
  if (/#faq\b/i.test(request)) {
    const title = /title[^"]*"([^"]+)"/i.exec(request)?.[1] ?? DEFAULT_TITLE;
    const steps: (() => Call)[] = [
      () => ({ tool: "read", args: { path: "site.yaml" }, note: "Let me read the site settings first." }),
      () => {
        const old = /title: *(.+)/.exec(textOf(results[0]?.content))?.[1]?.trim() ?? "My Site";
        return {
          tool: "edit",
          args: {
            path: "site.yaml",
            edits: [{ oldText: `title: ${old}`, newText: `title: ${JSON.stringify(title)}` }],
          },
          note: "Changing the title.",
        };
      },
      () => ({
        tool: "write",
        args: {
          path: "content/pages/faq.md",
          content: `---\ntitle: FAQ\n---\n\n## What is this site?\n\nA site built with BukitJalil.\n`,
        },
        note: "Adding the FAQ page.",
      }),
      () => ({ tool: "bukit_check", args: {}, note: "Checking the site." }),
      () => ({
        tool: "summarize_changes",
        args: { summary: `Changed the site title to "${title}" and added an FAQ page.` },
        note: "Summing up.",
      }),
    ];
    return steps[step]?.() ?? null;
  }
  if (/#auth\b/i.test(request)) {
    return step === 0 ? { tool: "read", args: { path: AUTH_JSON }, note: "Trying to read that file." } : null;
  }
  if (/#plugin\b/i.test(request)) {
    const plain = "site:\n  name: ";
    const withPlugin = "site:\n  plugins:\n    fake-plugin: {}\n  name: ";
    const steps: Call[] = [
      {
        tool: "edit",
        args: { path: "site.yaml", edits: [{ oldText: plain, newText: withPlugin }] },
        note: "Adding the plugin to site.yaml.",
      },
      { tool: "bukit_build", args: {}, note: "Building the site." },
      {
        tool: "edit",
        args: { path: "site.yaml", edits: [{ oldText: withPlugin, newText: plain }] },
        note: "Taking the plugin out again.",
      },
    ];
    return steps[step] ?? null;
  }
  return step === 0 ? { tool: "site_info", args: {}, note: "Let me look at the site first." } : null;
}

function answer(request: string, results: readonly Message[]): string {
  const failed = results.filter((r) => r.isError).length;
  return [
    `I looked at the site. You asked: **${request}**`,
    "",
    failed > 0
      ? `This is the fake model. ${failed} of my ${results.length} steps were refused.`
      : `This is the fake model. All ${results.length} steps went through.`,
    "",
    "With a real model I would:",
    "",
    "1. Read the pages involved",
    "2. Edit them in the working copy",
    "3. Run the check and the build",
  ].join("\n");
}

function lastUserIndex(messages: readonly Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i]?.role === "user") return i;
  return -1;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((b: { type?: string; text?: string }) => (b.type === "text" && b.text ? [b.text] : []))
    .join(" ");
}
