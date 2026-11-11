-- A restore change set (plan 7.4): the default-branch commit whose tree it brings back. NULL for the AI's
-- change sets. Applying a restore commits with the user as author and committer.
ALTER TABLE change_sets ADD COLUMN restore_commit TEXT;
