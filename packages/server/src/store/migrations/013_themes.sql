-- Theme projects (theme development design 3.2): a git repository with a sample site whose deliverable is
-- themes/<theme_name>/. Same state columns as sites (plan 5.1).
CREATE TABLE themes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  theme_name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  default_branch TEXT NOT NULL,
  config_file TEXT NOT NULL DEFAULT 'site.yaml',
  origin TEXT NOT NULL CHECK (origin IN ('new', 'import', 'clone')),
  created_at TEXT NOT NULL,
  last_opened_at TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  read_only_reasons TEXT DEFAULT '[{"code":"not_checked"}]',
  checked_commit TEXT,
  config_check TEXT
);

-- Conversations, change sets and builds belong to a site or a theme project, never both. SQLite cannot
-- change a column's constraints in place, so each table is rebuilt: create, copy, drop, rename (the
-- runner turns foreign keys off around migrations and checks them before committing). Other tables'
-- references name these tables, so they point at the new ones after the rename.
CREATE TABLE sessions_new (
  id TEXT PRIMARY KEY,
  site_id TEXT REFERENCES sites(id) ON DELETE CASCADE,
  theme_id TEXT REFERENCES themes(id) ON DELETE CASCADE,
  pi_session_file TEXT NOT NULL,
  title TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status TEXT NOT NULL,
  CHECK ((site_id IS NULL) <> (theme_id IS NULL))
);
INSERT INTO sessions_new (id, site_id, pi_session_file, title, created_at, updated_at, status)
  SELECT id, site_id, pi_session_file, title, created_at, updated_at, status FROM sessions;
DROP TABLE sessions;
ALTER TABLE sessions_new RENAME TO sessions;
CREATE INDEX sessions_site ON sessions(site_id);
CREATE INDEX sessions_theme ON sessions(theme_id);

CREATE TABLE change_sets_new (
  id TEXT PRIMARY KEY,
  site_id TEXT REFERENCES sites(id) ON DELETE CASCADE,
  theme_id TEXT REFERENCES themes(id) ON DELETE CASCADE,
  created_by_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  base_commit TEXT NOT NULL,
  snapshot_commit TEXT,
  status TEXT NOT NULL CHECK (status IN ('open', 'applied', 'rejected', 'stale')),
  summary TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  result_commit TEXT,
  restore_commit TEXT,
  ai_joined INTEGER NOT NULL DEFAULT 0,
  user_summary TEXT,
  ai_paths TEXT,
  CHECK ((site_id IS NULL) <> (theme_id IS NULL))
);
INSERT INTO change_sets_new (id, site_id, created_by_session_id, base_commit, snapshot_commit, status, summary,
    created_at, resolved_at, result_commit, restore_commit, ai_joined, user_summary, ai_paths)
  SELECT id, site_id, created_by_session_id, base_commit, snapshot_commit, status, summary,
    created_at, resolved_at, result_commit, restore_commit, ai_joined, user_summary, ai_paths FROM change_sets;
DROP TABLE change_sets;
ALTER TABLE change_sets_new RENAME TO change_sets;
-- At most one open change set per project (plan 7.2).
CREATE UNIQUE INDEX change_sets_one_open ON change_sets(site_id) WHERE status = 'open' AND site_id IS NOT NULL;
CREATE UNIQUE INDEX change_sets_one_open_theme ON change_sets(theme_id) WHERE status = 'open' AND theme_id IS NOT NULL;

CREATE TABLE builds_new (
  id TEXT PRIMARY KEY,
  site_id TEXT REFERENCES sites(id) ON DELETE CASCADE,
  theme_id TEXT REFERENCES themes(id) ON DELETE CASCADE,
  change_set_id TEXT REFERENCES change_sets(id) ON DELETE SET NULL,
  "commit" TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('check', 'doctor', 'build')),
  status TEXT NOT NULL,
  exit_code INTEGER,
  output_dir TEXT,
  report_json TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  CHECK ((site_id IS NULL) <> (theme_id IS NULL))
);
INSERT INTO builds_new (id, site_id, change_set_id, "commit", kind, status, exit_code, output_dir, report_json,
    started_at, finished_at)
  SELECT id, site_id, change_set_id, "commit", kind, status, exit_code, output_dir, report_json, started_at,
    finished_at FROM builds;
DROP TABLE builds;
ALTER TABLE builds_new RENAME TO builds;
CREATE INDEX builds_site ON builds(site_id, started_at);
CREATE INDEX builds_theme ON builds(theme_id, started_at);
