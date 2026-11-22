-- Decisions on the content assistant's proposals (content editor and AI design, A2). A proposal itself is
-- in the conversation (its tool result); no row means it still waits. Rows are by database and tool call,
-- so a forked conversation that copied a proposal shares its decision and cannot write it twice.
CREATE TABLE content_proposals (
  data_source_id TEXT NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
  database_id TEXT NOT NULL,
  call_id TEXT NOT NULL,
  -- The conversation it was decided in, which is told the outcome with its next message.
  session_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('applied', 'rejected', 'failed')),
  entry_id TEXT,
  error TEXT,
  decided_at TEXT NOT NULL,
  noted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (data_source_id, database_id, call_id)
);
