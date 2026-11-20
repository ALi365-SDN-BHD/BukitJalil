-- Pi's session records in the database instead of sessions/<project>/<id>.jsonl (plan 6.9): one row per
-- entry, the session header first (seq 0), in Pi's order. Pi only appends to a session, so each message
-- adds rows; a session that is deleted takes its entries with it.
CREATE TABLE session_entries (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  -- Pi's entry id (the session id for the header), to find where the saved entries end without parsing them.
  entry_id TEXT NOT NULL,
  entry_json TEXT NOT NULL,
  PRIMARY KEY (session_id, seq)
);

-- The file path is gone; SQLite cannot drop a NOT NULL column in place, so the table is rebuilt as in 013.
CREATE TABLE sessions_new (
  id TEXT PRIMARY KEY,
  site_id TEXT REFERENCES sites(id) ON DELETE CASCADE,
  theme_id TEXT REFERENCES themes(id) ON DELETE CASCADE,
  title TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status TEXT NOT NULL,
  CHECK ((site_id IS NULL) <> (theme_id IS NULL))
);
INSERT INTO sessions_new (id, site_id, theme_id, title, created_at, updated_at, status)
  SELECT id, site_id, theme_id, title, created_at, updated_at, status FROM sessions;
DROP TABLE sessions;
ALTER TABLE sessions_new RENAME TO sessions;
CREATE INDEX sessions_site ON sessions(site_id);
CREATE INDEX sessions_theme ON sessions(theme_id);
