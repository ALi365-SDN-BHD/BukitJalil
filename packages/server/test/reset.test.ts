import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureAppHome } from "../src/paths.ts";
import { resetAppData, resetTargets } from "../src/security/reset.ts";

describe("reset after a forgotten PIN (plan 6.9)", () => {
  it("deletes the database and per-site data, and leaves logs, Pi's directory and the user's folders", () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bj-reset-")));
    const paths = ensureAppHome(path.join(root, "home"));
    const site = path.join(root, "my-site");
    fs.mkdirSync(site);
    fs.writeFileSync(path.join(site, "site.yaml"), "title: Mine\n");
    fs.writeFileSync(paths.db, "encrypted");
    for (const dir of [paths.worktrees, paths.previews, paths.notionSnapshots, paths.captures, paths.bukitTmp]) {
      fs.mkdirSync(path.join(dir, "x"), { recursive: true });
      fs.writeFileSync(path.join(dir, "x", "file"), "data");
    }
    fs.writeFileSync(`${paths.db}-wal`, "wal");
    fs.writeFileSync(path.join(paths.logs, "server.log"), "log\n");
    // A link inside the data directory to the user's folder is removed, never followed.
    fs.rmSync(paths.previews, { recursive: true });
    fs.symlinkSync(site, paths.previews);

    resetAppData(paths);
    for (const target of resetTargets(paths)) expect(fs.existsSync(target), target).toBe(false);
    expect(fs.readFileSync(path.join(site, "site.yaml"), "utf8")).toBe("title: Mine\n");
    expect(fs.existsSync(path.join(paths.logs, "server.log"))).toBe(true);
    expect(fs.existsSync(paths.pi)).toBe(true);

    // Set up again as on a first start: an empty database, the directories back.
    ensureAppHome(paths.home);
    expect(fs.statSync(paths.db).size).toBe(0);
    expect(fs.existsSync(paths.worktrees)).toBe(true);
  });
});
