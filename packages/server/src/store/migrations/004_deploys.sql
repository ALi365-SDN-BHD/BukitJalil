-- Publishes to GitHub Pages (plan 14 M6). report_json holds the step results, messages and publish audit.
CREATE TABLE deploys (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  "commit" TEXT NOT NULL,
  repo TEXT NOT NULL,
  branch TEXT NOT NULL,
  url TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'stopped')),
  step TEXT,
  outcome TEXT,
  report_json TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX deploys_site ON deploys(site_id, started_at);
