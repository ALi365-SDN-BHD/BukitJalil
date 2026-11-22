import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { contentKey, SITE_ONLY_SKILLS, type SkillsResponse, THEME_SKILLS } from "@bukitjalil/shared";
import type { Api, Model } from "@earendil-works/pi-ai";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AiBukit } from "../src/agent/ai-bukit.ts";
import { NotionContentAgent } from "../src/agent/content-agent.ts";
import { assertPiEnvironment, preparePiEnvironment } from "../src/agent/env.ts";
import { loadPi, type PiModules } from "../src/agent/pi.ts";
import { type AgentEvent, AgentService } from "../src/agent/service.ts";
import { NotionContentService } from "../src/data-sources/notion-content.ts";
import { agentEventTranslator } from "../src/events/bridge.ts";
import { silentLogger } from "../src/log.ts";
import { SiteError } from "../src/sites/location.ts";
import { themeKey } from "../src/themes/service.ts";
import { tinyPng } from "./fixtures/images.ts";
import { writeStarter } from "./fixtures/starter.ts";
import { commitAllAs, expectMode, jsonPut, makeApp, rawGit, req } from "./helpers.ts";

const SKILLS = path.resolve(import.meta.dirname, "../../../skills");
const PNG = tinyPng().toString("base64");

// Pi keeps the directory it saw when it loaded, so this file uses one app home (vitest runs each test
// file in its own module graph).
let base: string;
let ctx: ReturnType<typeof makeApp>;
let pi: PiModules;
let faux: ReturnType<PiModules["ai"]["fauxProvider"]>;
let fetchSpy: ReturnType<typeof vi.spyOn>;
const services: AgentService[] = [];

beforeAll(async () => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bj-agent-")));
  fs.mkdirSync(path.join(base, "home"));
  ctx = makeApp({ userHome: path.join(base, "home"), appHome: path.join(base, "app") });
  fetchSpy = vi.spyOn(globalThis, "fetch");
});
afterEach(async () => {
  await Promise.all(services.splice(0).map((s) => s.shutdown()));
});
afterAll(() => {
  fetchSpy.mockRestore();
  fs.rmSync(base, { recursive: true, force: true });
});

let siteCount = 0;
/** A committed starter site, imported (no Bukit, so no first build); `files` are committed with it. */
async function site(files: Record<string, string> = {}) {
  const dir = path.join(base, "home", `site${++siteCount}`);
  writeStarter(dir, { title: `Site ${siteCount}`, language: "en-US" });
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
  rawGit(base, dir, "init", "-q", "-b", "main");
  commitAllAs(base, dir);
  return ctx.sites.import({ path: dir });
}

function service(
  opts: {
    model?: boolean;
    /** The model reads text only. */
    textOnly?: boolean;
    idleMs?: number;
    shutdownMs?: number;
    rgReady?: () => boolean;
    settled?: () => Promise<void>;
    disabledSkills?: () => readonly string[];
    /** Content management conversations are available, over this content service if given. */
    content?: boolean | NotionContentService;
  } = {},
) {
  const aiBukit = new AiBukit({
    git: ctx.git,
    paths: ctx.paths,
    projects: ctx.projects,
    bukit: ctx.bukit,
    changes: ctx.changes,
  });
  if (opts.settled) {
    const own = aiBukit.settled.bind(aiBukit);
    const hook = opts.settled;
    aiBukit.settled = async (siteId: string) => {
      await hook();
      return own(siteId);
    };
  }
  const agent = new AgentService({
    db: ctx.db,
    paths: ctx.paths,
    projects: ctx.projects,
    locks: ctx.locks,
    changes: ctx.changes,
    logger: silentLogger,
    credentials: ctx.agent.credentials,
    resolveModel: () => {
      if (opts.model === false) return undefined;
      const model = faux.getModel() as Model<Api>;
      return opts.textOnly ? { ...model, input: ["text"] } : model;
    },
    setupRuntime: (runtime) => runtime.registerNativeProvider(faux.provider),
    rgReady: opts.rgReady ?? (() => false),
    bukit: aiBukit,
    skillsDir: SKILLS,
    disabledSkills: opts.disabledSkills,
    idleMs: opts.idleMs,
    shutdownMs: opts.shutdownMs,
    ...(opts.content
      ? {
          content: new NotionContentAgent({
            dataSources: ctx.dataSources,
            content: opts.content === true ? new NotionContentService(ctx.dataSources) : opts.content,
            db: ctx.db,
            tmp: ctx.paths.tmp,
          }),
        }
      : {}),
  });
  services.push(agent);
  const events: AgentEvent[] = [];
  agent.subscribe((e) => events.push(e));
  const statuses = (sessionId: string) =>
    events.filter((e) => e.sessionId === sessionId && e.type === "status").map((e) => e.type === "status" && e.status);
  /** Resolves when the session's run ends. */
  const settled = (sessionId: string) =>
    new Promise<AgentEvent>((resolve) => {
      const stop = agent.subscribe((e) => {
        if (e.sessionId === sessionId && e.type === "status" && e.status === "idle") {
          stop();
          resolve(e);
        }
      });
    });
  return { agent, events, settled, statuses };
}

describe("Pi environment", () => {
  it("refuses to load Pi before its environment is set", () => {
    const piDir = ctx.paths.pi;
    expect(() => assertPiEnvironment(piDir)).toThrow(/PI_CODING_AGENT_DIR/);
    expect(() => loadPi(piDir)).toThrow(/PI_CODING_AGENT_DIR/);
  });

  it("loads Pi once the environment is set, for that directory only", async () => {
    preparePiEnvironment(ctx.paths.pi);
    expect(process.env.PI_CODING_AGENT_DIR).toBe(ctx.paths.pi);
    expect(process.env.PI_OFFLINE).toBe("1");
    pi = await loadPi(ctx.paths.pi);
    expect(typeof pi.pi.createAgentSession).toBe("function");
    expect(await loadPi(ctx.paths.pi)).toBe(pi);
    expect(() => loadPi(path.join(base, "other"))).toThrow();
    faux = pi.ai.fauxProvider({ provider: "faux", models: [{ id: "faux-1", name: "Faux" }] });
  });

  it("keeps the app's Pi directory private", () => {
    expectMode(ctx.paths.pi, 0o700);
    expect(fs.existsSync(ctx.paths.piBin)).toBe(true);
  });
});

describe("Skills settings and API", () => {
  it("lists the bundled skills and keeps site-editing when optional ones are off", async () => {
    const list = async () => {
      const res = await ctx.app.fetch(req("/api/skills"));
      expect(res.status).toBe(200);
      return (await res.json()) as SkillsResponse;
    };

    const before = await list();
    expect(before.skills).toHaveLength(skillNames().length);
    expect(before.skills.find((s) => s.name === "site-editing")).toMatchObject({
      source: "bukitjalil",
      required: true,
      enabled: true,
    });
    expect(before.skills.find((s) => s.name === "theme-development")).toMatchObject({ required: true, enabled: true });
    expect(before.skills.find((s) => s.name === "theme-design")).toMatchObject({
      source: "bukitjalil",
      required: true,
      enabled: true,
    });
    expect(before.skills.find((s) => s.name === "bukit-config")).toMatchObject({
      source: "bukit",
      required: false,
      enabled: true,
    });

    const put = await ctx.app.fetch(
      req("/api/settings", jsonPut({ disabledSkills: ["content-writing", "site-editing"] })),
    );
    expect(put.status).toBe(200);
    const after = await list();
    expect(after.skills.find((s) => s.name === "content-writing")?.enabled).toBe(false);
    expect(after.skills.find((s) => s.name === "site-editing")?.enabled).toBe(true);

    const reset = await ctx.app.fetch(req("/api/settings", jsonPut({ disabledSkills: [] })));
    expect(reset.status).toBe(200);
  });
});

/**
 * Names of BukitJalil's skills: every SKILL.md below the skills directory. With a project kind, the ones
 * its sessions get: without the other kind's skills (theme development design 4.1).
 */
const skillNames = (kind?: "site" | "theme") =>
  fs
    .readdirSync(SKILLS, { recursive: true, encoding: "utf8" })
    .filter((p) => path.basename(p) === "SKILL.md")
    .map((p) => path.basename(path.dirname(p)))
    .filter((name) => kind === undefined || !(kind === "theme" ? SITE_ONLY_SKILLS : THEME_SKILLS).includes(name))
    .sort();

/**
 * The system messages the model received: one, with our prompt, the working directory and exactly
 * BukitJalil's skills. Context files, site skills and appended prompts would add sections, skills or messages.
 */
function systemSections(context: unknown): { preamble: string; cwd: string; skills: string } {
  const messages = (context as { messages: { role: string; sections?: Record<string, string> }[] }).messages;
  const system = messages.filter((m) => m.role === "system");
  expect(system).toHaveLength(1);
  const sections = system[0]?.sections as { preamble: string; cwd: string; skills: string };
  expect(Object.keys(sections).sort()).toEqual(["cwd", "preamble", "skills"]);
  return sections;
}

function systemOf(
  context: unknown,
  kind: "site" | "theme" = "site",
): { preamble: string; cwd: string; skills: string } {
  const sections = systemSections(context);
  const listed = [...sections.skills.matchAll(/<name>([^<]+)<\/name>/g)].map((m) => m[1]).sort();
  expect(listed).toEqual(skillNames(kind));
  return sections;
}

function readEnds(events: AgentEvent[], sessionId: string) {
  return events.flatMap((e) =>
    e.type === "pi" && e.sessionId === sessionId && e.event.type === "tool_execution_end" && e.event.toolName === "read"
      ? [e.event]
      : [],
  );
}

/** A faux response that waits until `release` is called. */
function gated(text: string) {
  let release!: () => void;
  let markStarted!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  /** Resolves when the model has been called. */
  const started = new Promise<void>((r) => {
    markStarted = r;
  });
  const step = async () => {
    markStarted();
    await gate;
    return pi.ai.fauxAssistantMessage(text);
  };
  return { step, release, started };
}

describe("AgentService", () => {
  it("creates an AgentSession in the AI checkout with no tools, offline", async () => {
    const s = await site();
    const { agent, events, settled, statuses } = service();
    const session = agent.create(s.id);
    expect(agent.store.entries(session.id)).toEqual([]);

    let seen: unknown;
    faux.setResponses([
      (context) => {
        seen = context;
        return pi.ai.fauxAssistantMessage("Hello from faux");
      },
    ]);
    const done = settled(session.id);
    await agent.send(session.id, "Hi");
    const end = await done;
    expect(end.type === "status" && end.error).toBeFalsy();

    const system = systemOf(seen);
    expect(system.preamble).toContain("BukitJalil site assistant");
    expect(system.preamble).toContain(`"Site ${siteCount}"`);
    expect(system.cwd.replaceAll("\\", "/")).toContain(
      path.join(ctx.paths.worktrees, s.id, "ai").replaceAll("\\", "/"),
    );
    expect(system.preamble).toContain("bukit_check");
    expect(system.skills).toContain(path.join(fs.realpathSync(SKILLS), "bukitjalil", "site-editing", "SKILL.md"));
    expect(JSON.stringify(seen)).toContain("Hi");

    expect(fs.existsSync(path.join(ctx.paths.worktrees, s.id, "ai", "site.yaml"))).toBe(true);
    expect(JSON.stringify(agent.store.entries(session.id))).toContain("Hello from faux");
    expect(statuses(session.id)).toEqual(["running", "idle"]);
    expect(events.some((e) => e.type === "pi" && e.event.type === "agent_end")).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    // Pi writes only its cache of model lists into the app's Pi directory; keys are in the database.
    for (const name of fs.readdirSync(ctx.paths.pi)) expect(["bin", "models-store.json"]).toContain(name);
  });

  it("cannot read a disabled skill in a new conversation, and re-enabling restores it", async () => {
    const s = await site();
    const disabled: string[] = [];
    const { agent, events, settled } = service({ disabledSkills: () => disabled });
    const skill = path.join(fs.realpathSync(SKILLS), "bukitjalil", "content-writing", "SKILL.md");
    const readSkill = async (sessionId: string) => {
      faux.setResponses([
        pi.ai.fauxAssistantMessage([pi.ai.fauxToolCall("read", { path: skill })], { stopReason: "toolUse" }),
        pi.ai.fauxAssistantMessage("done"),
      ]);
      const done = settled(sessionId);
      await agent.send(sessionId, "Read the skill");
      await done;
      return readEnds(events, sessionId).at(-1);
    };

    const before = agent.create(s.id);
    expect((await readSkill(before.id))?.isError).toBe(false);

    disabled.push("content-writing");
    const off = agent.create(s.id);
    expect((await readSkill(off.id))?.isError).toBe(true);

    disabled.length = 0;
    const on = agent.create(s.id);
    expect((await readSkill(on.id))?.isError).toBe(false);
  });

  it("keeps the old skill permission in the current conversation", async () => {
    const s = await site();
    const disabled: string[] = [];
    const { agent, events, settled } = service({ disabledSkills: () => disabled });
    const skill = path.join(fs.realpathSync(SKILLS), "bukitjalil", "content-writing", "SKILL.md");
    const readSkill = async (sessionId: string) => {
      faux.setResponses([
        pi.ai.fauxAssistantMessage([pi.ai.fauxToolCall("read", { path: skill })], { stopReason: "toolUse" }),
        pi.ai.fauxAssistantMessage("done"),
      ]);
      const done = settled(sessionId);
      await agent.send(sessionId, "Read the skill");
      await done;
      return readEnds(events, sessionId).at(-1);
    };

    const current = agent.create(s.id);
    expect((await readSkill(current.id))?.isError).toBe(false);
    disabled.push("content-writing");
    // Same live session, same gate and prompt: the old permission stays for this conversation.
    expect((await readSkill(current.id))?.isError).toBe(false);
    // A new conversation uses the new setting and denies the file.
    const next = agent.create(s.id);
    expect((await readSkill(next.id))?.isError).toBe(true);
    // Reopening the same conversation reads its session file again and uses the new setting.
    await agent.closeProject(s.id);
    expect((await readSkill(current.id))?.isError).toBe(true);
  });

  it("hides a disabled optional skill but keeps the required one", async () => {
    const s = await site();
    const { agent, settled } = service({ disabledSkills: () => ["content-writing", "theme-design"] });
    const session = agent.create(s.id);
    let seen: unknown;
    faux.setResponses([
      (context) => {
        seen = context;
        return pi.ai.fauxAssistantMessage("done");
      },
    ]);
    const done = settled(session.id);
    await agent.send(session.id, "Hi");
    await done;

    const skills = [...systemSections(seen).skills.matchAll(/<name>([^<]+)<\/name>/g)].map((m) => m[1]);
    expect(skills).not.toContain("content-writing");
    expect(skills).toContain("site-editing");
    // Sites load the design rules too, for changes to their theme, and they cannot be turned off.
    expect(skills).toContain("theme-design");
    expect(systemSections(seen).preamble).toContain("read the\n  theme-design skill");
    expect(skills).toHaveLength(skillNames("site").length - 1);
  });

  it("gives sessions the six gated tools and no bash", async () => {
    const s = await site();
    const { agent, events, settled } = service();
    const session = agent.create(s.id);
    const call = pi.ai.fauxToolCall;
    faux.setResponses([
      pi.ai.fauxAssistantMessage(
        [
          call("write", { path: "content/ai.md", content: "# From AI\n" }),
          call("read", { path: "~/.bukitjalil/pi/auth.json" }),
          call("read", { path: "../../../pi/auth.json" }),
          call("ls", {}),
          call("find", { pattern: "*.yaml" }),
          call("grep", { pattern: "title" }),
          call("bash", { command: "echo hi" }),
        ],
        { stopReason: "toolUse" },
      ),
      pi.ai.fauxAssistantMessage(
        [call("edit", { path: "content/ai.md", edits: [{ oldText: "From AI", newText: "Edited" }] })],
        {
          stopReason: "toolUse",
        },
      ),
      pi.ai.fauxAssistantMessage("done"),
    ]);
    const done = settled(session.id);
    await agent.send(session.id, "Make a page");
    await done;

    const ends = events.flatMap((e) => (e.type === "pi" && e.event.type === "tool_execution_end" ? [e.event] : []));
    const result = (name: string) => ends.filter((e) => e.toolName === name);
    const text = (e: (typeof ends)[number]) => JSON.stringify(e.result);
    for (const name of ["write", "ls", "find", "edit"]) {
      expect(result(name)).toHaveLength(1);
      expect(result(name)[0]?.isError, `${name}: ${text(result(name)[0] as never)}`).toBe(false);
    }
    expect(result("read").map((e) => e.isError)).toEqual([true, true]);
    expect(result("grep")[0]).toMatchObject({ isError: true });
    expect(text(result("grep")[0] as never)).toContain("rg");
    expect(result("bash")[0]).toMatchObject({ isError: true });
    expect(text(result("ls")[0] as never)).toContain("site.yaml");
    const listing = result("ls")[0]?.result as { content: { text: string }[] } | undefined;
    const entries = listing?.content[0]?.text.split("\n");
    expect(entries).not.toContain(".git");
    expect(text(result("find")[0] as never)).toContain("site.yaml");
    const ai = path.join(ctx.paths.worktrees, s.id, "ai");
    expect(fs.readFileSync(path.join(ai, "content", "ai.md"), "utf8")).toBe("# Edited\n");
  });

  it("gives sessions the site tools and read-only skills", async () => {
    const s = await site();
    const { agent, events, settled } = service();
    const session = agent.create(s.id);
    const call = pi.ai.fauxToolCall;
    const skill = path.join(fs.realpathSync(SKILLS), "bukitjalil", "site-editing", "SKILL.md");
    faux.setResponses([
      pi.ai.fauxAssistantMessage(
        [
          call("site_info", {}),
          call("list_content", { collection: "page" }),
          call("read", { path: skill }),
          call("write", { path: skill, content: "changed" }),
          call("ls", { path: path.dirname(skill) }),
          call("bukit_check", {}),
          call("summarize_changes", { summary: "Changed the title." }),
        ],
        { stopReason: "toolUse" },
      ),
      pi.ai.fauxAssistantMessage("done"),
    ]);
    const done = settled(session.id);
    await agent.send(session.id, "Look around");
    await done;

    const ends = events.flatMap((e) => (e.type === "pi" && e.event.type === "tool_execution_end" ? [e.event] : []));
    const byName = (name: string) => ends.find((e) => e.toolName === name);
    const text = (name: string) => JSON.stringify(byName(name)?.result);
    for (const name of ["site_info", "list_content", "read", "summarize_changes"]) {
      expect(byName(name)?.isError, `${name}: ${text(name)}`).toBe(false);
    }
    expect(text("site_info")).toContain(`Site ${siteCount}`);
    expect(text("list_content")).toContain("content/pages/about.md");
    expect(text("read")).toContain("Site editing in BukitJalil");
    // Skills can be read, not written or listed.
    expect(byName("write")?.isError).toBe(true);
    expect(byName("ls")?.isError).toBe(true);
    expect(fs.readFileSync(skill, "utf8")).not.toBe("changed");
    // No Bukit in this app: the tool says so instead of failing the run.
    expect(byName("bukit_check")?.isError).toBe(true);
    expect(text("bukit_check")).toContain("Bukit is not installed");
    expect(events.filter((e) => e.type === "summary")).toEqual([
      { project: s.id, sessionId: session.id, type: "summary", summary: "Changed the title." },
    ]);
  });

  it("gives a theme project session the theme prompt, skill and tool, and writes only theme paths", async () => {
    const dir = path.join(base, "home", `theme${++siteCount}`);
    writeStarter(dir, { title: "Theme", language: "en-US" });
    fs.renameSync(path.join(dir, "themes", "starter"), path.join(dir, "themes", "aurora"));
    fs.writeFileSync(
      path.join(dir, "site.yaml"),
      fs.readFileSync(path.join(dir, "site.yaml"), "utf8").replace("  name: starter\n", "  name: aurora\n"),
    );
    fs.writeFileSync(
      path.join(dir, "themes", "aurora", "theme.yaml"),
      fs
        .readFileSync(path.join(dir, "themes", "aurora", "theme.yaml"), "utf8")
        .replace(/^name: starter$/m, "name: aurora"),
    );
    rawGit(base, dir, "init", "-q", "-b", "main");
    commitAllAs(base, dir);
    const real = fs.realpathSync(dir);
    const t = await ctx.repos.reserved(real, () =>
      ctx.themes.register(real, {
        name: "Theme",
        themeName: "aurora",
        defaultBranch: "main",
        configFile: "site.yaml",
        origin: "new",
      }),
    );
    await ctx.builds.settled();
    const { agent, events, settled } = service();
    const session = agent.create(themeKey(t.id));
    const call = pi.ai.fauxToolCall;
    let seen: unknown;
    faux.setResponses([
      (context) => {
        seen = context;
        return pi.ai.fauxAssistantMessage(
          [
            call("write", { path: "themes/aurora/tokens.yaml", content: "colors:\n  accent: '#0969da'\n" }),
            call("write", { path: "content/posts/new.md", content: "---\ntitle: New\n---\n" }),
            call("edit", { path: "site.yaml", edits: [{ oldText: 'title: "Theme"', newText: 'title: "Aurora"' }] }),
            call("write", { path: "layouts/pages/index.html", content: "x" }),
            call("write", { path: "themes/other/theme.yaml", content: "name: other\n" }),
            call("write", { path: "_reference/note.md", content: "x" }),
            call("write", { path: "static/404.html", content: "x" }),
            call("theme_coverage", {}),
            call("theme_lint", {}),
          ],
          { stopReason: "toolUse" },
        );
      },
      pi.ai.fauxAssistantMessage("done"),
    ]);
    const done = settled(session.id);
    await agent.send(session.id, "Start the theme", { images: [{ mimeType: "image/png", data: PNG }] });
    await done;

    const system = systemOf(seen, "theme");
    expect(system.preamble).toContain("BukitJalil theme assistant");
    expect(system.preamble).toContain("themes/aurora/");
    expect(system.skills).toContain("theme-development");
    expect(system.skills).toContain("<name>theme-design</name>");
    expect(system.preamble).toContain("theme-development and theme-design skills");
    expect(system.skills).not.toContain("<name>publishing</name>");
    const ends = events.flatMap((e) => (e.type === "pi" && e.event.type === "tool_execution_end" ? [e.event] : []));
    // Tool results end in any order: two writes inside the scope, four outside it.
    const writes = ends.filter((e) => e.toolName === "write").map((e) => e.isError);
    expect(writes.filter((error) => !error)).toHaveLength(2);
    expect(writes.filter((error) => error)).toHaveLength(4);
    expect(ends.find((e) => e.toolName === "edit")?.isError).toBe(false);
    const refused = ends.find((e) => e.toolName === "write" && e.isError);
    expect(JSON.stringify(refused?.result)).toContain("only themes/aurora, content, site.yaml");
    const coverage = ends.find((e) => e.toolName === "theme_coverage");
    expect(coverage?.isError).toBe(false);
    // The tools of one turn run together, so coverage saw the starter theme before tokens.yaml was written.
    expect((coverage?.result as { details: unknown } | undefined)?.details).toMatchObject({
      theme: "themes/aurora",
      missingPageTypes: [],
      missingTemplateFiles: [],
      missingIncludes: [],
      searchPage: true,
      notFoundPage: false,
    });
    const lint = ends.find((e) => e.toolName === "theme_lint");
    expect(lint?.isError).toBe(false);
    expect((lint?.result as { details: { issues: unknown } } | undefined)?.details.issues).toBeInstanceOf(Array);
    const ai = path.join(ctx.paths.worktrees, "themes", t.id, "ai");
    expect(fs.existsSync(path.join(ai, "themes", "aurora", "tokens.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(ai, "layouts"))).toBe(false);
    // The attached image went to the model and into _reference/; the AI's own write there was refused.
    const refs = fs.readdirSync(path.join(ai, "_reference"));
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatch(/^ref-.*\.png$/);
    expect(JSON.stringify(seen)).toContain(`saved in the project as _reference/${refs[0]}`);
    expect(JSON.stringify(seen)).toContain('"type":"image"');
  });

  it("sends attached images to a model that reads them, and refuses them for one that does not", async () => {
    const s = await site();
    const { agent, settled } = service();
    const session = agent.create(s.id);
    let seen: unknown;
    faux.setResponses([
      (context) => {
        seen = context;
        return pi.ai.fauxAssistantMessage("Nice picture");
      },
    ]);
    const done = settled(session.id);
    await agent.send(session.id, "Like this", { images: [{ mimeType: "image/webp", data: PNG }] });
    await done;
    const user = (seen as { messages: { role: string; content: unknown }[] }).messages.find((x) => x.role === "user");
    expect(user?.content).toEqual([
      { type: "text", text: "Like this" },
      { type: "image", mimeType: "image/png", data: PNG },
    ]);
    // A site keeps images only in the session file.
    expect(fs.existsSync(path.join(ctx.paths.worktrees, s.id, "ai", "_reference"))).toBe(false);
    expect(JSON.stringify(agent.store.entries(session.id))).toContain(PNG);

    const textOnly = service({ textOnly: true }).agent;
    const other = textOnly.create(s.id);
    await expect(textOnly.send(other.id, "Look", { images: [{ mimeType: "image/png", data: PNG }] })).rejects.toThrow(
      expect.objectContaining({ code: "image.model_unsupported" }),
    );
    await expect(
      textOnly.send(other.id, "Look", { images: [{ mimeType: "image/png", data: "AAAA" }] }),
    ).rejects.toThrow(expect.objectContaining({ code: "image.unsupported_type" }));
  });

  it("lets grep run only while the rg check passes", async () => {
    const s = await site();
    let ready = false;
    let asked = 0;
    const { agent, events, settled } = service({
      rgReady: () => {
        asked++;
        return ready;
      },
    });
    const session = agent.create(s.id);
    const grep = () =>
      faux.setResponses([
        pi.ai.fauxAssistantMessage([pi.ai.fauxToolCall("grep", { pattern: "title" })], { stopReason: "toolUse" }),
        pi.ai.fauxAssistantMessage("done"),
      ]);
    const grepResults = () =>
      events.flatMap((e) =>
        e.type === "pi" && e.event.type === "tool_execution_end" && e.event.toolName === "grep"
          ? [JSON.stringify(e.event.result)]
          : [],
      );

    grep();
    let done = settled(session.id);
    await agent.send(session.id, "Search");
    await done;
    expect(asked).toBe(1);
    expect(grepResults()[0]).toContain("failed its check");

    ready = true;
    grep();
    done = settled(session.id);
    await agent.send(session.id, "Search again");
    await done;
    expect(asked).toBe(2);
    expect(grepResults()[1]).not.toContain("failed its check");
  });

  it("ignores Pi and agent files committed in the site", async () => {
    const marker = path.join(base, "extension-ran");
    const s = await site({
      "AGENTS.md": "AGENTS-MARKER",
      "CLAUDE.md": "CLAUDE-MARKER",
      ".pi/SYSTEM.md": "SYSTEM-MARKER",
      ".pi/APPEND_SYSTEM.md": "APPEND-MARKER",
      ".pi/extensions/evil.js": `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "x"); module.exports = () => {};`,
      ".pi/skills/evil/SKILL.md": "---\nname: evil\ndescription: SKILL-MARKER\n---\nbody\n",
      ".agents/skills/evil2/SKILL.md": "---\nname: evil2\ndescription: AGENTS-SKILL-MARKER\n---\nbody\n",
      ".pi/settings.json": JSON.stringify({ cacheWarming: "idle" }),
    });
    const { agent, settled } = service();
    const session = agent.create(s.id);
    let seen: unknown;
    faux.setResponses([
      (context) => {
        seen = context;
        return pi.ai.fauxAssistantMessage("ok");
      },
    ]);
    const done = settled(session.id);
    await agent.send(session.id, "Hi");
    await done;
    const system = systemOf(seen);
    expect(system.preamble).toContain("BukitJalil site assistant");
    const all = JSON.stringify(seen);
    for (const m of ["AGENTS-MARKER", "CLAUDE-MARKER", "SYSTEM-MARKER", "APPEND-MARKER", "SKILL-MARKER"]) {
      expect(all).not.toContain(m);
    }
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("reopens a session from the database with the earlier messages", async () => {
    const s = await site();
    const first = service({ idleMs: 10 });
    const session = first.agent.create(s.id);
    faux.setResponses([pi.ai.fauxAssistantMessage("FIRST-ANSWER")]);
    let done = first.settled(session.id);
    await first.agent.send(session.id, "first");
    await done;
    await first.agent.shutdown();
    const before = await first.agent.messages(session.id);

    // A new service has nothing in memory, as after the idle timeout or a restart.
    const second = service();
    let seen = "";
    faux.setResponses([
      (context) => {
        seen = JSON.stringify(context);
        return pi.ai.fauxAssistantMessage("second answer");
      },
    ]);
    done = second.settled(session.id);
    await second.agent.send(session.id, "second");
    await done;
    expect(seen).toContain("first");
    expect(seen).toContain("FIRST-ANSWER");
    expect(seen).toContain("second");
    // The restored branch is the saved one, with the new turn after it.
    expect((await second.agent.messages(session.id)).slice(0, before.length)).toEqual(before);
  });

  it("tells the model, and only the model, that the working copy was reset since its last turn", async () => {
    const s = await site();
    const { agent, settled, events } = service();
    const session = agent.create(s.id);
    const contexts: string[] = [];
    const answer = (text: string) => (context: unknown) => {
      contexts.push(JSON.stringify(context));
      return pi.ai.fauxAssistantMessage(text);
    };
    const send = async (text: string) => {
      const done = settled(session.id);
      await agent.send(session.id, text);
      await done;
    };
    faux.setResponses([answer("one")]);
    await send("first");
    expect(contexts[0]).not.toContain("working copy was reset");

    // The change set this conversation worked in is rejected: the next run starts a new one.
    const open = ctx.changes.store.open(s.id);
    if (!open) throw new Error("no change set");
    await ctx.changes.reject(open.id);
    // A run that joined the new change set but ended before sending the note does not lose it.
    await ctx.changes.begin(s.id, session.id);
    faux.setResponses([answer("two")]);
    await send("second");
    expect(contexts[1]).toContain("working copy was reset");
    expect(contexts[1]).toContain("the latest main version");
    expect(contexts[1]).toContain("was closed without being applied");
    expect(contexts[1]?.indexOf("working copy was reset")).toBeLessThan(contexts[1]?.indexOf("second") ?? -1);

    // Once per new change set, and never in the transcript the user sees.
    faux.setResponses([answer("three")]);
    await send("third");
    expect(contexts[2]?.split("working copy was reset").length).toBe(2);
    expect(JSON.stringify(await agent.messages(session.id))).not.toContain("working copy was reset");
    // Pi reports the note as a message; the browser is not sent it.
    expect(JSON.stringify(events)).toContain("working copy was reset");
    const translate = agentEventTranslator();
    expect(JSON.stringify(events.flatMap(translate))).not.toContain("working copy was reset");
  });

  it("runs one session per site at a time and queues the others", async () => {
    const s = await site();
    const { agent, events, settled } = service();
    const a = agent.create(s.id);
    const b = agent.create(s.id);
    const slow = gated("a done");
    faux.setResponses([slow.step, pi.ai.fauxAssistantMessage("b done")]);
    const doneA = settled(a.id);
    const doneB = settled(b.id);
    await agent.send(a.id, "from a");
    await agent.send(b.id, "from b");
    await agent.send(b.id, "more from b");
    expect(agent.status(a.id)).toBe("running");
    expect(agent.status(b.id)).toBe("queued");
    slow.release();
    await Promise.all([doneA, doneB]);
    const order = events
      .filter((e) => e.type === "status")
      .map((e) => `${e.sessionId === a.id ? "a" : "b"}:${e.type === "status" && e.status}`);
    expect(order).toEqual(["a:running", "b:queued", "b:queued", "a:idle", "b:running", "b:idle"]);
    // Messages sent while waiting are joined into one run.
    const file = JSON.stringify(agent.store.entries(b.id));
    expect(file).toContain("from b");
    expect(file).toContain("more from b");
  });

  it("adds a message for a session that is still opening to its current run", async () => {
    const s = await site();
    const { agent, settled, statuses } = service();
    const session = agent.create(s.id);
    const contexts: string[] = [];
    faux.setResponses([
      (context) => {
        contexts.push(JSON.stringify(context));
        return pi.ai.fauxAssistantMessage("one done");
      },
      (context) => {
        contexts.push(JSON.stringify(context));
        return pi.ai.fauxAssistantMessage("two done");
      },
    ]);
    const done = settled(session.id);
    await agent.send(session.id, "one");
    await agent.send(session.id, "two");
    await done;
    expect(statuses(session.id)).toEqual(["running", "idle"]);
    expect(contexts).toHaveLength(2);
    expect(contexts[1]).toContain("one done");
    expect(contexts[1]).toContain("two");
  });

  it("runs a message sent while the run is finishing instead of dropping it", async () => {
    const s = await site();
    let finishing!: () => void;
    const reached = new Promise<void>((r) => {
      finishing = r;
    });
    let release!: () => void;
    const hold = new Promise<void>((r) => {
      release = r;
    });
    let first = true;
    const { agent, events } = service({
      settled: async () => {
        if (!first) return;
        first = false;
        finishing();
        await hold;
      },
    });
    const session = agent.create(s.id);
    const contexts: string[] = [];
    faux.setResponses([
      pi.ai.fauxAssistantMessage("one done"),
      (context) => {
        contexts.push(JSON.stringify(context));
        return pi.ai.fauxAssistantMessage("two done");
      },
    ]);
    const statuses = () => events.flatMap((e) => (e.sessionId === session.id && e.type === "status" ? [e.status] : []));
    await agent.send(session.id, "one");
    await reached;
    // The prompt loop has ended; the run is still finishing (Bukit settling, the snapshot).
    expect(agent.status(session.id)).toBe("running");
    await agent.send(session.id, "two");
    release();
    await vi.waitFor(() => expect(statuses().at(-1)).toBe("idle"), { timeout: 10_000 });
    // Between the runs the session is waiting, not idle.
    expect(statuses().filter((st) => st !== "queued")).toEqual(["running", "running", "idle"]);
    expect(statuses()).toContain("queued");
    expect(contexts).toHaveLength(1);
    expect(contexts[0]).toContain("two");
  });

  it("does not start another run for a message sent while a failed run is finishing", async () => {
    const s = await site();
    let finishing!: () => void;
    const reached = new Promise<void>((r) => {
      finishing = r;
    });
    let release!: () => void;
    const hold = new Promise<void>((r) => {
      release = r;
    });
    const { agent, settled } = service({
      settled: async () => {
        finishing();
        await hold;
      },
    });
    const session = agent.create(s.id);
    const begin = vi.spyOn(ctx.changes, "begin").mockRejectedValueOnce(new Error("disk full"));
    const calls: string[] = [];
    faux.setResponses([
      () => {
        calls.push("prompted");
        return pi.ai.fauxAssistantMessage("should not run");
      },
    ]);
    try {
      const done = settled(session.id);
      await agent.send(session.id, "one");
      await reached;
      await agent.send(session.id, "two");
      release();
      expect(await done).toMatchObject({ status: "idle", error: "server.internal" });
      await new Promise((r) => setTimeout(r, 100));
      expect(agent.status(session.id)).toBe("idle");
      expect(begin).toHaveBeenCalledTimes(1);
      expect(calls).toEqual([]);
    } finally {
      begin.mockRestore();
    }
  });

  it("stops a session that is still opening before it prompts", async () => {
    const s = await site();
    const { agent, settled, statuses } = service();
    const session = agent.create(s.id);
    let called = false;
    faux.setResponses([
      () => {
        called = true;
        return pi.ai.fauxAssistantMessage("should not run");
      },
    ]);
    const done = settled(session.id);
    await agent.send(session.id, "Hi");
    await agent.stop(session.id);
    await done;
    expect(called).toBe(false);
    expect(agent.store.entries(session.id)).toEqual([]);
    expect(statuses(session.id)).toEqual(["running", "idle"]);
  });

  it("stops a waiting session without running it", async () => {
    const s = await site();
    const { agent, settled, statuses } = service();
    const a = agent.create(s.id);
    const b = agent.create(s.id);
    const slow = gated("a done");
    faux.setResponses([slow.step]);
    const doneA = settled(a.id);
    await agent.send(a.id, "from a");
    await agent.send(b.id, "from b");
    await agent.stop(b.id);
    expect(agent.status(b.id)).toBe("idle");
    expect(statuses(b.id)).toEqual(["queued", "idle"]);
    slow.release();
    await doneA;
    expect(agent.store.entries(b.id)).toEqual([]);
  });

  it("refuses to send without a model or to a read-only site", async () => {
    const s = await site();
    const noModel = service({ model: false });
    const session = noModel.agent.create(s.id);
    await expect(noModel.agent.send(session.id, "Hi")).rejects.toMatchObject({ code: "agent.no_model" });
    expect(noModel.agent.status(session.id)).toBe("idle");

    const { agent } = service();
    ctx.sites.store.setState(s.id, { readOnly: [{ code: "plugin_files" }], checkedCommit: null, configCheck: null });
    await expect(agent.send(session.id, "Hi")).rejects.toMatchObject({ code: "site.read_only" });
  });

  it("waits while another operation holds the site lock, and holds it for the whole run", async () => {
    const s = await site();
    const { agent, settled, statuses } = service();
    const session = agent.create(s.id);
    const release = ctx.locks.acquire(s.id, "build");
    faux.setResponses([pi.ai.fauxAssistantMessage("done")]);
    const done = settled(session.id);
    await agent.send(session.id, "Hi");
    await new Promise((r) => setTimeout(r, 100));
    // Queued, not failed: nothing started, the checkout was not touched.
    expect(agent.status(session.id)).toBe("queued");
    expect(statuses(session.id)).toEqual(["queued"]);
    expect(fs.existsSync(path.join(ctx.paths.worktrees, s.id, "ai"))).toBe(false);

    // Held from start to end: other operations get site.busy meanwhile.
    let during: unknown = null;
    const stop = agent.subscribe((e) => {
      if (e.sessionId === session.id && e.type === "status" && e.status === "running") {
        try {
          ctx.locks.acquire(s.id, "other")();
        } catch (err) {
          during = err;
        }
      }
    });
    release();
    expect(await done).toEqual({ project: s.id, sessionId: session.id, type: "status", status: "idle" });
    stop();
    expect(during).toMatchObject({ code: "site.busy", params: { operation: "session" } });
    expect(ctx.locks.holder(s.id)).toBeNull();
    expect(statuses(session.id)).toEqual(["queued", "running", "idle"]);
  });

  it("lists, renames and deletes sessions", async () => {
    const s = await site();
    const { agent, settled } = service();
    const one = agent.create(s.id);
    const two = agent.create(s.id);
    expect(
      agent
        .list(s.id)
        .map((x) => x.id)
        .sort(),
    ).toEqual([one.id, two.id].sort());
    expect(agent.rename(one.id, "Homepage").title).toBe("Homepage");

    faux.setResponses([pi.ai.fauxAssistantMessage("ok")]);
    const done = settled(one.id);
    await agent.send(one.id, "Hi");
    await done;
    expect(agent.store.entries(one.id).length).toBeGreaterThan(1);
    await agent.delete(one.id);
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM session_entries WHERE session_id = ?").get(one.id)).toEqual({
      n: 0,
    });
    expect(() => agent.get(one.id)).toThrow(SiteError);
    expect(() => agent.get("../../etc")).toThrow(SiteError);
    expect(agent.list(s.id).map((x) => x.id)).toEqual([two.id]);
  });

  it("deletes a session that is still opening without writing its file", async () => {
    const s = await site();
    const { agent, settled } = service();
    const session = agent.create(s.id);
    let called = false;
    faux.setResponses([
      () => {
        called = true;
        return pi.ai.fauxAssistantMessage("should not run");
      },
    ]);
    const done = settled(session.id);
    await agent.send(session.id, "Hi");
    await agent.delete(session.id);
    await done;
    expect(called).toBe(false);
    expect(agent.store.entries(session.id)).toEqual([]);
  });

  it("stops a site's sessions and waits for them when the site is removed", async () => {
    const s = await site();
    const { agent, statuses } = service();
    const a = agent.create(s.id);
    const b = agent.create(s.id);
    const slow = gated("a done");
    faux.setResponses([slow.step]);
    await agent.send(a.id, "from a");
    await slow.started;
    await agent.send(b.id, "from b");
    const removing = ctx.sites.remove(s.id);
    slow.release();
    await removing;
    expect(statuses(a.id).at(-1)).toBe("idle");
    expect(statuses(b.id)).toEqual(["queued", "idle"]);
    expect(() => agent.get(a.id)).toThrow(SiteError);
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM session_entries WHERE session_id = ?").get(a.id)).toEqual({
      n: 0,
    });
    expect(fs.existsSync(path.join(ctx.paths.worktrees, s.id))).toBe(false);
  });

  it("waits for running sessions on shutdown", async () => {
    const s = await site();
    const { agent, statuses } = service();
    const session = agent.create(s.id);
    const slow = gated("done");
    faux.setResponses([slow.step]);
    await agent.send(session.id, "Hi");
    await slow.started;
    const closing = agent.shutdown();
    slow.release();
    await closing;
    expect(statuses(session.id)).toEqual(["running", "idle"]);
    await expect(agent.send(session.id, "again")).rejects.toMatchObject({ code: "server.shutting_down" });
  });

  it("does not crash when a session cannot be disposed", () => {
    const { agent } = service();
    const internals = agent as unknown as {
      live: Map<string, { project: string; session: { dispose(): void }; unsubscribe: () => void; idleTimer: null }>;
      dispose(id: string): void;
    };
    internals.live.set("fake", {
      project: "site",
      session: {
        dispose() {
          throw new Error("disk full");
        },
      },
      unsubscribe: () => {},
      idleTimer: null,
    });
    expect(() => internals.dispose("fake")).not.toThrow();
    expect(internals.live.has("fake")).toBe(false);
  });

  it("stops waiting for a run that ignores abort", async () => {
    const s = await site();
    const { agent } = service({ shutdownMs: 20 });
    const session = agent.create(s.id);
    const internals = agent as unknown as {
      running: Map<
        string,
        { sessionId: string; cancelled: boolean; extra: string[]; cwd: string | null; done: Promise<void> }
      >;
    };
    internals.running.set(s.id, {
      sessionId: session.id,
      cancelled: false,
      extra: [],
      cwd: null,
      done: new Promise<void>(() => {}),
    });
    const started = Date.now();
    await agent.shutdown();
    expect(Date.now() - started).toBeLessThan(1000);
    internals.running.delete(s.id);
  });

  it("gives read-only sites no sessions", async () => {
    const s = await site({ "plugins/x/plugin.yaml": "id: x\n" });
    expect(s.readOnly).not.toBeNull();
    const { agent } = service();
    expect(() => agent.create(s.id)).toThrow(expect.objectContaining({ code: "site.read_only" }));
  });
});

describe("content management conversations", () => {
  const DB = "0123456789abcdef0123456789abcdef";
  let sourceCount = 0;
  const source = () =>
    ctx.dataSources.create({
      platform: "notion",
      name: `Notes ${++sourceCount}`,
      token: `ntn_contentagenttoken${sourceCount}`,
    });

  it("belong to a Notion database and run with no files, lock, change set or skills, only the content tools", async () => {
    const ds = source();
    const key = contentKey({ sourceId: ds.id, databaseId: DB });
    const { agent, settled, statuses } = service({ content: true });
    const session = agent.create(key);
    expect(agent.listInfo(key).map((s) => s.id)).toEqual([session.id]);
    expect(agent.info(session.id).project).toBe(key);

    let seen: unknown;
    faux.setResponses([
      (context) => {
        seen = context;
        return pi.ai.fauxAssistantMessage("Hello from the content assistant");
      },
    ]);
    const done = settled(session.id);
    await agent.send(session.id, "Hi");
    const end = await done;
    expect(end.type === "status" && end.error).toBeFalsy();
    const messages = (seen as { messages: { role: string; sections?: Record<string, string> }[] }).messages;
    const sections = messages.find((m) => m.role === "system")?.sections ?? {};
    expect(Object.keys(sections).sort()).toEqual(["cwd", "preamble"]);
    const system = sections.preamble ?? "";
    expect(system).toContain("BukitJalil content assistant");
    expect(system).toContain(`"Notes ${sourceCount}"`);
    expect(system).not.toContain("SKILL.md");
    expect(statuses(session.id)).toEqual(["running", "idle"]);
    expect(JSON.stringify(agent.store.entries(session.id))).toContain("Hello from the content assistant");
    expect(ctx.locks.holder(key)).toBeNull();

    await expect(agent.send(session.id, "this one", { entryId: "not-an-id" })).rejects.toMatchObject({
      code: "request.invalid_body",
    });
    // No images, and a session is forked within its database.
    await expect(
      agent.send(session.id, "look", { images: [{ data: PNG, mimeType: "image/png" }] }),
    ).rejects.toMatchObject({ code: "request.invalid_body" });
    const entry = (await agent.messages(session.id))[0]?.entryId ?? "";
    expect((await agent.fork(session.id, entry)).project).toBe(key);

    // The content tools are there (this test's Notion is offline, so the call fails), and file tools are not.
    faux.setResponses([
      pi.ai.fauxAssistantMessage([pi.ai.fauxToolCall("read_schema", {}), pi.ai.fauxToolCall("read", { path: "x" })], {
        stopReason: "toolUse",
      }),
      pi.ai.fauxAssistantMessage("done"),
    ]);
    const second = settled(session.id);
    await agent.send(session.id, "fields?");
    await second;
    const results = agent.store.entries(session.id).flatMap((e) => {
      const m = (e as { message?: { role?: string; toolName?: string; content?: { text?: string }[] } }).message;
      return m?.role === "toolResult" ? [`${m.toolName}: ${m.content?.[0]?.text ?? ""}`] : [];
    });
    expect(results).toHaveLength(2);
    expect(results.find((r) => r.startsWith("read_schema"))).not.toMatch(/not found/i);
    expect(results.find((r) => r.startsWith("read:"))).toMatch(/not found/i);
  });

  it("propose changes that only the user's confirmation writes, and tell the model what was decided", async () => {
    const ds = source();
    const key = contentKey({ sourceId: ds.id, databaseId: DB });
    const ENTRY = "11111111111111111111111111111111";
    const writes: string[] = [];
    const page = {
      id: ENTRY,
      databaseId: DB,
      title: "Hello",
      url: null,
      lastEditedTime: "t1",
      properties: [{ name: "Name", type: "title", value: { type: "title", text: "Hello" }, display: "Hello" }],
    };
    const content = {
      database: async () => ({
        id: DB,
        title: "Blog",
        url: null,
        properties: [{ name: "Name", type: "title", editable: true }],
        propertiesTruncated: false,
      }),
      page: async () => page,
      update: async (_s: string, _d: string, id: string, req: { lastEditedTime: string }) => {
        writes.push(`update ${id} ${req.lastEditedTime}`);
        return page;
      },
    } as unknown as NotionContentService;
    const { agent, settled } = service({ content });
    const session = agent.create(key);
    faux.setResponses([
      pi.ai.fauxAssistantMessage(
        [
          pi.ai.fauxToolCall(
            "propose_update",
            { lastEditedTime: "t1", properties: { Name: "Hello again" } },
            { id: "p1" },
          ),
          pi.ai.fauxToolCall("propose_update", { lastEditedTime: "t1", properties: { Name: "Other" } }, { id: "p2" }),
        ],
        { stopReason: "toolUse" },
      ),
      pi.ai.fauxAssistantMessage("Proposed"),
    ]);
    const first = settled(session.id);
    await agent.send(session.id, "rename this", { entryId: ENTRY });
    await first;
    expect(writes).toEqual([]);
    expect(await agent.proposals(session.id)).toEqual([
      { callId: "p1", status: "pending", entryId: null, error: null },
      { callId: "p2", status: "pending", entryId: null, error: null },
    ]);
    expect(await agent.applyProposal(session.id, "p1")).toMatchObject({ status: "applied", entryId: ENTRY });
    expect(writes).toEqual([`update ${ENTRY} t1`]);
    expect(await agent.rejectProposal(session.id, "p2")).toMatchObject({ status: "rejected" });
    await expect(agent.applyProposal(session.id, "nope")).rejects.toMatchObject({ code: "content.proposal_not_found" });
    // A fork shares the decisions: it cannot write p1 again.
    const forked = await agent.fork(session.id, (await agent.messages(session.id)).at(-1)?.entryId ?? "");
    await expect(agent.applyProposal(forked.id, "p1")).rejects.toMatchObject({ code: "content.proposal_decided" });

    // The next message carries the decisions to the model, once; the transcript does not show them.
    const seen: string[] = [];
    const reply = (context: { messages: unknown[] }) => {
      seen.push(JSON.stringify(context.messages));
      return pi.ai.fauxAssistantMessage("ok");
    };
    faux.setResponses([reply, reply]);
    let done = settled(session.id);
    await agent.send(session.id, "thanks");
    await done;
    done = settled(session.id);
    await agent.send(session.id, "and?");
    await done;
    expect(seen[0]).toContain(`p1: written to Notion (entry ${ENTRY})`);
    expect(seen[0]).toContain("p2: declined by the user");
    expect(seen[1]?.match(/p1: written to Notion/g)).toHaveLength(1);
    expect(JSON.stringify(await agent.messages(session.id))).not.toContain("decisions on your proposals");
    // Not for site conversations.
    const siteSession = agent.create((await site()).id);
    await expect(agent.proposals(siteSession.id)).rejects.toMatchObject({ code: "session.not_found" });
  });

  it("keep each message's open entry with that message, so a follow-up does not move the running turn", async () => {
    const ds = source();
    const key = contentKey({ sourceId: ds.id, databaseId: DB });
    const A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const read: string[] = [];
    const content = {
      page: async (_s: string, _d: string, id: string) => {
        read.push(id);
        return { id, databaseId: DB, title: id.slice(0, 1), url: null, lastEditedTime: "t", properties: [] };
      },
      body: async () => ({ blocks: [], editable: true, unsupported: [], lastEditedTime: "t" }),
    } as unknown as NotionContentService;
    const { agent, settled } = service({ content });
    const session = agent.create(key);
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let started!: () => void;
    const running = new Promise<void>((r) => {
      started = r;
    });
    const readOpen = () =>
      pi.ai.fauxAssistantMessage([pi.ai.fauxToolCall("read_entry", {})], { stopReason: "toolUse" });
    faux.setResponses([
      async () => {
        started();
        await gate;
        return readOpen();
      },
      pi.ai.fauxAssistantMessage("A done"),
      readOpen(),
      pi.ai.fauxAssistantMessage("B done"),
    ]);
    const done = settled(session.id);
    await agent.send(session.id, "about A", { entryId: A });
    await running;
    // The user opens B and sends a follow-up while A's turn still runs.
    await agent.send(session.id, "now B", { entryId: B, followUp: true });
    release();
    await done;
    await vi.waitFor(() => expect(read).toEqual([A, B]));
  });

  it("tell a follow-up what the user decided while the turn before it ran", async () => {
    const ds = source();
    const key = contentKey({ sourceId: ds.id, databaseId: DB });
    const ENTRY = "cccccccccccccccccccccccccccccccc";
    const page = {
      id: ENTRY,
      databaseId: DB,
      title: "C",
      url: null,
      lastEditedTime: "t",
      properties: [{ name: "Name", type: "title", value: { type: "title", text: "C" }, display: "C" }],
    };
    const content = {
      database: async () => ({ id: DB, title: "Blog", url: null, properties: [], propertiesTruncated: false }),
      page: async () => page,
    } as unknown as NotionContentService;
    const { agent, settled } = service({ content });
    const session = agent.create(key);
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let proposed!: () => void;
    const waiting = new Promise<void>((r) => {
      proposed = r;
    });
    let seen = "";
    faux.setResponses([
      pi.ai.fauxAssistantMessage(
        [pi.ai.fauxToolCall("propose_update", { lastEditedTime: "t", properties: { Name: "D" } }, { id: "q1" })],
        { stopReason: "toolUse" },
      ),
      async () => {
        proposed();
        await gate;
        return pi.ai.fauxAssistantMessage("proposed");
      },
      (context) => {
        seen = JSON.stringify(context.messages);
        return pi.ai.fauxAssistantMessage("ok");
      },
    ]);
    const done = settled(session.id);
    await agent.send(session.id, "rename", { entryId: ENTRY });
    await waiting;
    await agent.rejectProposal(session.id, "q1");
    await agent.send(session.id, "why not?", { entryId: ENTRY, followUp: true });
    release();
    await done;
    await vi.waitFor(() => expect(seen).toContain("q1: declined by the user"));
  });

  it("go with their data source, and need the content agent", async () => {
    const ds = source();
    const key = contentKey({ sourceId: ds.id, databaseId: DB });
    const { agent } = service({ content: true });
    const session = agent.create(key);
    ctx.dataSources.remove(ds.id);
    await agent.closeContentSource(ds.id);
    expect(agent.store.get(session.id)).toBeNull();
    expect(() => agent.create(key)).toThrow(expect.objectContaining({ code: "datasource.not_found" }));
    expect(() => service().agent.create(contentKey({ sourceId: source().id, databaseId: DB }))).toThrow(
      expect.objectContaining({ code: "session.not_found" }),
    );
  });
});
