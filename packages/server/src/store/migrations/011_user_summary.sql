-- The line a user action wrote for a change set (a restore, a plugin switch; plan 7.2), kept apart from the
-- AI's summary, and the files the AI changed after joining such a change set (a JSON array of paths), so the
-- commit message keeps the user's line and notes what the AI added.
ALTER TABLE change_sets ADD COLUMN user_summary TEXT;
ALTER TABLE change_sets ADD COLUMN ai_paths TEXT;
