-- Saved Notion sources (plan 6.5): the user adds them once and picks one when creating a site.
-- Markdown is the default content source and needs no record here.
-- Notion tokens are kept outside the database, keyed by data source id (settings/data-sources.ts).
CREATE TABLE data_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  platform TEXT NOT NULL CHECK (platform = 'notion'),
  config_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Which saved Notion source a site was created with; its token is used when the site builds.
ALTER TABLE sites ADD COLUMN notion_data_source_id TEXT;
