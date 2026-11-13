-- Saved publishing accounts (plan 6.5): the user adds one token per account and picks it for a site.
-- Tokens are kept outside the database, keyed by account id (settings/publish-accounts.ts).
CREATE TABLE publish_accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  platform TEXT NOT NULL CHECK (platform IN ('github')),
  created_at TEXT NOT NULL
);

-- The saved account a site publishes with; its token is read when a publish starts.
ALTER TABLE sites ADD COLUMN publish_account_id TEXT;
