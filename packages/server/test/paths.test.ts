import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureAppHome, readPackageVersion } from "../src/paths.ts";
import { openDatabase } from "../src/store/db.ts";

const mode = (p: string) => fs.statSync(p).mode & 0o777;

describe("app version", () => {
  it("reads one explicit package.json named bukitjalil", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bj-version-"));
    const file = path.join(root, "package.json");
    fs.writeFileSync(file, JSON.stringify({ name: "bukitjalil", version: "0.1.0-beta.5" }));
    expect(readPackageVersion(file)).toBe("0.1.0-beta.5");
  });

  it("returns null for a different package or a missing file", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bj-version-"));
    const file = path.join(root, "package.json");
    fs.writeFileSync(file, JSON.stringify({ name: "@bukitjalil/server", version: "9.9.9" }));
    expect(readPackageVersion(file)).toBeNull();
    expect(readPackageVersion(path.join(root, "missing.json"))).toBeNull();
  });
});

describe.skipIf(process.platform === "win32")("app data directory (plan 4.1)", () => {
  it("is private even when it already existed with looser permissions", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "bj-home-"));
    fs.chmodSync(home, 0o755);
    fs.mkdirSync(path.join(home, "logs"), { mode: 0o755 });
    fs.writeFileSync(path.join(home, "app.db"), "", { mode: 0o644 });
    fs.chmodSync(path.join(home, "app.db"), 0o644);

    const paths = ensureAppHome(home);
    const db = openDatabase(paths.db);
    db.exec("CREATE TABLE t (x); INSERT INTO t VALUES (1);");
    expect(mode(home)).toBe(0o700);
    expect(mode(paths.logs)).toBe(0o700);
    expect(mode(paths.db)).toBe(0o600);
    expect(mode(`${paths.db}-wal`)).toBe(0o600);
    expect(mode(paths.emptyGitConfig)).toBe(0o600);
    db.close();
  });

  it("creates a new database file as 0600", () => {
    const home = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bj-home-")), "new");
    const paths = ensureAppHome(home);
    openDatabase(paths.db).close();
    expect(mode(paths.db)).toBe(0o600);
  });

  it("does not chmod a database file symlink's target", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bj-home-link-"));
    const home = path.join(root, "home");
    const target = path.join(root, "outside.txt");
    fs.writeFileSync(target, "outside", { mode: 0o644 });
    fs.chmodSync(target, 0o644);
    fs.mkdirSync(home);
    fs.symlinkSync(target, path.join(home, "app.db-wal"));

    ensureAppHome(home);
    expect(mode(target)).toBe(0o644);
    expect(fs.lstatSync(path.join(home, "app.db-wal")).isSymbolicLink()).toBe(true);
  });
});
