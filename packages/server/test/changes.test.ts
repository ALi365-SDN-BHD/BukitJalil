import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { preparePiEnvironment } from "../src/agent/env.ts";
import { loadPi, type PiModules } from "../src/agent/pi.ts";
import { BukitService } from "../src/bukit/locate.ts";
import { MAX_FILES, MAX_PATCH_BYTES } from "../src/changes/diff.ts";
import { changeRef } from "../src/changes/service.ts";
import { copyStarter } from "../src/sites/template.ts";
import { SettingsStore } from "../src/store/settings.ts";
import { commitAllAs, makeApp, rawGit } from "./helpers.ts";

// M4 layers 1 and 2 (plan 7.2): change sets. A run opens the site's change set (or joins the open one),
// works in the ai/ checkout, and its result is snapshotted into the change set; the site folder only
// changes when a change set is applied.

const STARTER = path.resolve(import.meta.dirname, "../../../templates/starter");

let base: string;
let ctx: ReturnType<typeof makeApp>;
let pi: PiModules;
let faux: ReturnType<PiModules["ai"]["fauxProvider"]>;
let n = 0;
let settings: SettingsStore;

/** Stand-in Bukit: checks pass unless the checkout has a file named fake-doctor; builds write a page. */
const FAKE_BUKIT = `#!/bin/sh
case "$1" in
  version) echo "bukit 2.0.11+fake"; exit 0;;
  config) echo "config ok"; exit 0;;
  doctor) if [ -f fake-doctor ]; then echo "doctor: template missing"; exit 1; fi; echo "doctor ok"; exit 0;;
  build)
    out=""; prev=""
    for a in "$@"; do if [ "$prev" = "--output" ]; then out="$a"; fi; prev="$a"; done
    mkdir -p "$out"; echo "<h1>home</h1>" > "$out/index.html"; exit 0;;
esac
exit 1
`;

beforeAll(async () => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bj-changes-")));
  fs.mkdirSync(path.join(base, "home"));
  const fakeBin = path.join(base, "fake-bukit");
  fs.writeFileSync(fakeBin, FAKE_BUKIT, { mode: 0o755 });
  ctx = makeApp({
    bukit: new BukitService({
      home: path.join(base, "bk"),
      tmpDir: path.join(base, "bk-tmp"),
      customPath: () => fakeBin,
      envPath: "",
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
    // A closed change set can still be shown: its ref keeps the snapshot from garbage collection.
    expect(s.git("rev-parse", changeRef(view.id))).toBe(rejected.snapshotCommit);
    s.git("gc", "-q", "--prune=now");
    expect((await ctx.changes.diff(view.id, "content/pages/faq.md")).patch).toContain("FAQ");
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
});
