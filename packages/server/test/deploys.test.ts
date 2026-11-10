import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DeployStatusResponse } from "@bukitjalil/shared";
import { afterAll, describe, expect, it } from "vitest";
import { deployTarget, pagesUrl } from "../src/deploys/target.ts";
import { copyStarter } from "../src/sites/template.ts";
import { commitAllAs, makeApp, rawGit, req } from "./helpers.ts";

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
    // A cname that is not a host name is left out, not passed on.
    expect(deployTarget({ deploy: { repo: "a/b", cname: "http://x" } })).toMatchObject({ cname: null, problem: null });
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

    expect(await status()).toMatchObject({ target: { problem: "not_configured" }, token: false, ready: false });
    fs.appendFileSync(path.join(dir, "site.yaml"), "\ndeploy:\n  repo: someone/blog\n  branch: pages\n");
    commitAllAs(base, dir, "deploy");
    const head = rawGit(base, dir, "rev-parse", "HEAD").trim();
    expect(await status()).toMatchObject({
      commit: head,
      target: { repo: "someone/blog", branch: "pages", url: "https://someone.github.io/blog/", problem: null },
      token: false,
      ready: false,
    });
    ctx.secrets.set("github", "ghp_testtokentesttoken");
    expect(await status()).toMatchObject({ token: true, ready: true });
    // Uncommitted edits in the site folder are not what gets published.
    fs.appendFileSync(path.join(dir, "site.yaml"), "\n# local\n");
    expect((await status()).commit).toBe(head);
  });
});
