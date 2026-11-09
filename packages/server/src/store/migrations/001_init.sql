-- Initial schema (plan 4.2). Times are ISO-8601 UTC strings.
CREATE TABLE sites (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  default_branch TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_opened_at TEXT,
  archived INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  pi_session_file TEXT NOT NULL,
  title TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status TEXT NOT NULL
);
CREATE INDEX sessions_site ON sessions(site_id);

CREATE TABLE change_sets (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  created_by_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  base_commit TEXT NOT NULL,
  snapshot_commit TEXT,
  status TEXT NOT NULL CHECK (status IN ('open', 'applied', 'rejected', 'stale')),
  summary TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  result_commit TEXT
);
-- At most one open change set per site (plan 7.2).
CREATE UNIQUE INDEX change_sets_one_open ON change_sets(site_id) WHERE status = 'open';

CREATE TABLE change_set_sessions (
  change_set_id TEXT NOT NULL REFERENCES change_sets(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  first_turn_at TEXT NOT NULL,
  PRIMARY KEY (change_set_id, session_id)
);

CREATE TABLE builds (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  change_set_id TEXT REFERENCES change_sets(id) ON DELETE SET NULL,
  "commit" TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('check', 'doctor', 'build')),
  status TEXT NOT NULL,
  exit_code INTEGER,
  output_dir TEXT,
  report_json TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX builds_site ON builds(site_id, started_at);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);
