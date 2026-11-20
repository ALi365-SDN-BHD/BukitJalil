-- Tokens and model keys in the database (plan 6.9). The desktop app's whole database is encrypted with the
-- PIN; each secret is encrypted again with the random field key kept here (security/vault.ts), with its
-- table and row id authenticated. Nothing reads this table through the settings or any API.
CREATE TABLE vault_keys (
  id TEXT PRIMARY KEY,
  key BLOB NOT NULL,
  created_at TEXT NOT NULL
);

-- A token goes with its row: deleting the account or source deletes the token.
ALTER TABLE publish_accounts ADD COLUMN token_ciphertext TEXT;
ALTER TABLE data_sources ADD COLUMN token_ciphertext TEXT;

-- Pi's model keys and OAuth credentials, one per provider (agent/secret-credentials.ts).
CREATE TABLE pi_credentials (
  provider TEXT PRIMARY KEY,
  credential_ciphertext TEXT NOT NULL
);

-- Local and self-hosted models (agent/custom-models.ts): the config in plain columns, the key encrypted.
CREATE TABLE custom_models (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api TEXT NOT NULL,
  model_json TEXT NOT NULL,
  api_key_ciphertext TEXT,
  created_at TEXT NOT NULL
);
