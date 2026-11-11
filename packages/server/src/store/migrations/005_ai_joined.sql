-- Whether any conversation ever took part in a change set (plan 7.4). Applying a restore makes the user its
-- author only while this is 0; it stays set when the conversation is deleted or the change is rebased.
ALTER TABLE change_sets ADD COLUMN ai_joined INTEGER NOT NULL DEFAULT 0;
UPDATE change_sets SET ai_joined = 1
  WHERE id IN (SELECT change_set_id FROM change_set_sessions) OR created_by_session_id IS NOT NULL;
