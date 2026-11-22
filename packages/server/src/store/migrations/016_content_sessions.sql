-- Conversations of a Notion database in content management (content editor and AI design, part 2): a session
-- belongs to a site, a theme project, or a data source's database. Removing the data source removes them.
CREATE TABLE sessions_new (
  id TEXT PRIMARY KEY,
  site_id TEXT REFERENCES sites(id) ON DELETE CASCADE,
  theme_id TEXT REFERENCES themes(id) ON DELETE CASCADE,
  data_source_id TEXT REFERENCES data_sources(id) ON DELETE CASCADE,
  -- The Notion database id (32 hex characters), set exactly when data_source_id is.
  database_id TEXT,
  title TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status TEXT NOT NULL,
  CHECK ((site_id IS NOT NULL) + (theme_id IS NOT NULL) + (data_source_id IS NOT NULL) = 1),
  CHECK ((data_source_id IS NULL) = (database_id IS NULL))
);
INSERT INTO sessions_new (id, site_id, theme_id, title, created_at, updated_at, status)
  SELECT id, site_id, theme_id, title, created_at, updated_at, status FROM sessions;
DROP TABLE sessions;
ALTER TABLE sessions_new RENAME TO sessions;
CREATE INDEX sessions_site ON sessions(site_id);
CREATE INDEX sessions_theme ON sessions(theme_id);
CREATE INDEX sessions_content ON sessions(data_source_id, database_id);
