-- One-time record of the old global token import (plan 6.5). It stores no token: only which
-- account/data source received it and whether the import was completed or adopted from an existing
-- row. The fixed names are not an identity: retries use row_id after a rename.
CREATE TABLE legacy_token_imports (
  kind TEXT PRIMARY KEY CHECK (kind IN ('github', 'notion')),
  row_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('imported', 'adopted')),
  updated_at TEXT NOT NULL
);
