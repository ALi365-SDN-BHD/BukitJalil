-- Result of the last safety check of a site (plan 5.1). NULL read_only_reasons means the site is usable;
-- otherwise a JSON array of {code, where?, detail?} shown as "read-only: does not meet the safety rules".
-- A site starts as not checked, so a check that never finishes cannot leave it usable.
ALTER TABLE sites ADD COLUMN read_only_reasons TEXT DEFAULT '[{"code":"not_checked"}]';
-- Commit the state was computed for, and the last `bukit config check` result in the main/ checkout:
-- 'ok', 'failed', 'not_run' (no usable Bukit) or 'notion' (needs NOTION_TOKEN, plan 5.1).
ALTER TABLE sites ADD COLUMN checked_commit TEXT;
ALTER TABLE sites ADD COLUMN config_check TEXT;
