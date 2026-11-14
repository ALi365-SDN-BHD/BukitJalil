import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  ApplyResult,
  Build,
  ChangedFile,
  ChangeSet,
  CurrentChange,
  FileDiff,
  HistoryResponse,
  PreviewResponse,
  RestoreResult,
  ServerEvent,
} from "@bukitjalil/shared";
import type { Api, Model } from "@earendil-works/pi-ai";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { preparePiEnvironment } from "../src/agent/env.ts";
import { loadPi, type PiModules } from "../src/agent/pi.ts";
import { BukitService } from "../src/bukit/locate.ts";
import { MAX_FILES, MAX_PATCH_BYTES } from "../src/changes/diff.ts";
import { listHistory } from "../src/changes/history.ts";
import { applyHunks, parseHunks } from "../src/changes/partial.ts";
import { changeRef, commitText, diffSummary } from "../src/changes/service.ts";
import { PreviewPool } from "../src/preview/pool.ts";
import { copyStarter } from "../src/sites/template.ts";
import { SettingsStore } from "../src/store/settings.ts";
import {
  ADMIN,
  commitAllAs,
  httpGet,
  installAppBukit,
  jsonPut,
  makeApp,
  rawGit,
  req,
  testBukitDir,
} from "./helpers.ts";

// M4 layers 1 to 3, 5 and 6 (plan 7.2, 7.4, 8.4, 9.1, 9.2): change sets. A run opens the site's change set (or joins the open one),
// works in the ai/ checkout, and its result is snapshotted into the change set; the site folder only
// changes when a change set is applied.

const STARTER = path.resolve(import.meta.dirname, "../../../templates/starter");

let base: string;
let ctx: ReturnType<typeof makeApp>;
let pi: PiModules;
let faux: ReturnType<PiModules["ai"]["fauxProvider"]>;
let n = 0;
let settings: SettingsStore;

/**
 * Stand-in Bukit: checks pass unless the checkout has a file named fake-doctor; builds write a page that
 * shows the checkout's `marker` file.
 */
const FAKE_BUKIT = `#!/bin/sh
case "$1" in
  version) echo "bukit 2.2.1+fake"; exit 0;;
  config) echo "config ok"; exit 0;;
  doctor) if [ -f fake-doctor ]; then echo "doctor: template missing"; exit 1; fi; echo "doctor ok"; exit 0;;
  build)
    out=""; prev=""
    for a in "$@"; do if [ "$prev" = "--output" ]; then out="$a"; fi; prev="$a"; done
    mkdir -p "$out"; echo "<h1>home $(cat marker 2>/dev/null)</h1>" > "$out/index.html"; exit 0;;
esac
exit 1
`;

beforeAll(async () => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bj-changes-")));
  fs.mkdirSync(path.join(base, "home"));
  const fakeBin = path.join(base, "fake-bukit");
  fs.writeFileSync(fakeBin, FAKE_BUKIT, { mode: 0o755 });
  const home = path.join(base, "bk");
  installAppBukit(home, fakeBin);
  ctx = makeApp({
    bukit: new BukitService({
      dir: testBukitDir(home),
      tmpDir: path.join(base, "bk-tmp"),
    }),
    userHome: path.join(base, "home"),
    appHome: path.join(base, "app"),
    agent: {
      resolveModel: () => faux.getModel() as Model<Api>,
      setupRuntime: (runtime) => runtime.registerNativeProvider(faux.provider),
    },
  });
  settings = new SettingsStore(ctx.db);
  settings.update({ commitName: "Site Owner", commitEmail: "owner@example.com" });
  preparePiEnvironment(ctx.paths.pi);
  pi = await loadPi(ctx.paths.pi);
  faux = pi.ai.fauxProvider({ provider: "faux", models: [{ id: "faux-1", name: "Faux" }] });
});
afterAll(async () => {
  await ctx.agent.shutdown();
  await ctx.builds.shutdown();
  fs.rmSync(base, { recursive: true, force: true });
});

async function site() {
  const dir = path.join(base, "home", `site${++n}`);
  copyStarter(STARTER, dir, { title: `Site ${n}`, language: "en-US" });
  rawGit(base, dir, "init", "-q", "-b", "main");
  commitAllAs(base, dir);
  const s = await ctx.sites.import({ path: dir });
  await ctx.builds.settled();
  return { ...s, dir, git: (...args: string[]) => rawGit(base, dir, ...args).trim() };
}

/** Send a message and wait until the run, and its snapshot, are over. */
async function run(sessionId: string, text = "Go") {
  const done = new Promise<string | undefined>((resolve) => {
    const stop = ctx.agent.subscribe((e) => {
      if (e.sessionId === sessionId && e.type === "status" && e.status === "idle") {
        stop();
        resolve(e.error);
      }
    });
  });
  await ctx.agent.send(sessionId, text);
  return done;
}

const toolCall = (name: string, args: Parameters<PiModules["ai"]["fauxToolCall"]>[1]) =>
  pi.ai.fauxAssistantMessage([pi.ai.fauxToolCall(name, args)], { stopReason: "toolUse" });

describe("opening and joining a change set", () => {
  it("resets the AI checkout to the default branch, pins the base and records the sessions", async () => {
    const s = await site();
    const head = s.git("rev-parse", "HEAD");
    const one = ctx.agent.create(s.id);
    const two = ctx.agent.create(s.id);

    // A stray file and an edit from before (e.g. M3) are gone once a change set opens.
    const stale = await ctx.sites.aiWorktree(s.id, head, { reset: false });
    fs.writeFileSync(path.join(stale, "stray.txt"), "x");
    fs.appendFileSync(path.join(stale, "site.yaml"), "\n# edited\n");

    const { cwd, change } = await ctx.changes.begin(s.id, one.id);
    expect(cwd).toBe(stale);
    expect(fs.existsSync(path.join(cwd, "stray.txt"))).toBe(false);
    expect(fs.readFileSync(path.join(cwd, "site.yaml"), "utf8")).not.toContain("# edited");
    expect(change).toMatchObject({ siteId: s.id, status: "open", baseCommit: head, snapshotCommit: head });
    expect(change.createdBySessionId).toBe(one.id);
    expect(s.git("rev-parse", changeRef(change.id))).toBe(head);

    // A second session joins the same change set; the checkout keeps its files.
    fs.writeFileSync(path.join(cwd, "kept.txt"), "kept");
    const again = await ctx.changes.begin(s.id, two.id);
    expect(again.change.id).toBe(change.id);
    expect(fs.readFileSync(path.join(cwd, "kept.txt"), "utf8")).toBe("kept");
    await ctx.changes.begin(s.id, one.id);
    expect(ctx.changes.store.sessions(change.id)).toEqual([one.id, two.id]);
  });

  it("brings a missing checkout back at the latest snapshot", async () => {
    const s = await site();
    const session = ctx.agent.create(s.id);
    const { cwd } = await ctx.changes.begin(s.id, session.id);
    fs.writeFileSync(path.join(cwd, "content/pages/new.md"), "---\ntitle: New\n---\n");
    const snap = await ctx.changes.snapshot(s.id, cwd);
    fs.rmSync(path.join(ctx.paths.worktrees, s.id), { recursive: true, force: true });
    const back = await ctx.changes.begin(s.id, session.id);
    expect(rawGit(base, back.cwd, "rev-parse", "HEAD").trim()).toBe(snap.commit);
    expect(fs.existsSync(path.join(back.cwd, "content/pages/new.md"))).toBe(true);
  });

  it("refuses read-only sites", async () => {
    const s = await site();
    const session = ctx.agent.create(s.id);
    ctx.sites.store.setState(s.id, { readOnly: [{ code: "plugin_files" }], checkedCommit: null, configCheck: null });
    await expect(ctx.changes.begin(s.id, session.id)).rejects.toMatchObject({ code: "site.read_only" });
  });
});

describe("snapshots", () => {
  it("move the change set and its ref; an unchanged checkout keeps them", async () => {
    const s = await site();
    const session = ctx.agent.create(s.id);
    const { cwd, change } = await ctx.changes.begin(s.id, session.id);
    const seen: string[] = [];
    const stop = ctx.changes.subscribe((id) => seen.push(id));
    expect((await ctx.changes.snapshot(s.id, cwd)).commit).toBe(change.baseCommit);
    expect(seen).toEqual([]);

    fs.writeFileSync(path.join(cwd, "content/pages/faq.md"), "---\ntitle: FAQ\n---\n");
    const { commit } = await ctx.changes.snapshot(s.id, cwd);
    stop();
    expect(ctx.changes.store.get(change.id)?.snapshotCommit).toBe(commit);
    expect(s.git("rev-parse", changeRef(change.id))).toBe(commit);
    expect(seen).toEqual([s.id]);
  });
});

describe("a run", () => {
  it("opens the change set, edits only the AI checkout, and is snapshotted with its summary", async () => {
    const s = await site();
    const head = s.git("rev-parse", "HEAD");
    const session = ctx.agent.create(s.id);
    faux.setResponses([
      toolCall("write", { path: "content/pages/faq.md", content: "---\ntitle: FAQ\n---\n\nHello\n" }),
      toolCall("edit", { path: "site.yaml", edits: [{ oldText: `title: Site ${n}`, newText: "title: Renamed" }] }),
      toolCall("summarize_changes", { summary: "Added an FAQ page and renamed the site." }),
      pi.ai.fauxAssistantMessage("Done."),
    ]);
    expect(await run(session.id)).toBeUndefined();

    const change = ctx.changes.store.open(s.id);
    expect(change).toMatchObject({ baseCommit: head, summary: "Added an FAQ page and renamed the site." });
    expect(change?.snapshotCommit).not.toBe(head);
    // The site folder and its default branch are untouched; the work waits in the change set.
    expect(s.git("rev-parse", "HEAD")).toBe(head);
    expect(s.git("status", "--porcelain")).toBe("");
    expect(fs.existsSync(path.join(s.dir, "content/pages/faq.md"))).toBe(false);

    const view = await ctx.changes.current(s.id, false);
    expect(view).toMatchObject({
      id: change?.id,
      status: "open",
      sessionIds: [session.id],
      reviewable: true,
      filesTruncated: false,
    });
    expect(view?.files).toEqual([
      { path: "content/pages/faq.md", status: "added", additions: 5, deletions: 0, binary: false },
      { path: "site.yaml", status: "modified", additions: 1, deletions: 1, binary: false },
    ]);
    expect(view?.treeHash).toBe(s.git("rev-parse", `${change?.snapshotCommit}^{tree}`));
    expect((await ctx.changes.current(s.id, true))?.reviewable).toBe(false);

    // The next run, from another session, keeps building on the same change set.
    const other = ctx.agent.create(s.id);
    faux.setResponses([
      toolCall("write", { path: "content/pages/faq.md", content: "---\ntitle: FAQ\n---\n\nHello again\n" }),
      pi.ai.fauxAssistantMessage("Done."),
    ]);
    expect(await run(other.id)).toBeUndefined();
    const after = await ctx.changes.current(s.id, false);
    expect(after?.id).toBe(change?.id);
    expect(after?.sessionIds).toEqual([session.id, other.id]);
    expect(s.git("rev-parse", `${after?.snapshotCommit}^`)).toBe(change?.snapshotCommit);
  });

  it("says the change set changed when a run ends, even without edits", async () => {
    const s = await site();
    const session = ctx.agent.create(s.id);
    const order: string[] = [];
    const stopChanges = ctx.changes.subscribe((id) => id === s.id && order.push("change"));
    const stopAgent = ctx.agent.subscribe(
      (e) => e.sessionId === session.id && e.type === "status" && order.push(e.status),
    );
    faux.setResponses([pi.ai.fauxAssistantMessage("Just answering.")]);
    await run(session.id);
    stopChanges();
    stopAgent();
    // Opened while running, then a notice after the run, when it became reviewable (or not) again.
    expect(order).toEqual(["running", "change", "idle", "change"]);
  });

  it("is snapshotted even when it is stopped", async () => {
    const s = await site();
    const session = ctx.agent.create(s.id);
    // The faux model ignores the abort, so the second reply waits for a gate that opens after stop().
    let open = () => {};
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    faux.setResponses([
      toolCall("write", { path: "notes.md", content: "half done\n" }),
      () => gate.then(() => pi.ai.fauxAssistantMessage("late")),
    ]);
    const done = run(session.id);
    const end = Date.now() + 5000;
    const cwd = path.join(ctx.paths.worktrees, s.id, "ai");
    while (!fs.existsSync(path.join(cwd, "notes.md"))) {
      if (Date.now() > end) throw new Error("the write never happened");
      await new Promise((r) => setTimeout(r, 10));
    }
    const stopped = ctx.agent.stop(session.id);
    open();
    await stopped;
    await done;
    const view = await ctx.changes.current(s.id, false);
    expect(view?.files.map((f) => f.path)).toEqual(["notes.md"]);
  });

  it("starts a fresh change set from the default branch once the open one is resolved", async () => {
    const s = await site();
    const session = ctx.agent.create(s.id);
    faux.setResponses([toolCall("write", { path: "old.md", content: "old\n" }), pi.ai.fauxAssistantMessage("ok")]);
    await run(session.id);
    const first = ctx.changes.store.open(s.id);
    // What rejecting does (layer 2): the change set is no longer open.
    ctx.db.prepare("UPDATE change_sets SET status = 'rejected' WHERE id = ?").run(first?.id ?? "");

    faux.setResponses([pi.ai.fauxAssistantMessage("nothing to do")]);
    await run(session.id);
    const second = ctx.changes.store.open(s.id);
    expect(second?.id).not.toBe(first?.id);
    expect(second?.baseCommit).toBe(s.git("rev-parse", "HEAD"));
    expect(fs.existsSync(path.join(ctx.paths.worktrees, s.id, "ai", "old.md"))).toBe(false);
    // Nothing changed yet: not reviewable.
    expect(await ctx.changes.current(s.id, false)).toMatchObject({ files: [], reviewable: false });
  });
});

describe("diffs", () => {
  it("lists the first files of a very large change, and still diffs the ones past the cap", async () => {
    const s = await site();
    const session = ctx.agent.create(s.id);
    const { cwd, change } = await ctx.changes.begin(s.id, session.id);
    fs.mkdirSync(path.join(cwd, "many"));
    for (let i = 0; i < MAX_FILES + 5; i++) {
      fs.writeFileSync(path.join(cwd, "many", `f${String(i).padStart(5, "0")}.md`), `${i}\n`);
    }
    await ctx.changes.snapshot(s.id, cwd);
    const view = await ctx.changes.current(s.id, false);
    expect(view?.files).toHaveLength(MAX_FILES);
    expect(view?.filesTruncated).toBe(true);
    const last = `many/f${String(MAX_FILES + 4).padStart(5, "0")}.md`;
    expect((await ctx.changes.diff(change.id, last)).patch).toContain(`+${MAX_FILES + 4}`);
    // A directory is not a file of the change, though the literal path matches files under it.
    await expect(ctx.changes.diff(change.id, "many")).rejects.toMatchObject({ code: "change.file_not_found" });
  });

  it("shows one file at a time, flags binary and very large files, and only for files in the change", async () => {
    const s = await site();
    const session = ctx.agent.create(s.id);
    const { cwd, change } = await ctx.changes.begin(s.id, session.id);
    fs.appendFileSync(path.join(cwd, "site.yaml"), "# a note\n");
    fs.writeFileSync(path.join(cwd, "image.bin"), Buffer.from([0, 1, 2, 3, 0, 255]));
    fs.writeFileSync(
      path.join(cwd, "big.txt"),
      "x"
        .repeat(80)
        .concat("\n")
        .repeat(MAX_PATCH_BYTES / 60),
    );
    fs.writeFileSync(path.join(cwd, "名字 with space.md"), "hi\n");
    fs.rmSync(path.join(cwd, "content/pages/about.md"));
    await ctx.changes.snapshot(s.id, cwd);

    const view = await ctx.changes.current(s.id, false);
    expect(view?.files.map((f) => [f.path, f.status, f.binary])).toEqual([
      ["big.txt", "added", false],
      ["content/pages/about.md", "deleted", false],
      ["image.bin", "added", true],
      ["site.yaml", "modified", false],
      ["名字 with space.md", "added", false],
    ]);

    const yaml = await ctx.changes.diff(change.id, "site.yaml");
    expect(yaml).toMatchObject({ path: "site.yaml", binary: false, tooLarge: false });
    expect(yaml.patch).toContain("+# a note");
    expect((await ctx.changes.diff(change.id, "名字 with space.md")).patch).toContain("+hi");
    expect(await ctx.changes.diff(change.id, "image.bin")).toEqual({
      path: "image.bin",
      binary: true,
      patch: null,
      tooLarge: false,
      splittable: false,
    });
    expect(await ctx.changes.diff(change.id, "big.txt")).toMatchObject({ patch: null, tooLarge: true });
    await expect(ctx.changes.diff(change.id, "README.md")).rejects.toMatchObject({ code: "change.file_not_found" });
    await expect(ctx.changes.diff(change.id, ":(glob)*")).rejects.toMatchObject({ code: "change.file_not_found" });
    await expect(ctx.changes.diff("nope", "site.yaml")).rejects.toMatchObject({ code: "change.not_found" });
  });
});

describe("applying and rejecting", () => {
  /** A site with an open change set that adds a page and edits site.yaml; returns its review. */
  async function reviewed(prepare?: (dir: string, git: (...args: string[]) => string) => void) {
    const s = await site();
    prepare?.(s.dir, s.git);
    const session = ctx.agent.create(s.id);
    const { cwd, change } = await ctx.changes.begin(s.id, session.id);
    fs.writeFileSync(path.join(cwd, "content/pages/faq.md"), "---\ntitle: FAQ\n---\n");
    fs.appendFileSync(path.join(cwd, "site.yaml"), "# reviewed\n");
    await ctx.changes.snapshot(s.id, cwd);
    ctx.changes.setSummary(s.id, "Added an FAQ page.");
    const view = await ctx.changes.current(s.id, false);
    if (!view) throw new Error("no change set");
    return { s, session, cwd, change, view };
  }

  it("commits the reviewed tree on the default branch and fast-forwards the site folder", async () => {
    const { s, session, view } = await reviewed();
    const head = s.git("rev-parse", "HEAD");
    const result = await ctx.changes.apply(view.id, { treeHash: view.treeHash });
    expect(result.outcome).toBe("applied");
    expect(result.check).toMatchObject({ passed: true, problemCode: null, problem: null });
    expect(result.change).toMatchObject({ status: "applied", resultCommit: s.git("rev-parse", "HEAD") });

    // One commit on main, whose tree is exactly what was reviewed.
    expect(s.git("rev-parse", "HEAD^")).toBe(head);
    expect(s.git("rev-parse", "HEAD^{tree}")).toBe(view.treeHash);
    expect(s.git("log", "-1", "--format=%an <%ae>|%cn <%ce>")).toBe(
      "BukitJalil AI <ai@bukitjalil.local>|Site Owner <owner@example.com>",
    );
    expect(s.git("log", "-1", "--format=%B")).toBe(`Added an FAQ page.\n\nBukitJalil-Sessions: ${session.id}`);
    expect(fs.existsSync(path.join(s.dir, "content/pages/faq.md"))).toBe(true);
    expect(s.git("status", "--porcelain")).toBe("");
    // The ref stays (history), at the reviewed snapshot.
    expect(s.git("rev-parse", changeRef(view.id))).toBe(view.snapshotCommit);
    expect(ctx.changes.store.open(s.id)).toBeNull();

    // The next change set starts from the applied commit.
    const next = await ctx.changes.begin(s.id, session.id);
    expect(next.change.baseCommit).toBe(s.git("rev-parse", "HEAD"));
  });

  it("refuses a changed fingerprint, a closed change set, an empty one, no identity and a busy site", async () => {
    const { s, view, cwd } = await reviewed();
    await expect(ctx.changes.apply(view.id, { treeHash: "0".repeat(40) })).rejects.toMatchObject({
      code: "change.fingerprint_mismatch",
    });
    // Edited after the review (outside a run): the snapshot taken while applying no longer matches.
    fs.writeFileSync(path.join(cwd, "late.md"), "late\n");
    await expect(ctx.changes.apply(view.id, { treeHash: view.treeHash })).rejects.toMatchObject({
      code: "change.fingerprint_mismatch",
    });

    const release = ctx.locks.acquire(s.id, "build");
    await expect(ctx.changes.apply(view.id, { treeHash: view.treeHash })).rejects.toMatchObject({
      code: "site.busy",
    });
    await expect(ctx.changes.reject(view.id)).rejects.toMatchObject({ code: "site.busy" });
    release();

    settings.update({ commitName: null });
    const now = await ctx.changes.current(s.id, false);
    await expect(ctx.changes.apply(view.id, { treeHash: now?.treeHash ?? "" })).rejects.toMatchObject({
      code: "site.identity_required",
    });
    settings.update({ commitName: "Site Owner" });

    const head = s.git("rev-parse", "HEAD");
    const rejected = await ctx.changes.reject(view.id);
    expect(rejected).toMatchObject({ status: "rejected", resultCommit: null });
    expect(s.git("rev-parse", "HEAD")).toBe(head);
    // A rejected snapshot is not part of the review history; its ref goes so Git can collect it.
    expect(s.git("for-each-ref", changeRef(view.id))).toBe("");
    await expect(ctx.changes.apply(view.id, { treeHash: view.treeHash })).rejects.toMatchObject({
      code: "change.not_open",
      params: { status: "rejected" },
    });
    await expect(ctx.changes.reject(view.id)).rejects.toMatchObject({ code: "change.not_open" });

    const session = ctx.agent.create(s.id);
    const empty = await ctx.changes.begin(s.id, session.id);
    const emptyView = await ctx.changes.current(s.id, false);
    await expect(ctx.changes.apply(empty.change.id, { treeHash: emptyView?.treeHash ?? "" })).rejects.toMatchObject({
      code: "change.no_changes",
    });
  });

  it("refuses when the site folder leaves the default branch while the check runs", async () => {
    const { s, view } = await reviewed();
    const opts = (ctx.changes as unknown as { opts: { check: (siteId: string, cwd: string) => Promise<unknown> } })
      .opts;
    const check = opts.check;
    opts.check = async (siteId, cwd) => {
      s.git("switch", "-q", "-c", "wip");
      return check(siteId, cwd);
    };
    try {
      await expect(ctx.changes.apply(view.id, { treeHash: view.treeHash, force: true })).rejects.toMatchObject({
        code: "change.wrong_branch",
      });
      expect(s.git("rev-parse", "wip")).toBe(s.git("rev-parse", "main"));
    } finally {
      opts.check = check;
      s.git("switch", "-q", "main");
    }
  });

  it("refuses when the default branch is reset while the check runs, keeping the reset", async () => {
    const { s, view } = await reviewed((dir, git) => {
      fs.writeFileSync(path.join(dir, "later.md"), "later\n");
      git("add", "-A");
      git("-c", "user.name=T", "-c", "user.email=t@example.com", "commit", "-q", "-m", "later");
    });
    const opts = (ctx.changes as unknown as { opts: { check: (siteId: string, cwd: string) => Promise<unknown> } })
      .opts;
    const check = opts.check;
    const dropped = s.git("rev-parse", "HEAD");
    opts.check = async (siteId, cwd) => {
      s.git("reset", "-q", "--hard", "HEAD~1");
      return check(siteId, cwd);
    };
    try {
      await expect(ctx.changes.apply(view.id, { treeHash: view.treeHash, force: true })).rejects.toMatchObject({
        code: "change.merge_failed",
      });
      expect(s.git("rev-parse", "HEAD")).toBe(s.git("rev-parse", `${dropped}~1`));
    } finally {
      opts.check = check;
    }
  });

  it("refuses when the site folder is on another branch or has uncommitted changes", async () => {
    const { s, view } = await reviewed();
    s.git("switch", "-q", "-c", "other");
    await expect(ctx.changes.apply(view.id, { treeHash: view.treeHash })).rejects.toMatchObject({
      code: "change.wrong_branch",
      params: { branch: "main" },
    });
    s.git("switch", "-q", "main");
    fs.appendFileSync(path.join(s.dir, "content/posts/welcome.md"), "\nlocal edit\n");
    await expect(ctx.changes.apply(view.id, { treeHash: view.treeHash })).rejects.toMatchObject({
      code: "change.site_dirty",
    });
    s.git("checkout", "--", ".");
    expect((await ctx.changes.apply(view.id, { treeHash: view.treeHash })).outcome).toBe("applied");
  });

  it("never overwrites an ignored local file in the site folder", async () => {
    const { s, cwd } = await reviewed((dir, git) => {
      fs.appendFileSync(path.join(dir, ".gitignore"), "\nlocal.txt\n");
      git("add", "-A");
      git("-c", "user.name=T", "-c", "user.email=t@example.com", "commit", "-q", "-m", "ignore local.txt");
    });
    fs.writeFileSync(path.join(s.dir, "local.txt"), "the user's own file\n");
    // The AI un-ignores the file and writes its own version.
    const gitignore = path.join(cwd, ".gitignore");
    fs.writeFileSync(gitignore, fs.readFileSync(gitignore, "utf8").replace("local.txt\n", ""));
    fs.writeFileSync(path.join(cwd, "local.txt"), "from the AI\n");
    await ctx.changes.snapshot(s.id, cwd);
    const view = await ctx.changes.current(s.id, false);
    const head = s.git("rev-parse", "HEAD");
    await expect(ctx.changes.apply(view?.id ?? "", { treeHash: view?.treeHash ?? "" })).rejects.toMatchObject({
      code: "change.merge_failed",
      params: { detail: expect.stringContaining("local.txt") },
    });
    expect(fs.readFileSync(path.join(s.dir, "local.txt"), "utf8")).toBe("the user's own file\n");
    expect(s.git("rev-parse", "HEAD")).toBe(head);
    expect(ctx.changes.store.open(s.id)?.id).toBe(view?.id);
  });

  it("reports a failed check and applies only when told to", async () => {
    const { s, cwd } = await reviewed();
    fs.writeFileSync(path.join(cwd, "fake-doctor"), "x");
    await ctx.changes.snapshot(s.id, cwd);
    const view = await ctx.changes.current(s.id, false);
    const head = s.git("rev-parse", "HEAD");
    const failed = await ctx.changes.apply(view?.id ?? "", { treeHash: view?.treeHash ?? "" });
    expect(failed.outcome).toBe("check_failed");
    expect(failed.change.status).toBe("open");
    expect(failed.check?.passed).toBe(false);
    expect(failed.check?.steps.find((st) => st.command === "doctor")).toMatchObject({
      passed: false,
      output: expect.stringContaining("template missing"),
    });
    expect(s.git("rev-parse", "HEAD")).toBe(head);

    const forced = await ctx.changes.apply(view?.id ?? "", { treeHash: view?.treeHash ?? "", force: true });
    expect(forced.outcome).toBe("applied");
    expect(s.git("rev-parse", "HEAD^")).toBe(head);
  });

  it("merges onto a default branch that moved, asks for another review, then applies both", async () => {
    const { s, view, cwd } = await reviewed();
    fs.writeFileSync(path.join(s.dir, "content/pages/contact.md"), "---\ntitle: Contact\n---\n");
    s.git("add", "-A");
    s.git("-c", "user.name=T", "-c", "user.email=t@example.com", "commit", "-q", "-m", "outside BukitJalil");
    const main = s.git("rev-parse", "HEAD");

    const rebased = await ctx.changes.apply(view.id, { treeHash: view.treeHash });
    expect(rebased.outcome).toBe("rebased");
    expect(rebased.change).toMatchObject({ status: "open", baseCommit: main });
    expect(rebased.change.treeHash).not.toBe(view.treeHash);
    expect(s.git("rev-parse", "HEAD")).toBe(main);
    // The AI checkout now holds the merge result; the review shows only the AI's own files.
    expect(rawGit(base, cwd, "rev-parse", "HEAD").trim()).toBe(rebased.change.snapshotCommit);
    expect(fs.existsSync(path.join(cwd, "content/pages/contact.md"))).toBe(true);
    const again = await ctx.changes.current(s.id, false);
    expect(again?.files.map((f) => f.path)).toEqual(["content/pages/faq.md", "site.yaml"]);
    await expect(ctx.changes.apply(view.id, { treeHash: view.treeHash })).rejects.toMatchObject({
      code: "change.fingerprint_mismatch",
    });

    expect((await ctx.changes.apply(view.id, { treeHash: rebased.change.treeHash })).outcome).toBe("applied");
    expect(s.git("rev-parse", "HEAD^")).toBe(main);
    expect(fs.existsSync(path.join(s.dir, "content/pages/faq.md"))).toBe(true);
    expect(fs.existsSync(path.join(s.dir, "content/pages/contact.md"))).toBe(true);
  });

  it("closes the change set as stale when the moved default branch conflicts with it", async () => {
    const { s, view, session } = await reviewed();
    fs.appendFileSync(path.join(s.dir, "site.yaml"), "# changed outside\n");
    s.git("add", "-A");
    s.git("-c", "user.name=T", "-c", "user.email=t@example.com", "commit", "-q", "-m", "conflicting");
    const main = s.git("rev-parse", "HEAD");

    const stale = await ctx.changes.apply(view.id, { treeHash: view.treeHash });
    expect(stale.outcome).toBe("stale");
    expect(stale.change.status).toBe("stale");
    expect(s.git("rev-parse", "HEAD")).toBe(main);
    expect(s.git("for-each-ref", changeRef(view.id))).toBe("");
    // The next run starts over from the new default branch.
    const next = await ctx.changes.begin(s.id, session.id);
    expect(next.change.id).not.toBe(view.id);
    expect(next.change.baseCommit).toBe(main);
  });
  it("closes the change set as stale when the default branch already has all of it", async () => {
    const { s, view, cwd } = await reviewed();
    // The user made the same edits by hand.
    fs.copyFileSync(path.join(cwd, "content/pages/faq.md"), path.join(s.dir, "content/pages/faq.md"));
    fs.copyFileSync(path.join(cwd, "site.yaml"), path.join(s.dir, "site.yaml"));
    s.git("add", "-A");
    s.git("-c", "user.name=T", "-c", "user.email=t@example.com", "commit", "-q", "-m", "same edits");
    const main = s.git("rev-parse", "HEAD");
    const result = await ctx.changes.apply(view.id, { treeHash: view.treeHash });
    expect(result.outcome).toBe("stale");
    expect(result.change.status).toBe("stale");
    expect(s.git("rev-parse", "HEAD")).toBe(main);
  });

  it("refuses read-only sites", async () => {
    const { s, view } = await reviewed();
    ctx.sites.store.setState(s.id, { readOnly: [{ code: "plugin_files" }], checkedCommit: null, configCheck: null });
    await expect(ctx.changes.apply(view.id, { treeHash: view.treeHash })).rejects.toMatchObject({
      code: "site.read_only",
    });
  });

  it("writes a one-line message from the diff when the AI gave no summary", async () => {
    const { s, view } = await reviewed();
    ctx.changes.setSummary(s.id, "");
    const result = await ctx.changes.apply(view.id, { treeHash: view.treeHash });
    expect(result.outcome).toBe("applied");
    expect(s.git("log", "-1", "--format=%s")).toBe("Update 1 file, add 1 file: content/pages/faq.md, site.yaml");
  });

  it("tells a session joining a newer change set how its last one ended", async () => {
    const s = await site();
    const session = ctx.agent.create(s.id);
    const first = await ctx.changes.begin(s.id, session.id);
    expect(first.previous).toBeNull();
    expect((await ctx.changes.begin(s.id, session.id)).previous).toBeNull();
    await ctx.changes.reject(first.change.id);
    const second = await ctx.changes.begin(s.id, session.id);
    expect(second.previous).toBe("rejected");
    // Every later run in the same change set still says so; the agent sends the note once (plan 6.2).
    expect((await ctx.changes.begin(s.id, session.id)).previous).toBe("rejected");
    // Another conversation that never took part gets nothing.
    expect((await ctx.changes.begin(s.id, ctx.agent.create(s.id).id)).previous).toBeNull();
  });

  it("says why the check could not run, and applies only when told to", async () => {
    const { s, view, cwd } = await reviewed();
    // A plugins/ folder makes the pre-build guard refuse the snapshot.
    fs.mkdirSync(path.join(cwd, "plugins"));
    fs.writeFileSync(path.join(cwd, "plugins/x.js"), "export {};\n");
    await ctx.changes.snapshot(s.id, cwd);
    const now = await ctx.changes.current(s.id, false);
    const failed = await ctx.changes.apply(view.id, { treeHash: now?.treeHash ?? "" });
    expect(failed.outcome).toBe("check_failed");
    expect(failed.check).toMatchObject({ passed: false, problemCode: "guard", steps: [] });
    expect(failed.check?.problem).toContain("plugin");
    const forced = await ctx.changes.apply(view.id, { treeHash: now?.treeHash ?? "", force: true });
    expect(forced.outcome).toBe("applied");
  });

  const NOTION_SITE_YAML =
    "site:\n  name: n\n  title: N\n  language: en-US\ncontent:\n  sources:\n    - name: posts\n      type: notion\n      collection: post\n      notion:\n        databaseId: abc\n";

  it("applies a bound Notion site's change without force: it cannot be checked, which is not a failure", async () => {
    const { s, view } = await reviewed((dir, git) => {
      fs.writeFileSync(path.join(dir, "site.yaml"), NOTION_SITE_YAML);
      git("add", "-A");
      // An explicit identity: CI machines have no global git user.
      git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "notion");
    });
    const source = ctx.dataSources.create({ platform: "notion", name: "Notion", token: "ntn_apply_token" });
    await ctx.sites.bindNotionSource(s.id, source.id);
    const result = await ctx.changes.apply(view.id, { treeHash: view.treeHash });
    expect(result.outcome).toBe("applied");
    expect(result.check).toMatchObject({ passed: false, problemCode: "notion", steps: [] });
    expect(s.git("rev-parse", "HEAD^{tree}")).toBe(view.treeHash);
  });

  it("still asks for force when the change itself adds a Notion source", async () => {
    const { s, view, cwd } = await reviewed();
    const source = ctx.dataSources.create({ platform: "notion", name: "Notion two", token: "ntn_apply_token2" });
    await ctx.sites.bindNotionSource(s.id, source.id);
    fs.writeFileSync(path.join(cwd, "site.yaml"), NOTION_SITE_YAML);
    await ctx.changes.snapshot(s.id, cwd);
    const now = await ctx.changes.current(s.id, false);
    const failed = await ctx.changes.apply(view.id, { treeHash: now?.treeHash ?? "" });
    expect(failed.outcome).toBe("check_failed");
    expect(failed.check).toMatchObject({ problemCode: "notion" });
    const forced = await ctx.changes.apply(view.id, { treeHash: now?.treeHash ?? "", force: true });
    expect(forced.outcome).toBe("applied");
  });
});

describe("partial apply (plan 7.5)", () => {
  /** A change set that adds faq.md, edits site.yaml and deletes about.md, with an AI summary. */
  async function threeChanges() {
    const s = await site();
    const session = ctx.agent.create(s.id);
    const { cwd } = await ctx.changes.begin(s.id, session.id);
    fs.writeFileSync(path.join(cwd, "content/pages/faq.md"), "---\ntitle: FAQ\n---\n");
    fs.appendFileSync(path.join(cwd, "site.yaml"), "# reviewed\n");
    fs.rmSync(path.join(cwd, "content/pages/about.md"));
    await ctx.changes.snapshot(s.id, cwd);
    ctx.changes.setSummary(s.id, "Added an FAQ page.");
    const view = await ctx.changes.current(s.id, false);
    if (!view) throw new Error("no change set");
    return { s, session, cwd, view };
  }

  it("applies only the selected files and keeps the rest open for review", async () => {
    const { s, session, cwd, view } = await threeChanges();
    const head = s.git("rev-parse", "HEAD");
    const result = await ctx.changes.apply(view.id, {
      treeHash: view.treeHash,
      baseCommit: view.baseCommit,
      selection: [{ path: "content/pages/faq.md" }, { path: "content/pages/about.md" }],
    });
    expect(result.outcome).toBe("partial");
    expect(result.check).toMatchObject({ passed: true });

    // One commit on main with just those two files; the site folder follows.
    expect(s.git("rev-parse", "HEAD^")).toBe(head);
    expect(s.git("diff", "--name-status", "HEAD^", "HEAD")).toBe("D\tcontent/pages/about.md\nA\tcontent/pages/faq.md");
    expect(s.git("log", "-1", "--format=%an|%B")).toBe(
      `BukitJalil AI|Add 1 file, delete 1 file: content/pages/about.md, content/pages/faq.md\n\nPart of: Added an FAQ page.\n\nBukitJalil-Sessions: ${session.id}`,
    );
    expect(fs.existsSync(path.join(s.dir, "content/pages/faq.md"))).toBe(true);
    expect(fs.readFileSync(path.join(s.dir, "site.yaml"), "utf8")).not.toContain("# reviewed");
    expect(s.git("status", "--porcelain")).toBe("");

    // The change set stays open on top of the result, with the same snapshot tree: only site.yaml is left.
    const rest = await ctx.changes.current(s.id, false);
    expect(rest).toMatchObject({ id: view.id, status: "open", baseCommit: s.git("rev-parse", "HEAD") });
    expect(rest?.treeHash).toBe(view.treeHash);
    expect(rest?.files.map((f) => f.path)).toEqual(["site.yaml"]);
    expect(s.git("rev-parse", changeRef(view.id))).toBe(rest?.snapshotCommit);
    expect(s.git("rev-parse", `${rest?.snapshotCommit}^`)).toBe(s.git("rev-parse", "HEAD"));
    // The AI's working copy is as it was, and still clean against the new snapshot.
    expect(fs.readFileSync(path.join(cwd, "site.yaml"), "utf8")).toContain("# reviewed");
    expect(rawGit(base, cwd, "status", "--porcelain").trim()).toBe("");
    expect(rawGit(base, cwd, "rev-parse", "HEAD").trim()).toBe(rest?.snapshotCommit);

    // Applying the rest brings main to exactly what was reviewed in the first place.
    const all = await ctx.changes.apply(view.id, { treeHash: rest?.treeHash ?? "" });
    expect(all.outcome).toBe("applied");
    expect(s.git("rev-parse", "HEAD^{tree}")).toBe(view.treeHash);
    expect(s.git("log", "-1", "--format=%s")).toBe("Rest of: Added an FAQ page.");
  });

  it("refuses to take one side of a file replaced by a folder of the same name", async () => {
    const s = await site();
    const session = ctx.agent.create(s.id);
    const { cwd } = await ctx.changes.begin(s.id, session.id);
    fs.rmSync(path.join(cwd, "content/pages/about.md"));
    fs.mkdirSync(path.join(cwd, "content/pages/about.md"));
    fs.writeFileSync(path.join(cwd, "content/pages/about.md/index.md"), "# About\n");
    await ctx.changes.snapshot(s.id, cwd);
    const view = await ctx.changes.current(s.id, false);
    if (!view) throw new Error("no change set");
    expect(view.files.map((f) => `${f.status} ${f.path}`)).toEqual([
      "deleted content/pages/about.md",
      "added content/pages/about.md/index.md",
    ]);
    await expect(
      ctx.changes.apply(view.id, {
        treeHash: view.treeHash,
        baseCommit: view.baseCommit,
        selection: [{ path: "content/pages/about.md/index.md" }],
      }),
    ).rejects.toMatchObject({ code: "change.partial_unsupported" });
    const both = await ctx.changes.apply(view.id, {
      treeHash: view.treeHash,
      baseCommit: view.baseCommit,
      selection: view.files.map((f) => ({ path: f.path })),
    });
    expect(both.outcome).toBe("applied");
  });

  it("applies only the selected hunks of a file, byte for byte", async () => {
    const s = await site();
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
    // No final newline, and a byte that is not UTF-8, both kept exactly.
    const before = Buffer.concat([Buffer.from(`${lines.join("\n")}\n\xff`, "latin1")]);
    fs.writeFileSync(path.join(s.dir, "notes.txt"), before);
    commitAllAs(base, s.dir, "notes");
    const session = ctx.agent.create(s.id);
    const { cwd } = await ctx.changes.begin(s.id, session.id);
    const edited = [...lines];
    edited[1] = "line 2 edited";
    edited[24] = "line 25 edited";
    const after = Buffer.from(`${edited.join("\n")}\n\xff end`, "latin1");
    fs.writeFileSync(path.join(cwd, "notes.txt"), after);
    await ctx.changes.snapshot(s.id, cwd);
    const view = await ctx.changes.current(s.id, false);
    if (!view) throw new Error("no change set");
    const diff = await ctx.changes.diff(view.id, "notes.txt");
    expect(parseHunks(diff.patch ?? "")).toHaveLength(2);

    await expect(
      ctx.changes.apply(view.id, {
        treeHash: view.treeHash,
        baseCommit: view.baseCommit,
        selection: [{ path: "notes.txt", hunks: [2] }],
      }),
    ).rejects.toMatchObject({ code: "change.fingerprint_mismatch" });
    const result = await ctx.changes.apply(view.id, {
      treeHash: view.treeHash,
      baseCommit: view.baseCommit,
      selection: [{ path: "notes.txt", hunks: [1] }],
    });
    expect(result.outcome).toBe("partial");
    const applied = [...lines];
    applied[24] = "line 25 edited";
    expect(fs.readFileSync(path.join(s.dir, "notes.txt"))).toEqual(
      Buffer.from(`${applied.join("\n")}\n\xff end`, "latin1"),
    );
    // What is left is the first hunk; the AI's copy is the full edit still.
    const rest = await ctx.changes.diff(view.id, "notes.txt");
    expect(parseHunks(rest.patch ?? "")).toHaveLength(1);
    expect(rest.patch).toContain("+line 2 edited");
    expect(rest.patch).not.toContain("line 25 edited");
    expect(fs.readFileSync(path.join(cwd, "notes.txt"))).toEqual(after);

    // The rest has the same tree but a new base: hunk numbers made on the old diff are refused.
    const now = await ctx.changes.current(s.id, false);
    expect(now?.treeHash).toBe(view.treeHash);
    await expect(
      ctx.changes.apply(view.id, {
        treeHash: view.treeHash,
        baseCommit: view.baseCommit,
        selection: [{ path: "notes.txt", hunks: [0] }],
      }),
    ).rejects.toMatchObject({ code: "change.fingerprint_mismatch" });
    expect((await ctx.changes.diff(view.id, "notes.txt")).splittable).toBe(true);

    // All hunks of a file are the whole file.
    const all = await ctx.changes.apply(view.id, {
      treeHash: now?.treeHash ?? "",
      baseCommit: now?.baseCommit,
      selection: [{ path: "notes.txt", hunks: [0] }],
    });
    expect(all.outcome).toBe("applied");
    expect(fs.readFileSync(path.join(s.dir, "notes.txt"))).toEqual(after);
  });

  it("takes only whole new files, deleted files and files whose mode changed", async () => {
    const { s, cwd } = await threeChanges();
    fs.chmodSync(path.join(cwd, "content/posts/welcome.md"), 0o755);
    fs.appendFileSync(path.join(cwd, "content/posts/welcome.md"), "more\n");
    await ctx.changes.snapshot(s.id, cwd);
    const view = await ctx.changes.current(s.id, false);
    if (!view) throw new Error("no change set");
    for (const p of ["content/pages/faq.md", "content/pages/about.md", "content/posts/welcome.md"]) {
      await expect(
        ctx.changes.apply(view.id, {
          treeHash: view.treeHash,
          baseCommit: view.baseCommit,
          selection: [{ path: p, hunks: [0] }],
        }),
      ).rejects.toMatchObject({ code: "change.partial_unsupported" });
    }
    expect((await ctx.changes.diff(view.id, "content/pages/faq.md")).splittable).toBe(false);
    expect((await ctx.changes.diff(view.id, "content/posts/welcome.md")).splittable).toBe(false);
    expect((await ctx.changes.diff(view.id, "site.yaml")).splittable).toBe(true);
    const ok = await ctx.changes.apply(view.id, {
      treeHash: view.treeHash,
      baseCommit: view.baseCommit,
      selection: [{ path: "site.yaml", hunks: [0] }],
    });
    expect(ok.outcome).toBe("partial");
  });

  it("applies the whole change set when everything is selected", async () => {
    const { s, view } = await threeChanges();
    const result = await ctx.changes.apply(view.id, {
      treeHash: view.treeHash,
      baseCommit: view.baseCommit,
      selection: view.files.map((f) => ({ path: f.path })),
    });
    expect(result.outcome).toBe("applied");
    expect(result.change.status).toBe("applied");
    expect(s.git("rev-parse", "HEAD^{tree}")).toBe(view.treeHash);
  });

  it("checks the selected result, not the whole snapshot", async () => {
    const { s, cwd } = await threeChanges();
    // fake-doctor makes the stand-in Bukit's doctor fail.
    fs.writeFileSync(path.join(cwd, "fake-doctor"), "x");
    await ctx.changes.snapshot(s.id, cwd);
    const view = await ctx.changes.current(s.id, false);
    if (!view) throw new Error("no change set");
    const head = s.git("rev-parse", "HEAD");

    const failed = await ctx.changes.apply(view.id, {
      treeHash: view.treeHash,
      baseCommit: view.baseCommit,
      selection: [{ path: "fake-doctor" }],
    });
    expect(failed.outcome).toBe("check_failed");
    expect(s.git("rev-parse", "HEAD")).toBe(head);
    expect(ctx.changes.store.open(s.id)).toMatchObject({
      id: view.id,
      baseCommit: head,
      snapshotCommit: view.snapshotCommit,
    });

    const ok = await ctx.changes.apply(view.id, {
      treeHash: view.treeHash,
      baseCommit: view.baseCommit,
      selection: [{ path: "site.yaml" }],
    });
    expect(ok.outcome).toBe("partial");
    expect(s.git("diff", "--name-only", "HEAD^", "HEAD")).toBe("site.yaml");
  });

  it("refuses paths that did not change, hunks it cannot split, restores and an old fingerprint", async () => {
    const { s, view } = await threeChanges();
    await expect(
      ctx.changes.apply(view.id, {
        treeHash: view.treeHash,
        baseCommit: view.baseCommit,
        selection: [{ path: "content/posts/welcome.md" }],
      }),
    ).rejects.toMatchObject({ code: "change.file_not_found" });
    await expect(
      ctx.changes.apply(view.id, {
        treeHash: view.treeHash,
        baseCommit: view.baseCommit,
        selection: [{ path: "content/pages/faq.md", hunks: [0] }],
      }),
    ).rejects.toMatchObject({ code: "change.partial_unsupported" });
    await expect(
      ctx.changes.apply(view.id, {
        treeHash: "0".repeat(40),
        baseCommit: view.baseCommit,
        selection: [{ path: "site.yaml" }],
      }),
    ).rejects.toMatchObject({ code: "change.fingerprint_mismatch" });
    await ctx.changes.reject(view.id);

    const init = s.git("rev-list", "--max-parents=0", "HEAD");
    fs.appendFileSync(path.join(s.dir, "site.yaml"), "# later\n");
    commitAllAs(base, s.dir, "later");
    const restored = await ctx.changes.restore(s.id, init);
    await expect(
      ctx.changes.apply(restored.change.id, {
        treeHash: restored.change.treeHash,
        baseCommit: restored.change.baseCommit,
        selection: [{ path: "site.yaml" }],
      }),
    ).rejects.toMatchObject({ code: "change.partial_restore" });
  });

  it("rebases instead when the default branch moved, ignoring the selection", async () => {
    const { s, view } = await threeChanges();
    fs.writeFileSync(path.join(s.dir, "other.md"), "other\n");
    commitAllAs(base, s.dir, "elsewhere");
    const result = await ctx.changes.apply(view.id, {
      treeHash: view.treeHash,
      baseCommit: view.baseCommit,
      selection: [{ path: "site.yaml" }],
    });
    expect(result.outcome).toBe("rebased");
    expect(s.git("log", "-1", "--format=%s")).toBe("elsewhere");
  });
});

describe("the change set API and events", () => {
  async function call<T>(method: string, url: string, body?: unknown) {
    const init: RequestInit =
      method === "GET"
        ? {}
        : {
            method,
            body: JSON.stringify(body ?? {}),
            headers: { "content-type": "application/json", "x-bukitjalil": "1", origin: ADMIN },
          };
    const res = await ctx.app.request(req(url, init));
    return { status: res.status, json: (await res.json()) as T };
  }

  /** `change` events of one site, as the stream sends them. */
  function changeEvents(siteId: string) {
    const got: (CurrentChange["change"] | undefined)[] = [];
    const sub = ctx.events.subscribe(
      undefined,
      (e: ServerEvent) => {
        if (e.type === "change" && e.siteId === siteId) got.push(e.data.change);
      },
      () => {},
    );
    return { got, close: sub.close };
  }

  async function until(cond: () => boolean) {
    for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
    expect(cond()).toBe(true);
  }

  it("shows the open change set, its files and diffs, and the snapshot through ref=change", async () => {
    const s = await site();
    const api = (p: string) => `/api/sites/${s.id}${p}`;
    expect(await call("GET", api("/changes/current"))).toEqual({ status: 200, json: { change: null } });
    expect((await call("GET", api("/tree?ref=change"))).json).toEqual({ code: "change.not_found" });

    const events = changeEvents(s.id);
    const session = ctx.agent.create(s.id);
    const { cwd } = await ctx.changes.begin(s.id, session.id);
    fs.writeFileSync(path.join(cwd, "content/pages/faq.md"), "---\ntitle: FAQ\n---\n");
    await ctx.changes.snapshot(s.id, cwd);

    const current = await call<CurrentChange>("GET", api("/changes/current"));
    const change = current.json.change;
    expect(change).toMatchObject({ status: "open", reviewable: true, files: [{ path: "content/pages/faq.md" }] });
    // The stream ends on the same state the API returns.
    await until(() => JSON.stringify(events.got.at(-1)) === JSON.stringify(change));
    events.close();

    const tree = await call<{ entries: { name: string }[] }>("GET", api("/tree?ref=change&path=content/pages"));
    expect(tree.json.entries.map((e) => e.name)).toContain("faq.md");
    const mainTree = await call<{ entries: { name: string }[] }>("GET", api("/tree?path=content/pages"));
    expect(mainTree.json.entries.map((e) => e.name)).not.toContain("faq.md");
    expect((await call("GET", api("/file?ref=change&path=content/pages/faq.md"))).json).toMatchObject({
      ref: "change",
      commit: change?.snapshotCommit,
      kind: "text",
    });

    const diff = await call<FileDiff>("GET", `/api/changes/${change?.id}/diff?path=content/pages/faq.md`);
    expect(diff.json.patch).toContain("+title: FAQ");
    expect((await call("GET", `/api/changes/${change?.id}/diff?path=site.yaml`)).json).toEqual({
      code: "change.file_not_found",
    });
    expect((await call("GET", `/api/changes/${change?.id}/diff?path=../x`)).status).toBe(400);
    expect((await call("GET", `/api/changes/${change?.id}/diff`)).status).toBe(400);
    expect((await call("GET", "/api/changes/nope/diff?path=a")).json).toEqual({ code: "change.not_found" });
  });

  it("points out a Notion source the change adds to site.yaml (plan 5.4)", async () => {
    const s = await site();
    const session = ctx.agent.create(s.id);
    const { cwd } = await ctx.changes.begin(s.id, session.id);
    fs.writeFileSync(path.join(cwd, "content/pages/faq.md"), "---\ntitle: FAQ\n---\n");
    await ctx.changes.snapshot(s.id, cwd);
    expect((await ctx.changes.current(s.id, false))?.notionChanges).toBeUndefined();

    const yaml = path.join(cwd, "site.yaml");
    const text = fs.readFileSync(yaml, "utf8");
    fs.writeFileSync(
      yaml,
      text.replace(
        /^ {2}sources:\n/m,
        "  sources:\n    - type: Notion\n      name: stolen\n      collection: post\n      notion:\n        databaseId: 12345678901234567890123456789012\n",
      ),
    );
    await ctx.changes.snapshot(s.id, cwd);
    // The unquoted all-digit id stays text, as Bukit reads it.
    expect((await ctx.changes.current(s.id, false))?.notionChanges).toEqual([
      {
        source: "stolen",
        change: "added",
        databaseId: { before: null, after: "12345678901234567890123456789012" },
        keys: [],
      },
    ]);

    fs.writeFileSync(yaml, `${text}\n: : not yaml [\n`);
    await ctx.changes.snapshot(s.id, cwd);
    expect((await ctx.changes.current(s.id, false))?.notionChanges).toEqual([
      { source: "site.yaml", change: "unreadable", keys: [] },
    ]);
  });

  it("applies with the fingerprint, rebuilds the main preview, and rejects", async () => {
    const s = await site();
    const session = ctx.agent.create(s.id);
    const { cwd } = await ctx.changes.begin(s.id, session.id);
    fs.writeFileSync(path.join(cwd, "content/pages/faq.md"), "---\ntitle: FAQ\n---\n");
    await ctx.changes.snapshot(s.id, cwd);
    const change = (await ctx.changes.current(s.id, false)) as ChangeSet;
    const events = changeEvents(s.id);

    for (const bad of [
      {},
      { treeHash: "abc" },
      { treeHash: change.treeHash, extra: 1 },
      { treeHash: change.treeHash, force: "yes" },
      { treeHash: change.treeHash, selection: [] },
      { treeHash: change.treeHash, selection: [{ path: "a.md" }, { path: "a.md" }] },
      { treeHash: change.treeHash, selection: [{ path: "../a.md" }] },
      { treeHash: change.treeHash, selection: [{ path: "a.md", hunks: [] }] },
      { treeHash: change.treeHash, selection: [{ path: "a.md", hunks: [1, 1] }] },
      { treeHash: change.treeHash, selection: [{ path: "a.md", hunks: [-1] }] },
      { treeHash: change.treeHash, selection: [{ path: "a.md" }] },
    ]) {
      expect((await call("POST", `/api/changes/${change.id}/apply`, bad)).json).toEqual({
        code: "request.invalid_body",
      });
    }
    expect((await call("POST", `/api/changes/${change.id}/apply`, { treeHash: "0".repeat(40) })).json).toEqual({
      code: "change.fingerprint_mismatch",
    });

    // A running or queued conversation is about to change what was reviewed.
    const busy = vi.spyOn(ctx.agent, "busy").mockReturnValue(true);
    try {
      expect(await call("POST", `/api/changes/${change.id}/apply`, { treeHash: change.treeHash })).toMatchObject({
        status: 409,
        json: { code: "site.busy" },
      });
    } finally {
      busy.mockRestore();
    }

    const buildsBefore = ctx.builds.list(s.id).length;
    const applied = await call<ApplyResult>("POST", `/api/changes/${change.id}/apply`, { treeHash: change.treeHash });
    expect(applied.status).toBe(200);
    expect(applied.json).toMatchObject({ outcome: "applied", change: { status: "applied" } });
    await until(() => ctx.builds.list(s.id).length > buildsBefore);
    await ctx.builds.settled();
    expect(ctx.builds.list(s.id)[0]).toMatchObject({ ref: "main", commit: applied.json.change.resultCommit });
    // Once nothing is open, the stream says so.
    await until(() => events.got.at(-1) === null);
    events.close();

    const next = await ctx.changes.begin(s.id, session.id);
    expect((await call("POST", `/api/changes/${next.change.id}/reject`)).json).toMatchObject({ status: "rejected" });
    expect((await call("POST", `/api/changes/${next.change.id}/reject`)).json).toEqual({
      code: "change.not_open",
      params: { status: "rejected" },
    });
  });
});

describe("change set previews", () => {
  async function build(siteId: string, ref: "main" | "change"): Promise<Build> {
    const started = await ctx.builds.start(siteId, ref);
    await ctx.builds.settled();
    return ctx.builds.get(siteId, started.id);
  }

  it("builds the open change set in the AI checkout and previews only that change set", async () => {
    const s = await site();
    await expect(ctx.builds.start(s.id, "change")).rejects.toMatchObject({ code: "change.not_found" });
    await expect(ctx.builds.openPreview(s.id, "change")).rejects.toMatchObject({ code: "change.not_found" });

    const session = ctx.agent.create(s.id);
    const { cwd, change } = await ctx.changes.begin(s.id, session.id);
    await expect(ctx.builds.openPreview(s.id, "change")).rejects.toMatchObject({ code: "preview.not_built" });
    // Edited outside a run: the build snapshots the checkout first and builds exactly that commit.
    fs.writeFileSync(path.join(cwd, "marker"), "from-the-ai");
    const b = await build(s.id, "change");
    const snapshot = ctx.changes.store.get(change.id)?.snapshotCommit;
    expect(b).toMatchObject({ ref: "change", status: "succeeded", hasOutput: true, commit: snapshot });
    expect(snapshot).not.toBe(change.baseCommit);
    // Nothing was written in the site folder, and the build directory left the checkout.
    expect(fs.existsSync(path.join(s.dir, "marker"))).toBe(false);
    expect(s.git("status", "--porcelain")).toBe("");
    expect(fs.existsSync(path.join(cwd, ".bukitjalil-build", b.id))).toBe(false);

    const opened = (await ctx.builds.openPreview(s.id, "change")) as PreviewResponse;
    expect(opened).toMatchObject({ ref: "change", buildId: b.id, commit: snapshot });
    expect((await httpGet(opened.port)).body).toContain("from-the-ai");
    // The main preview is its own build of the default branch.
    const mainPreview = await ctx.builds.openPreview(s.id, "main");
    expect(mainPreview.port).not.toBe(opened.port);
    expect((await httpGet(mainPreview.port)).body).not.toContain("from-the-ai");

    // Once the change set is closed, its preview port goes and its builds are not offered again.
    await ctx.changes.reject(change.id);
    for (let i = 0; i < 100 && ctx.previews.rootOf(PreviewPool.key(s.id, "change")) !== null; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(ctx.previews.rootOf(PreviewPool.key(s.id, "change"))).toBeNull();
    const next = await ctx.changes.begin(s.id, session.id);
    expect(next.change.id).not.toBe(change.id);
    await expect(ctx.builds.openPreview(s.id, "change")).rejects.toMatchObject({ code: "preview.not_built" });
  });

  it("refuses an unsafe change without marking the site read-only", async () => {
    const s = await site();
    const session = ctx.agent.create(s.id);
    const { cwd } = await ctx.changes.begin(s.id, session.id);
    fs.mkdirSync(path.join(cwd, "plugins"));
    fs.writeFileSync(path.join(cwd, "plugins/x.js"), "export {};\n");
    const b = await build(s.id, "change");
    expect(b).toMatchObject({ ref: "change", status: "failed", outcome: "refused", hasOutput: false });
    expect(b.report?.reasons?.map((r) => r.code)).toContain("plugin_files");
    expect(ctx.sites.get(s.id).readOnly).toBeNull();
  });
});

describe("history and restore", () => {
  async function call<T>(method: string, url: string) {
    const init: RequestInit =
      method === "GET"
        ? {}
        : { method, body: "{}", headers: { "content-type": "application/json", "x-bukitjalil": "1", origin: ADMIN } };
    const res = await ctx.app.request(req(url, init));
    return { status: res.status, json: (await res.json()) as T & { code?: string } };
  }

  /** A site whose history is: init, then an applied AI change set that adds an FAQ page. */
  async function withHistory() {
    const s = await site();
    const session = ctx.agent.create(s.id);
    const { cwd } = await ctx.changes.begin(s.id, session.id);
    fs.writeFileSync(path.join(cwd, "content/pages/faq.md"), "---\ntitle: FAQ\n---\n");
    fs.appendFileSync(path.join(cwd, "site.yaml"), "# faq\n");
    await ctx.changes.snapshot(s.id, cwd);
    ctx.changes.setSummary(s.id, "Added an FAQ page.");
    const view = await ctx.changes.current(s.id, false);
    if (!view) throw new Error("no change set");
    await ctx.changes.apply(view.id, { treeHash: view.treeHash });
    await ctx.builds.settled();
    return { s, session, init: s.git("rev-parse", "HEAD^"), applied: s.git("rev-parse", "HEAD") };
  }

  it("lists the default branch's versions with their trailers, newest first, a page at a time", async () => {
    const { s, session, init, applied } = await withHistory();
    const res = await call<HistoryResponse>("GET", `/api/sites/${s.id}/history`);
    expect(res.status).toBe(200);
    expect(res.json.hasMore).toBe(false);
    expect(res.json.entries.map((e) => e.commit)).toEqual([applied, init]);
    expect(res.json.entries[0]).toMatchObject({
      subject: "Added an FAQ page.",
      body: "",
      parents: [init],
      authorName: "BukitJalil AI",
      byAi: true,
      sessionIds: [session.id],
      restoreOf: null,
      filesChanged: 2,
    });
    expect(res.json.entries[1]).toMatchObject({ subject: "init", parents: [], byAi: false });
    expect(res.json.entries[1]?.filesChanged).toBeGreaterThan(2);

    const second = await call<HistoryResponse>("GET", `/api/sites/${s.id}/history?skip=1`);
    expect(second.json.entries.map((e) => e.commit)).toEqual([init]);
    // Only the last paragraph holds trailers: a forged line in the body is shown as text.
    const init2 = s.git("rev-parse", "HEAD");
    const forged = s.git(
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit-tree",
      `${init2}^{tree}`,
      "-p",
      init2,
      "-m",
      `forged\nBukitJalil-Restore: ${init}\n\nlast paragraph`,
    );
    s.git("update-ref", "refs/heads/main", forged);
    const top = (await listHistory(ctx.git, s.dir, "main", { skip: 0, limit: 1 })).entries[0];
    expect(top).toMatchObject({ subject: "forged", restoreOf: null });
    expect(top?.body).toContain(`BukitJalil-Restore: ${init}`);
    s.git("update-ref", "refs/heads/main", init2);
    const page = await listHistory(ctx.git, s.dir, "main", { skip: 0, limit: 1 });
    expect(page).toMatchObject({ hasMore: true, entries: [{ commit: applied }] });
    expect((await call("GET", `/api/sites/${s.id}/history?skip=-1`)).status).toBe(400);
  });

  it("shows what a version changed, against its parent or the empty tree", async () => {
    const { s, init, applied } = await withHistory();
    const diff = await call<{ files: { path: string; status: string }[] }>(
      "GET",
      `/api/sites/${s.id}/history/${applied}/diff`,
    );
    expect(diff.status).toBe(200);
    expect(diff.json.files.map((f) => `${f.status} ${f.path}`)).toEqual([
      "added content/pages/faq.md",
      "modified site.yaml",
    ]);
    const file = await call<FileDiff>(
      "GET",
      `/api/sites/${s.id}/history/${applied}/diff?path=${encodeURIComponent("site.yaml")}`,
    );
    expect(file.json.patch).toContain("+# faq");

    // The first version: every file is new.
    const first = await call<{ files: { status: string }[] }>("GET", `/api/sites/${s.id}/history/${init}/diff`);
    expect(first.json.files.length).toBeGreaterThan(2);
    expect(new Set(first.json.files.map((f) => f.status))).toEqual(new Set(["added"]));

    // Not a version of this site: a commit off the branch, an unknown object, a malformed id.
    const loose = s.git("-c", "user.name=t", "-c", "user.email=t@t", "commit-tree", "HEAD^{tree}", "-m", "loose");
    expect((await call("GET", `/api/sites/${s.id}/history/${loose}/diff`)).json.code).toBe("history.not_found");
    expect((await call("GET", `/api/sites/${s.id}/history/${"a".repeat(40)}/diff`)).status).toBe(404);
    expect((await call("GET", `/api/sites/${s.id}/history/HEAD/diff`)).status).toBe(400);
    const missing = await call("GET", `/api/sites/${s.id}/history/${applied}/diff?path=nope.md`);
    expect(missing.json.code).toBe("change.file_not_found");
  });

  it("restores a version as a change set that the user applies as its author", async () => {
    const { s, session, init, applied } = await withHistory();
    // A conversation that changed nothing leaves an empty change set, which gives way to the restore.
    const empty = await ctx.changes.begin(s.id, session.id);
    const restored = await call<RestoreResult>("POST", `/api/sites/${s.id}/history/${init}/restore`);
    expect(ctx.changes.get(empty.change.id).status).toBe("rejected");
    expect(restored.status).toBe(200);
    expect(restored.json.guard).toEqual({ ok: true, reasons: [] });
    expect(restored.json.change).toMatchObject({
      status: "open",
      baseCommit: applied,
      restoreOf: init,
      summary: `Restore to ${init.slice(0, 7)}: init`,
    });
    // The site folder is untouched until it is applied; the AI checkout holds the old version.
    expect(s.git("rev-parse", "HEAD")).toBe(applied);
    const view = await ctx.changes.current(s.id, false);
    if (!view) throw new Error("no change set");
    expect(view.treeHash).toBe(s.git("rev-parse", `${init}^{tree}`));
    expect(view.files.map((f) => `${f.status} ${f.path}`)).toEqual([
      "deleted content/pages/faq.md",
      "modified site.yaml",
    ]);
    expect(fs.existsSync(path.join(ctx.paths.worktrees, s.id, "ai", "content/pages/faq.md"))).toBe(false);

    // Only one change set at a time, and nothing to restore to the current version.
    const again = await call("POST", `/api/sites/${s.id}/history/${init}/restore`);
    expect([again.status, again.json.code]).toEqual([409, "change.open_exists"]);

    const result = await ctx.changes.apply(view.id, { treeHash: view.treeHash });
    expect(result.outcome).toBe("applied");
    expect(s.git("rev-parse", "HEAD^")).toBe(applied);
    expect(s.git("rev-parse", "HEAD^{tree}")).toBe(s.git("rev-parse", `${init}^{tree}`));
    expect(s.git("log", "-1", "--format=%an <%ae>|%cn <%ce>")).toBe(
      "Site Owner <owner@example.com>|Site Owner <owner@example.com>",
    );
    expect(s.git("log", "-1", "--format=%B")).toBe(
      `Restore to ${init.slice(0, 7)}: init\n\nBukitJalil-Restore: ${init}`,
    );
    const history = await ctx.changes.history(s.id, 0);
    expect(history.entries[0]).toMatchObject({ restoreOf: init, byAi: false, sessionIds: [] });

    const same = await call("POST", `/api/sites/${s.id}/history/${init}/restore`);
    expect([same.status, same.json.code]).toEqual([409, "change.same_version"]);
    const loose = s.git("-c", "user.name=t", "-c", "user.email=t@t", "commit-tree", `${applied}^{tree}`, "-m", "loose");
    const off = await call("POST", `/api/sites/${s.id}/history/${loose}/restore`);
    expect([off.status, off.json.code]).toEqual([404, "history.not_found"]);
  });

  it("refuses a restore on a read-only site, while a conversation is busy and while the site is locked", async () => {
    const { s, init } = await withHistory();
    const url = `/api/sites/${s.id}/history/${init}/restore`;
    const busy = vi.spyOn(ctx.agent, "busy").mockReturnValue(true);
    try {
      expect(await call("POST", url)).toMatchObject({ status: 409, json: { code: "site.busy" } });
    } finally {
      busy.mockRestore();
    }
    const release = ctx.locks.acquire(s.id, "build");
    expect(await call("POST", url)).toMatchObject({ status: 409, json: { code: "site.busy" } });
    release();
    ctx.sites.store.setState(s.id, { readOnly: [{ code: "plugin_files" }], checkedCommit: null, configCheck: null });
    expect(await call("POST", url)).toMatchObject({ status: 409, json: { code: "site.read_only" } });
    expect(ctx.changes.store.open(s.id)).toBeNull();
  });

  it("keeps the AI as author once a conversation has added to a restore", async () => {
    const { s, session, init } = await withHistory();
    await ctx.changes.restore(s.id, init);
    const { cwd } = await ctx.changes.begin(s.id, session.id);
    fs.writeFileSync(path.join(cwd, "extra.md"), "extra\n");
    await ctx.changes.snapshot(s.id, cwd);
    const view = await ctx.changes.current(s.id, false);
    if (!view) throw new Error("no change set");
    expect(view.restoreOf).toBe(init);
    await ctx.changes.apply(view.id, { treeHash: view.treeHash });
    expect(s.git("log", "-1", "--format=%an|%cn")).toBe("BukitJalil AI|Site Owner");
    expect(s.git("log", "-1", "--format=%B")).toBe(
      `Restore to ${init.slice(0, 7)}: init\n\nBukitJalil-Sessions: ${session.id}\nBukitJalil-Restore: ${init}`,
    );
  });

  it("keeps the AI as author of its edits on a restore after the conversation was deleted", async () => {
    const { s, session, init } = await withHistory();
    await ctx.changes.restore(s.id, init);
    const { cwd } = await ctx.changes.begin(s.id, session.id);
    fs.writeFileSync(path.join(cwd, "extra.md"), "extra\n");
    await ctx.changes.snapshot(s.id, cwd);
    await ctx.agent.delete(session.id);
    const view = await ctx.changes.current(s.id, false);
    if (!view) throw new Error("no change set");
    await ctx.changes.apply(view.id, { treeHash: view.treeHash });
    expect(s.git("log", "-1", "--format=%an")).toBe("BukitJalil AI");
  });

  it("keeps the user as author of a restore that was merged onto a default branch that moved", async () => {
    const { s, init } = await withHistory();
    const restored = await ctx.changes.restore(s.id, init);
    fs.writeFileSync(path.join(s.dir, "outside.md"), "outside\n");
    s.git("add", "-A");
    s.git("-c", "user.name=T", "-c", "user.email=t@example.com", "commit", "-q", "-m", "outside BukitJalil");
    const view = await ctx.changes.current(s.id, false);
    if (!view) throw new Error("no change set");
    const rebased = await ctx.changes.apply(restored.change.id, { treeHash: view.treeHash });
    expect(rebased.outcome).toBe("rebased");
    const applied = await ctx.changes.apply(restored.change.id, { treeHash: rebased.change.treeHash });
    expect(applied.outcome).toBe("applied");
    expect(s.git("log", "-1", "--format=%an|%cn")).toBe("Site Owner|Site Owner");
  });

  it("reports the pre-build guard's verdict on the restored version", async () => {
    const s = await site();
    fs.mkdirSync(path.join(s.dir, "plugins"));
    fs.writeFileSync(path.join(s.dir, "plugins/x.js"), "export {};\n");
    commitAllAs(base, s.dir, "plugins");
    const unsafe = s.git("rev-parse", "HEAD");
    fs.rmSync(path.join(s.dir, "plugins"), { recursive: true });
    commitAllAs(base, s.dir, "no plugins");
    const restored = await ctx.changes.restore(s.id, unsafe);
    expect(restored.guard.ok).toBe(false);
    expect(restored.guard.reasons.map((r) => r.code)).toContain("plugin_files");
    expect(restored.change.restoreOf).toBe(unsafe);
  });
});

describe("built-in plugin switches (Settings → site Config)", () => {
  it("creates a reviewable site.yaml change and leaves the site unchanged when rejected", async () => {
    const s = await site();
    const before = fs.readFileSync(path.join(s.dir, "site.yaml"), "utf8");
    const result = await ctx.changes.setPlugin(s.id, "related-content", false);
    expect(result.change?.files).toEqual([expect.objectContaining({ path: "site.yaml", status: "modified" })]);
    expect(result.change?.summary).toBe("Plugin settings: related-content off");
    const diff = await ctx.changes.diff(result.change?.id ?? "", "site.yaml");
    expect(diff.patch).toContain("related-content");
    expect(diff.patch).toContain("false");
    await ctx.changes.reject(result.change?.id ?? "");
    expect(fs.readFileSync(path.join(s.dir, "site.yaml"), "utf8")).toBe(before);
    expect(ctx.changes.store.open(s.id)).toBeNull();
  });

  it("applies as the user and keeps a site.plugins entry", async () => {
    const s = await site();
    const change = (await ctx.changes.setPlugin(s.id, "related-content", false)).change;
    const applied = await ctx.changes.apply(change?.id ?? "", { treeHash: change?.treeHash ?? "" });
    expect(applied.outcome).toBe("applied");
    expect(s.git("show", "HEAD:site.yaml")).toContain("related-content: false");
    expect(s.git("log", "-1", "--format=%an|%cn")).toBe("Site Owner|Site Owner");
    expect(s.git("log", "-1", "--format=%s")).toBe("Plugin settings: related-content off");
  });

  it("exposes the toggle through the API", async () => {
    const s = await site();
    const res = await ctx.app.fetch(req(`/api/sites/${s.id}/plugins/related-content`, jsonPut({ enabled: false })));
    expect(res.status).toBe(200);
    const body = (await res.json()) as CurrentChange;
    expect(body.change?.files).toContainEqual(expect.objectContaining({ path: "site.yaml" }));
    await ctx.changes.reject(body.change?.id ?? "");
  });

  it("rejects an invalid site.plugins without leaving a change set", async () => {
    const s = await site();
    fs.writeFileSync(
      path.join(s.dir, "site.yaml"),
      "site:\n  name: bad\n  title: Bad\n  plugins: bad\ncontent:\n  sources: []\n",
    );
    commitAllAs(base, s.dir, "bad plugins");
    await expect(ctx.changes.setPlugin(s.id, "related-content", false)).rejects.toMatchObject({
      code: "config.plugins_invalid",
    });
    expect(ctx.changes.store.open(s.id)).toBeNull();
  });

  it("refuses read-only and busy sites before writing", async () => {
    const readOnly = await site();
    ctx.sites.store.setState(readOnly.id, {
      readOnly: [{ code: "missing_site_yaml" }],
      checkedCommit: null,
      configCheck: null,
    });
    await expect(ctx.changes.setPlugin(readOnly.id, "related-content", false)).rejects.toMatchObject({
      code: "site.read_only",
    });

    const busy = await site();
    const release = ctx.locks.acquire(busy.id, "build");
    try {
      await expect(ctx.changes.setPlugin(busy.id, "related-content", false)).rejects.toMatchObject({
        code: "site.busy",
      });
    } finally {
      release();
    }
  });

  it("does not create a change set for a no-op toggle", async () => {
    const s = await site();
    const result = await ctx.changes.setPlugin(s.id, "related-content", true);
    expect(result.change).toBeNull();
    expect(ctx.changes.store.open(s.id)).toBeNull();
  });

  it("joins an existing AI change set", async () => {
    const s = await site();
    const session = ctx.agent.create(s.id);
    const { change } = await ctx.changes.begin(s.id, session.id);
    const result = await ctx.changes.setPlugin(s.id, "related-content", false);
    expect(result.change?.id).toBe(change.id);
    expect(result.change?.sessionIds).toContain(session.id);
    await ctx.changes.reject(change.id);
  });
});

describe("commitText", () => {
  it("keeps a short first line and gives a long paragraph a subject from its first sentence", () => {
    expect(commitText("Add FAQ page")).toBe("Add FAQ page");
    expect(commitText("Title\n\nbody")).toBe("Title\n\nbody");
    const zh =
      "已把网站做成中英双语官网（中文默认 zh-CN）。页面：首页、服务、关于我们、联系我们和常见问题，中英文各一套，并加了 GEO 信息和网址。示例文章已设为草稿，示例特色模块已停用，导航栏按语言显示菜单。";
    expect(commitText(zh)).toBe(`已把网站做成中英双语官网（中文默认 zh-CN）\n\n${zh}`);
    const en = `Made the site bilingual (see https://example.com/a.b). ${"More words follow here. ".repeat(4)}`;
    expect(commitText(en).split("\n")[0]).toBe("Made the site bilingual (see https://example.com/a.b).");
    // A body right after a short title gets the blank line git needs; forged trailers are dropped.
    expect(commitText("Add FAQ\nwith five questions\n\nmore")).toBe("Add FAQ\n\nwith five questions\n\nmore");
    expect(commitText("Add FAQ\nBukitJalil-Restore: abc\n  bukitjalil-sessions: x\nDone")).toBe("Add FAQ\n\nDone");
    expect(commitText("BukitJalil-Restore: abc")).toBe("Changes made with BukitJalil AI");
    const long = commitText("x".repeat(100)).split("\n")[0] ?? "";
    expect([...long]).toHaveLength(72);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("hunks (plan 7.5)", () => {
  const b = (text: string) => Buffer.from(text);
  it("reads the line ranges of each hunk header, empty sides included", () => {
    const patch =
      "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -0,0 +1,2 @@\n+a\n+b\n@@ -5 +7,0 @@ ctx\n-gone\n+@@ -9,9 +9,9 @@\n";
    expect(parseHunks(patch)).toEqual([
      { oldStart: 0, oldCount: 0, newStart: 0, newCount: 2 },
      { oldStart: 4, oldCount: 1, newStart: 7, newCount: 0 },
    ]);
  });
  it("replaces the selected ranges and keeps the rest of the old file", () => {
    const before = b("a\nb\nc\nd\n");
    const after = b("A\nb\nc\nD");
    const hunks = [
      { oldStart: 0, oldCount: 1, newStart: 0, newCount: 1 },
      { oldStart: 3, oldCount: 1, newStart: 3, newCount: 1 },
    ];
    expect(applyHunks(before, after, hunks, new Set([0, 1]))?.toString()).toBe("A\nb\nc\nD");
    expect(applyHunks(before, after, hunks, new Set([0]))?.toString()).toBe("A\nb\nc\nd\n");
    expect(applyHunks(before, after, hunks, new Set([1]))?.toString()).toBe("a\nb\nc\nD");
    expect(applyHunks(before, after, hunks, new Set())?.toString()).toBe("a\nb\nc\nd\n");
    // Ranges outside the files, or out of order, do not fit.
    expect(
      applyHunks(before, after, [{ oldStart: 3, oldCount: 5, newStart: 0, newCount: 1 }], new Set([0])),
    ).toBeNull();
    expect(applyHunks(before, after, [...hunks].reverse(), new Set([0]))).toBeNull();
  });
});

describe("diffSummary (plan 6.3)", () => {
  const file = (path: string, status: ChangedFile["status"]): ChangedFile => ({
    path,
    status,
    additions: 1,
    deletions: 0,
    binary: false,
  });
  it("counts by kind and names at most three files", () => {
    expect(diffSummary({ files: [file("a.md", "added")], truncated: false })).toBe("Add 1 file: a.md");
    expect(
      diffSummary({
        files: [file("a", "modified"), file("b", "deleted"), file("c", "type_changed"), file("d", "added")],
        truncated: false,
      }),
    ).toBe("Update 2 files, add 1 file, delete 1 file: a, b, c, ...");
  });
  it("drops names to fit the subject line, keeping the counts", () => {
    const long = (n: number) => `content/pages/${"x".repeat(n)}.md`;
    const two = diffSummary({ files: [file(long(20), "added"), file(long(40), "added")], truncated: false });
    expect(two).toBe(`Add 2 files: ${long(20)}, ...`);
    expect(two.length).toBeLessThanOrEqual(72);
    expect(diffSummary({ files: [file(long(80), "modified")], truncated: false })).toBe("Update 1 file");
  });
  it("falls back to the fixed text for an empty or cut list", () => {
    expect(diffSummary({ files: [], truncated: false })).toBe("Changes made with BukitJalil AI");
    expect(diffSummary({ files: [file("a", "added")], truncated: true })).toBe("Changes made with BukitJalil AI");
  });
});
