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
      [
        "builds",
        "change_set_sessions",
        "change_sets",
        "custom_models",
        "data_sources",
        "deploys",
        "notion_snapshots",
        "pi_credentials",
        "publish_accounts",
        "schema_migrations",
        "sessions",
        "settings",
        "sites",
        "themes",
        "vault_keys",
      ].sort(),
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

  it("keeps a theme project's open change set apart and refuses rows owned by both or neither", () => {
    const db = openDatabase(":memory:");
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO sites (id, name, path, default_branch, created_at) VALUES ('s1', 'S', '/x', 'main', ?)",
    ).run(now);
    db.prepare(
      "INSERT INTO themes (id, name, theme_name, path, default_branch, origin, created_at) VALUES ('t1', 'T', 't', '/t', 'main', 'new', ?)",
    ).run(now);
    const insert = db.prepare(
      "INSERT INTO change_sets (id, site_id, theme_id, base_commit, status, created_at) VALUES (?, ?, ?, 'abc', 'open', ?)",
    );
    insert.run("c1", "s1", null, now);
    insert.run("c2", null, "t1", now); // one open per project, not one in all
    expect(() => insert.run("c3", null, "t1", now)).toThrow();
    expect(() => insert.run("c4", "s1", "t1", now)).toThrow(/CHECK/);
    expect(() => insert.run("c5", null, null, now)).toThrow(/CHECK/);
    db.prepare("DELETE FROM themes WHERE id = 't1'").run();
    expect(db.prepare("SELECT id FROM change_sets").all()).toEqual([{ id: "c1" }]);
  });

  it("013 keeps the rows of an older database and their foreign keys", () => {
    const file = path.join(tmp(), "app.db");
    const all = loadMigrations();
    const db0 = openDatabase(
      file,
      all.filter((m) => m.version < 13),
    );
    const now = new Date().toISOString();
    db0.exec(`
      INSERT INTO sites (id, name, path, default_branch, created_at) VALUES ('s1', 'S', '/x', 'main', '${now}');
      INSERT INTO sessions (id, site_id, pi_session_file, created_at, updated_at, status)
        VALUES ('p1', 's1', '/f', '${now}', '${now}', 'idle');
      INSERT INTO change_sets (id, site_id, created_by_session_id, base_commit, status, created_at, ai_joined, ai_paths)
        VALUES ('c1', 's1', 'p1', 'abc', 'open', '${now}', 1, '["a.md"]');
      INSERT INTO change_set_sessions (change_set_id, session_id, first_turn_at) VALUES ('c1', 'p1', '${now}');
      INSERT INTO builds (id, site_id, change_set_id, "commit", kind, status, started_at)
        VALUES ('b1', 's1', 'c1', 'abc', 'build', 'ok', '${now}');
    `);
    db0.close();
    const db = openDatabase(file);
    expect(db.prepare("SELECT site_id, theme_id, ai_joined, ai_paths FROM change_sets").get()).toEqual({
      site_id: "s1",
      theme_id: null,
      ai_joined: 1,
      ai_paths: '["a.md"]',
    });
    expect(db.prepare("SELECT COUNT(*) AS n FROM change_set_sessions").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT change_set_id FROM builds").get()).toEqual({ change_set_id: "c1" });
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    // The references other tables hold still cascade to the rebuilt tables.
    db.prepare("DELETE FROM sessions WHERE id = 'p1'").run();
    expect(db.prepare("SELECT COUNT(*) AS n FROM change_set_sessions").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT created_by_session_id FROM change_sets").get()).toEqual({ created_by_session_id: null });
    db.prepare("DELETE FROM change_sets WHERE id = 'c1'").run();
    expect(db.prepare("SELECT change_set_id FROM builds").get()).toEqual({ change_set_id: null });
    db.prepare("DELETE FROM sites WHERE id = 's1'").run();
    expect(db.prepare("SELECT COUNT(*) AS n FROM builds").get()).toEqual({ n: 0 });
  });

  it("refuses a migration that leaves a dangling foreign key", () => {
    expect(() =>
      openDatabase(":memory:", [
        { version: 1, name: "001_a.sql", sql: "CREATE TABLE a (id TEXT PRIMARY KEY);" },
        {
          version: 2,
          name: "002_b.sql",
          sql: "CREATE TABLE b (a_id TEXT REFERENCES a(id)); INSERT INTO b VALUES ('missing');",
        },
      ]),
    ).toThrow(/002_b\.sql failed: foreign key check failed/);
  });

  it("rolls back a failing migration and reports its name", () => {
    expect(() =>
      openDatabase(":memory:", [
        { version: 1, name: "001_ok.sql", sql: "CREATE TABLE a (x INTEGER);" },
        { version: 2, name: "002_bad.sql", sql: "CREATE TABLE b (y INTEGER); NOT SQL;" },
      ]),
    ).toThrow(/002_bad\.sql/);
  });

  it("one invalid setting does not reset the others", () => {
    const db = openDatabase(":memory:");
    const store = new SettingsStore(db);
    store.update({ commitName: "Test Owner", appearance: "dark" });
    db.prepare("UPDATE settings SET value_json = '\"fr\"' WHERE key = 'appearance'").run();
    db.prepare("INSERT INTO settings (key, value_json) VALUES ('locale', 'not json')").run();
    const settings = store.get();
    expect(settings.commitName).toBe("Test Owner");
    expect(settings.appearance).toBe("system");
    expect(settings.locale).toBeNull();
  });

  it("settings fall back to defaults for corrupt or unknown values", () => {
    const db = openDatabase(":memory:");
    const store = new SettingsStore(db);
    expect(store.get()).toEqual({
      locale: null,
      lastParentDir: null,
      commitName: null,
      commitEmail: null,
      model: null,
      thinkingLevel: "medium",
      appearance: "system",
      disabledSkills: [],
    });
    db.prepare("INSERT INTO settings (key, value_json) VALUES ('locale', '\"fr\"'), ('junk', '1')").run();
    expect(store.get()).toEqual({
      locale: null,
      lastParentDir: null,
      commitName: null,
      commitEmail: null,
      model: null,
      thinkingLevel: "medium",
      appearance: "system",
      disabledSkills: [],
    });
    expect(store.update({ appearance: "dark" }).appearance).toBe("dark");
    expect(store.update({ appearance: "system", locale: "en", lastParentDir: "/Users/x/Sites" })).toEqual({
      locale: "en",
      lastParentDir: "/Users/x/Sites",
      commitName: null,
      commitEmail: null,
      model: null,
      thinkingLevel: "medium",
      appearance: "system",
      disabledSkills: [],
    });
  });
});
