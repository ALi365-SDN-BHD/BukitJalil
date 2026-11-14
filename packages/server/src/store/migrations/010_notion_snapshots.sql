-- The Notion offline snapshot of each site (plan 5.5): which formal build recorded it. The snapshot itself
-- and the media cache that goes with it are files under notion-snapshots/<siteId>/.
CREATE TABLE notion_snapshots (
  site_id TEXT PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
  "commit" TEXT NOT NULL,
  built_at TEXT NOT NULL
);
