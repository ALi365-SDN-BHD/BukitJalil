import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadMigrations, openDatabase } from "../src/store/db.ts";
import { SettingsStore } from "../src/store/settings.ts";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bj-db-"));

describe("SQLite store (plan 4.2)", () => {
  it("creates app.db with all tables and records the migration once", () => {
    const file = path.join(tmp(), "app.db");
    openDatabase(file).close();
    const db = openDatabase(file); // second open: nothing re-applied
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[])
      .map((r) => r.name)
      .sort();
    expect(tables).toEqual(
      ["builds", "change_set_sessions", "change_sets", "schema_migrations", "sessions", "settings", "sites"].sort(),
    );
    const versions = db.prepare("SELECT version FROM schema_migrations").all() as { version: number }[];
    expect(versions.map((v) => v.version)).toEqual(loadMigrations().map((m) => m.version));
  });

  it("allows only one open change set per site", () => {
    const db = openDatabase(":memory:");
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO sites (id, name, path, default_branch, created_at) VALUES ('s1', 'S', '/x', 'main', ?)",
    ).run(now);
    const insert = db.prepare(
      "INSERT INTO change_sets (id, site_id, base_commit, status, created_at) VALUES (?, 's1', 'abc', ?, ?)",
    );
    insert.run("c1", "open", now);
    insert.run("c2", "applied", now);
    expect(() => insert.run("c3", "open", now)).toThrow();
  });

  it("rolls back a failing migration and reports its name", () => {
    expect(() =>
      openDatabase(":memory:", [
        { version: 1, name: "001_ok.sql", sql: "CREATE TABLE a (x INTEGER);" },
        { version: 2, name: "002_bad.sql", sql: "CREATE TABLE b (y INTEGER); NOT SQL;" },
      ]),
    ).toThrow(/002_bad\.sql/);
  });

  it("settings fall back to defaults for corrupt or unknown values", () => {
    const db = openDatabase(":memory:");
    const store = new SettingsStore(db);
    expect(store.get()).toEqual({ locale: null, lastParentDir: null });
    db.prepare("INSERT INTO settings (key, value_json) VALUES ('locale', '\"fr\"'), ('junk', '1')").run();
    expect(store.get()).toEqual({ locale: null, lastParentDir: null });
    expect(store.update({ locale: "en", lastParentDir: "/Users/x/Sites" })).toEqual({
      locale: "en",
      lastParentDir: "/Users/x/Sites",
    });
  });
});
