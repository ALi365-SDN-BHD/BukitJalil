import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Deploy, DeployListResponse, DeployStatusResponse } from "@bukitjalil/shared";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { BukitService } from "../src/bukit/locate.ts";
import { deployTarget, pagesUrl } from "../src/deploys/target.ts";
import { resolveGitPath } from "../src/git/run.ts";
import { copyStarter } from "../src/sites/template.ts";
import { ADMIN, commitAllAs, installAppBukit, makeApp, rawGit, req, testBukitDir } from "./helpers.ts";

// M6 (plan 14): where a site is published, read from site.yaml on the default branch.

const STARTER = path.resolve(import.meta.dirname, "../../../templates/starter");
const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bj-deploys-")));
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

describe("deployTarget", () => {
  it("reads a valid target and fills in the branch and address", () => {
    expect(deployTarget({ deploy: { provider: "github-pages", repo: "3721-my/3721-my.github.io" } })).toEqual({
      repo: "3721-my/3721-my.github.io",
      branch: "gh-pages",
      cname: null,
      url: "https://3721-my.github.io/",
      problem: null,
    });
    expect(deployTarget({ deploy: { repo: "Owner/site", branch: "pages/live", cname: "WWW.Example.com" } })).toEqual({
      repo: "Owner/site",
      branch: "pages/live",
      cname: "www.example.com",
      url: "https://www.example.com/",
      problem: null,
    });
  });

  it("names what is missing or wrong", () => {
    expect(deployTarget(null).problem).toBe("no_config");
    expect(deployTarget({ site: {} }).problem).toBe("not_configured");
    expect(deployTarget({ deploy: { branch: "gh-pages" } }).problem).toBe("not_configured");
    expect(deployTarget({ deploy: { provider: "netlify", repo: "a/b" } }).problem).toBe("bad_provider");
    for (const repo of ["https://github.com/a/b", "a/b.git", "a/..", "-a/b", "a/b/c", 7]) {
      expect(deployTarget({ deploy: { repo } }).problem).toBe("bad_repo");
    }
    for (const branch of ["-f", "a..b", "a b", "x.lock", "a/", "", 1]) {
      expect(deployTarget({ deploy: { repo: "a/b", branch } })).toMatchObject({ repo: "a/b", problem: "bad_branch" });
    }
    // Bukit would write a bad cname into CNAME as it is: refused, not hidden.
    expect(deployTarget({ deploy: { repo: "a/b", cname: "https://www.example.com" } })).toMatchObject({
      repo: "a/b",
      problem: "bad_cname",
    });
    expect(deployTarget({ deploy: { repo: "a/b", cname: 3 } }).problem).toBe("bad_cname");
    expect(deployTarget({ deploy: { repo: "a/b", cname: null } })).toMatchObject({ cname: null, problem: null });
  });

  it("knows user and project sites", () => {
    expect(pagesUrl("Someone/someone.github.io", null)).toBe("https://someone.github.io/");
    expect(pagesUrl("someone/blog", null)).toBe("https://someone.github.io/blog/");
  });
});

describe("GET /api/sites/:id/deploy", () => {
  it("reports the target of the default branch and whether a publish can start", async () => {
    const ctx = makeApp({ appHome: path.join(base, "app"), userHome: base });
    const dir = path.join(base, "site");
    copyStarter(STARTER, dir, { title: "Deploy", language: "en-US" });
    rawGit(base, dir, "init", "-q", "-b", "main");
    commitAllAs(base, dir, "init");
    const site = await ctx.sites.import({ path: dir });
    const status = async () =>
      (await (await ctx.app.fetch(req(`/api/sites/${site.id}/deploy`))).json()) as DeployStatusResponse;

    expect(await status()).toMatchObject({ target: { problem: "not_configured" }, account: null, ready: false });
    fs.appendFileSync(path.join(dir, "site.yaml"), "\ndeploy:\n  repo: someone/blog\n  branch: pages\n");
    commitAllAs(base, dir, "deploy");
    const head = rawGit(base, dir, "rev-parse", "HEAD").trim();
    expect(await status()).toMatchObject({
      commit: head,
      target: { repo: "someone/blog", branch: "pages", url: "https://someone.github.io/blog/", problem: null },
      account: null,
      ready: false,
    });
    const account = ctx.publishAccounts.create({
      platform: "github",
      name: "GitHub",
      token: "ghp_testtokentesttoken",
    });
    ctx.sites.setPublishAccountId(site.id, account.id);
    expect(await status()).toMatchObject({
      account: { id: account.id, name: "GitHub", hasToken: true },
      ready: true,
    });
    // Uncommitted edits in the site folder are not what gets published.
    fs.appendFileSync(path.join(dir, "site.yaml"), "\n# local\n");
    expect((await status()).commit).toBe(head);
  });

  it("refuses the site's source branch as the publish branch", async () => {
    const ctx = makeApp({ appHome: path.join(base, "app-source"), userHome: base });
    const dir = path.join(base, "site-source");
    copyStarter(STARTER, dir, { title: "Source", language: "en-US" });
    rawGit(base, dir, "init", "-q", "-b", "main");
    fs.appendFileSync(path.join(dir, "site.yaml"), "\ndeploy:\n  repo: someone/source\n  branch: main\n");
    commitAllAs(base, dir, "deploy");
    const site = await ctx.sites.import({ path: dir });
    const status = (await (await ctx.app.fetch(req(`/api/sites/${site.id}/deploy`))).json()) as DeployStatusResponse;

    expect(status).toMatchObject({ target: { repo: "someone/source", branch: "main", problem: "source_branch" } });
    expect(status.ready).toBe(false);
  });
});

/**
 * Stand-in for bukit: logs each call (arguments, the token and identity it got) to calls.log next to
 * itself. The committed file fake-fail names a step that fails; deploy writes deployed.txt with the
 * files it was given.
 */
const FAKE = (log: string) => `#!/bin/sh
echo "$* | token=\${BUKIT_DEPLOY_TOKEN:-} author=\${GIT_AUTHOR_NAME:-} committer=\${GIT_COMMITTER_EMAIL:-} gitcount=\${GIT_CONFIG_COUNT:-}" >> "${log}"
[ -n "\${NOTION_TOKEN:-}" ] && echo "$1 $NOTION_TOKEN" >> "${log}.notion"
fail=$(cat fake-fail 2>/dev/null)
case "$1" in
  version) echo "bukit 2.0.12+fake"; exit 0;;
  config) [ "$fail" = check ] && { echo '{"ts":"t","level":"error","msg":"event=config.invalid"}' >&2; exit 2; }; exit 0;;
  doctor) [ "$fail" = doctor ] && exit 1; exit 0;;
  build)
    out=""; prev=""
    for a in "$@"; do if [ "$prev" = "--output" ]; then out="$a"; fi; prev="$a"; done
    [ "$fail" = build ] && { echo '{"ts":"t","level":"error","msg":"event=content.error file=x.md"}' >&2; exit 2; }
    mkdir -p "$out/.bukit"
    if [ "$fail" = multilingual ]; then mkdir -p "$out/de-DE" "$out/en-US"; echo de > "$out/de-DE/index.html"; echo en > "$out/en-US/index.html"
    else echo "<h1>site</h1>" > "$out/index.html"; fi
    echo '{"siteUrl":"https://someone.github.io/blog","documents":[{},{}],"issues":[{"severity":"warning","code":"publish.time_missing","route":"/a/","message":"No time."}]}' > "$out/.bukit/publish-audit-report.json"
    exit 0;;
  publish) [ "$fail" = audit ] && { echo "error publish.broken_link /a/ Broken." >&2; exit 1; }; exit 0;;
  deploy)
    [ "$fail" = deploy ] && { echo "[error] Deployment failed: push rejected" >&2; exit 1; }
    [ "$fail" = leak ] && { echo "fatal: https://x-access-token:$BUKIT_DEPLOY_TOKEN@github.com/someone/blog.git rejected" >&2; echo "{\\"ts\\":\\"t\\",\\"level\\":\\"error\\",\\"msg\\":\\"token $BUKIT_DEPLOY_TOKEN\\"}" >&2; exit 1; }
    out=""; prev=""
    for a in "$@"; do if [ "$prev" = "--output" ]; then out="$a"; fi; prev="$a"; done
    (cd "$out" && find . -type f | sort) > "${log}.deployed"
    cp "$out/index.html" "${log}.root"
    echo "[info] Git push completed."; exit 0;;
esac
exit 1
`;

const contexts: ReturnType<typeof makeApp>[] = [];
afterEach(async () => {
  await Promise.all(contexts.splice(0).map((c) => Promise.all([c.deploys.shutdown(), c.builds.shutdown()])));
});

let counter = 0;
async function publishable(opts: { fail?: string; branch?: string; notion?: boolean } = {}) {
  const name = `pub${++counter}`;
  const fakeDir = path.join(base, `${name}-bin`);
  fs.mkdirSync(fakeDir);
  const log = path.join(fakeDir, "calls.log");
  const bin = path.join(fakeDir, "bukit");
  fs.writeFileSync(bin, FAKE(log), { mode: 0o755 });
  const home = path.join(base, `${name}-bk`);
  installAppBukit(home, bin);
  const ctx = makeApp({
    appHome: path.join(base, `${name}-app`),
    userHome: base,
    bukit: new BukitService({
      dir: testBukitDir(home),
      tmpDir: path.join(base, `${name}-bk-tmp`),
    }),
  });
  contexts.push(ctx);
  const dir = path.join(base, name);
  copyStarter(STARTER, dir, { title: name, language: "en-US" });
  fs.appendFileSync(
    path.join(dir, "site.yaml"),
    `\ndeploy:\n  repo: someone/blog\n  branch: ${opts.branch ?? "gh-pages"}\n`,
  );
  if (opts.notion)
    fs.writeFileSync(
      path.join(dir, "site.yaml"),
      `site:\n  name: ${name}\n  title: ${name}\n  language: en-US\ncontent:\n  sources:\n    - name: posts\n      type: notion\n      collection: post\n      notion:\n        databaseId: abc\ndeploy:\n  repo: someone/blog\n  branch: gh-pages\n`,
    );
  if (opts.fail) fs.writeFileSync(path.join(dir, "fake-fail"), opts.fail);
  rawGit(base, dir, "init", "-q", "-b", "main");
  commitAllAs(base, dir, "init");
  const site = await ctx.sites.import({ path: dir });
  await ctx.builds.settled();
  fs.writeFileSync(log, "");
  ctx.db
    .prepare("INSERT OR REPLACE INTO settings (key, value_json) VALUES ('commitName', ?), ('commitEmail', ?)")
    .run(JSON.stringify("Site Owner"), JSON.stringify("owner@example.com"));
  const account = ctx.publishAccounts.create({
    platform: "github",
    name: "Deploy GitHub",
    token: "ghp_deploytokendeploytoken",
  });
  ctx.sites.setPublishAccountId(site.id, account.id);
  const head = rawGit(base, dir, "rev-parse", "HEAD").trim();
  const call = async (method: string, p: string, body?: unknown) => {
    const res = await ctx.app.fetch(
      req(`/api/sites/${site.id}${p}`, {
        method,
        ...(method === "GET" ? {} : { body: JSON.stringify(body ?? {}) }),
        headers: { "content-type": "application/json", "x-bukitjalil": "1", origin: ADMIN },
      }),
    );
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };
  /** Start a publish of the head and wait for it to end. */
  const publish = async () => {
    const res = await call("POST", "/deploys", { commit: head });
    expect(res.status).toBe(202);
    await ctx.deploys.settled();
    return (await call("GET", `/deploys/${(res.json as unknown as Deploy).id}`)).json as unknown as Deploy;
  };
  const calls = () =>
    fs
      .readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .filter((l) => l && !l.startsWith("version"));
  return { ctx, site, account, dir, head, call, publish, calls, log };
}

describe("publishing (M6 layer 3)", () => {
  it("refuses the site's source branch as the publish branch", async () => {
    const p = await publishable({ branch: "main" });
    const res = await p.call("POST", "/deploys", { commit: p.head });
    expect(res).toEqual({
      status: 409,
      json: { code: "deploy.no_target", params: { problem: "source_branch" } },
    });
  });

  it("checks, builds, audits and deploys exactly that output, with the token only on deploy", async () => {
    const p = await publishable();
    const events: Deploy[] = [];
    p.ctx.deploys.onEvent((d) => events.push(d));
    const d = await p.publish();
    expect(d).toMatchObject({
      status: "succeeded",
      outcome: "ok",
      commit: p.head,
      repo: "someone/blog",
      branch: "gh-pages",
      url: "https://someone.github.io/blog/",
    });
    expect(d.report?.steps.map((s) => [s.step, s.ok])).toEqual([
      ["guard", true],
      ["check", true],
      ["doctor", true],
      ["build", true],
      ["audit", true],
      ["deploy", true],
    ]);
    expect(d.report?.audit).toMatchObject({ routes: 2, warnings: 1, groups: [{ code: "publish.time_missing" }] });
    // Events follow the steps.
    expect(events.map((e) => e.step)).toEqual([
      "guard",
      "guard",
      "check",
      "doctor",
      "build",
      "audit",
      "deploy",
      "deploy",
    ]);
    expect(events.at(-1)?.status).toBe("succeeded");

    const calls = p.calls();
    expect(calls.map((c) => c.split(" ")[0])).toEqual(["config", "doctor", "build", "publish", "deploy"]);
    const out = /--output (\S+)/.exec(calls[2] ?? "")?.[1];
    expect(out).toMatch(/^\.bukitjalil-deploy\/dep_[0-9a-f]+$/);
    // The site's own base URL: no --base-url as for previews.
    expect(calls[2]).not.toContain("--base-url");
    expect(calls[3]).toContain(`publish audit --dir ${out} `);
    expect(calls[4]).toContain(
      `deploy --config site.yaml --skip-build --output ${out} --repo someone/blog --branch gh-pages --token-env BUKIT_DEPLOY_TOKEN`,
    );
    expect(calls[4]).toMatch(
      /\| token=ghp_deploytokendeploytoken author=Site Owner committer=owner@example.com gitcount=$/,
    );
    for (const c of calls.slice(0, 4)) expect(c).toContain("token= author= committer= gitcount=");
    expect(calls[0]).not.toMatch(/gitcount= *$/);
    expect(fs.readFileSync(`${p.log}.deployed`, "utf8")).toContain("./index.html");
    // The output folder is gone afterwards.
    const checkout = path.join(p.ctx.paths.worktrees, p.site.id, "main");
    expect(fs.existsSync(path.join(checkout, ".bukitjalil-deploy"))).toBe(false);

    const list = (await p.call("GET", "/deploys")).json as unknown as DeployListResponse;
    expect(list.deploys).toHaveLength(1);
    expect(list.deploys[0]).toMatchObject({ id: d.id, report: null });
  });

  for (const [fail, step] of [
    ["check", "check"],
    ["doctor", "doctor"],
    ["build", "build"],
    ["audit", "audit"],
    ["deploy", "deploy"],
  ] as const) {
    it(`stops at a failed ${fail} step and does not go on`, async () => {
      const p = await publishable({ fail });
      const d = await p.publish();
      expect(d).toMatchObject({ status: "failed", outcome: "step_failed", step });
      expect(d.report?.steps.at(-1)).toMatchObject({ step, ok: false });
      const commands = p.calls().map((c) => c.split(" ")[0]);
      const order = ["config", "doctor", "build", "publish", "deploy"];
      expect(commands).toEqual(
        order.slice(0, order.indexOf(fail === "check" ? "config" : fail === "audit" ? "publish" : fail) + 1),
      );
      if (fail === "build") expect(d.report?.messages[0]?.msg).toContain("content.error");
      if (fail === "audit") expect(d.report?.audit).toMatchObject({ warnings: 1 });
      if (fail === "deploy") expect(d.report?.output).toContain("push rejected");
    });
  }

  it("publishes a Notion site with its bound token in check, doctor and build, never in deploy", async () => {
    const p = await publishable({ notion: true });
    expect(p.ctx.sites.get(p.site.id).configCheck).toBe("notion");
    const notionLog = `${p.log}.notion`;

    // Without a bound data source nothing runs.
    const unbound = await p.publish();
    expect(unbound).toMatchObject({ status: "failed", outcome: "notion" });
    expect(p.calls()).toEqual([]);

    const source = p.ctx.dataSources.create({ platform: "notion", name: "Notion", token: "ntn_publishtoken1234" });
    const bound = await p.call("PUT", "/notion-source", { dataSourceId: source.id });
    // Binding rechecks the site: its config check now runs with the token.
    expect(bound.json).toMatchObject({ notionDataSourceId: source.id, configCheck: "ok" });
    fs.rmSync(notionLog, { force: true });
    fs.writeFileSync(p.log, "");

    const d = await p.publish();
    expect(d).toMatchObject({ status: "succeeded", outcome: "ok" });
    expect(d.report?.steps[0]).toMatchObject({ step: "guard", ok: true });
    expect(fs.readFileSync(notionLog, "utf8").trim().split("\n")).toEqual([
      "config ntn_publishtoken1234",
      "doctor ntn_publishtoken1234",
      "build ntn_publishtoken1234",
    ]);
    expect(p.calls().map((c) => c.split(" ")[0])).toEqual(["config", "doctor", "build", "publish", "deploy"]);
  });

  it("adds a root page that leads to the default language when the build has none", async () => {
    const p = await publishable({ fail: "multilingual" });
    expect(await p.publish()).toMatchObject({ status: "succeeded" });
    const root = fs.readFileSync(`${p.log}.root`, "utf8");
    expect(root).toContain('<meta http-equiv="refresh" content="0; url=en-US/">');
    expect(root).toContain('<meta name="robots" content="noindex">');
  });

  it("leaves the root page Bukit wrote alone", async () => {
    const p = await publishable();
    await p.publish();
    expect(fs.readFileSync(`${p.log}.root`, "utf8")).toBe("<h1>site</h1>\n");
  });

  it("never stores the token, even when the deploy step prints it", async () => {
    const p = await publishable({ fail: "leak" });
    const d = await p.publish();
    expect(d).toMatchObject({ status: "failed", step: "deploy" });
    const stored = JSON.stringify(p.ctx.db.prepare("SELECT report_json FROM deploys WHERE id = ?").get(d.id));
    expect(stored).not.toContain("ghp_deploytokendeploytoken");
    expect(d.report?.output).toContain("x-access-token:[token]@github.com");
    expect(d.report?.messages.some((m) => m.msg === "token [token]")).toBe(true);
  });

  it("refuses what the user did not confirm, a missing account, target or identity", async () => {
    const p = await publishable();
    const other = "0".repeat(40);
    expect(await p.call("POST", "/deploys", { commit: other })).toMatchObject({
      status: 409,
      json: { code: "deploy.commit_changed", params: { commit: p.head } },
    });
    expect((await p.call("POST", "/deploys", { commit: "HEAD" })).status).toBe(400);

    p.ctx.sites.setPublishAccountId(p.site.id, null);
    expect((await p.call("POST", "/deploys", { commit: p.head })).json).toMatchObject({ code: "deploy.no_account" });
    p.ctx.sites.setPublishAccountId(p.site.id, p.account.id);

    p.ctx.db.prepare("DELETE FROM settings WHERE key = 'commitName'").run();
    expect((await p.call("POST", "/deploys", { commit: p.head })).json).toMatchObject({
      code: "site.identity_required",
    });
    p.ctx.db
      .prepare("INSERT INTO settings (key, value_json) VALUES ('commitName', ?)")
      .run(JSON.stringify("Site Owner"));

    fs.writeFileSync(
      path.join(p.dir, "site.yaml"),
      fs.readFileSync(path.join(p.dir, "site.yaml"), "utf8").replace(/\ndeploy:[\s\S]*$/, "\n"),
    );
    commitAllAs(base, p.dir, "no target");
    const head = rawGit(base, p.dir, "rev-parse", "HEAD").trim();
    expect((await p.call("POST", "/deploys", { commit: head })).json).toMatchObject({
      code: "deploy.no_target",
      params: { problem: "not_configured" },
    });
    expect(p.calls()).toEqual([]);
  });

  it("refuses a commit the guard rejects, and can be stopped", async () => {
    const p = await publishable();
    fs.mkdirSync(path.join(p.dir, "plugins"));
    fs.writeFileSync(path.join(p.dir, "plugins", "x.dll"), "x");
    commitAllAs(base, p.dir, "plugin");
    const head = rawGit(base, p.dir, "rev-parse", "HEAD").trim();
    const res = await p.call("POST", "/deploys", { commit: head });
    expect(res.status).toBe(202);
    await p.ctx.deploys.settled();
    const d = p.ctx.deploys.get(p.site.id, (res.json as unknown as Deploy).id);
    expect(d).toMatchObject({ status: "failed", outcome: "refused", step: "guard" });
    expect(d.report?.reasons?.length).toBeGreaterThan(0);
    expect(p.calls()).toEqual([]);
  });

  it("stops a running publish and keeps one per site at a time", async () => {
    const p = await publishable({ fail: "none" });
    fs.writeFileSync(path.join(p.dir, "slow"), "1");
    // A doctor that waits for SIGINT.
    const bin = path.join(base, `pub${counter}-bin`, "bukit");
    fs.writeFileSync(
      bin,
      fs
        .readFileSync(bin, "utf8")
        .replace("  doctor) [", "  doctor) trap 'exit 130' INT; while true; do sleep 0.05; done; ["),
    );
    const started = await p.call("POST", "/deploys", { commit: p.head });
    expect(started.status).toBe(202);
    const id = (started.json as unknown as Deploy).id;
    for (let i = 0; i < 200 && p.ctx.deploys.get(p.site.id, id).step !== "doctor"; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect((await p.call("POST", "/deploys", { commit: p.head })).json).toMatchObject({ code: "site.busy" });
    expect((await p.call("POST", "/builds", { ref: "main" })).json).toMatchObject({ code: "site.busy" });
    expect((await p.call("POST", `/deploys/${id}/stop`)).status).toBe(200);
    await p.ctx.deploys.settled();
    expect(p.ctx.deploys.get(p.site.id, id)).toMatchObject({ status: "stopped", outcome: "stopped", step: "doctor" });
    expect((await p.call("POST", `/deploys/${id}/stop`)).json).toMatchObject({ code: "deploy.not_running" });
    expect(p.calls().map((c) => c.split(" ")[0])).not.toContain("deploy");
  });
});

const REAL_BIN = process.env.BUKIT_BIN;

describe.skipIf(!REAL_BIN)("publishing with the real Bukit", () => {
  it("pushes the audited output, without .bukit/, as the settings' identity", async () => {
    const realGit = resolveGitPath() as string;
    const bare = path.join(base, "pages.git");
    rawGit(base, base, "init", "-q", "--bare", bare);
    // A git that sends Bukit's network commands to the local bare repository. Bukit checks its remote's
    // address, so only the remote name in ls-remote / fetch / push is swapped, never the address.
    const wrapper = path.join(base, "git-wrapper");
    fs.writeFileSync(
      wrapper,
      `#!/bin/sh
case " $* " in *" ls-remote "*|*" fetch "*|*" push "*) net=1;; *) net=0;; esac
n=$#
for a in "$@"; do
  if [ $net = 1 ]; then case "$a" in bukit-deploy-*) a="${bare}";; esac; fi
  set -- "$@" "$a"
done
shift $n
exec "${realGit}" "$@"
`,
      { mode: 0o755 },
    );
    const home = path.join(base, "real-bk");
    installAppBukit(home, REAL_BIN as string);
    const ctx = makeApp({
      appHome: path.join(base, "real-app"),
      userHome: base,
      gitPath: wrapper,
      bukit: new BukitService({
        dir: testBukitDir(home),
        tmpDir: path.join(base, "real-bk-tmp"),
      }),
    });
    contexts.push(ctx);
    const dir = path.join(base, "real-site");
    copyStarter(STARTER, dir, { title: "Real", language: "en-US" });
    fs.appendFileSync(
      path.join(dir, "site.yaml"),
      "\ndeploy:\n  provider: github-pages\n  repo: someone/someone.github.io\n",
    );
    rawGit(base, dir, "init", "-q", "-b", "main");
    commitAllAs(base, dir, "init");
    const site = await ctx.sites.import({ path: dir });
    await ctx.builds.settled();
    ctx.db
      .prepare("INSERT OR REPLACE INTO settings (key, value_json) VALUES ('commitName', ?), ('commitEmail', ?)")
      .run(JSON.stringify("Site Owner"), JSON.stringify("owner@example.com"));
    const account = ctx.publishAccounts.create({
      platform: "github",
      name: "Real GitHub",
      token: "ghp_notarealtokennotarealtoken",
    });
    ctx.sites.setPublishAccountId(site.id, account.id);
    const head = rawGit(base, dir, "rev-parse", "HEAD").trim();

    const started = await ctx.deploys.start(site.id, head);
    await ctx.deploys.settled();
    const d = ctx.deploys.get(site.id, started.id);
    expect(d.report?.steps.map((s) => s.step)).toEqual(["guard", "check", "doctor", "build", "audit", "deploy"]);
    expect(d).toMatchObject({ status: "succeeded", outcome: "ok", url: "https://someone.github.io/" });
    expect(d.report?.output).toContain("Git push completed");
    expect(d.report?.audit?.routes).toBeGreaterThan(5);

    const files = rawGit(base, base, "--git-dir", bare, "ls-tree", "-r", "--name-only", "gh-pages").split("\n");
    expect(files).toContain("index.html");
    expect(files).toContain(".nojekyll");
    expect(files.some((f) => f.startsWith(".bukit/"))).toBe(false);
    expect(rawGit(base, base, "--git-dir", bare, "log", "-1", "--format=%an <%ae>|%cn <%ce>", "gh-pages").trim()).toBe(
      "Site Owner <owner@example.com>|Site Owner <owner@example.com>",
    );
    // Nothing was left in the site folder or the main checkout.
    expect(rawGit(base, dir, "status", "--porcelain").trim()).toBe("");
    expect(fs.existsSync(path.join(ctx.paths.worktrees, site.id, "main", ".bukitjalil-deploy"))).toBe(false);
  }, 180_000);
});
