-- One cached answer per track. `synced` keeps the raw LRC text; it is parsed when read.
CREATE TABLE lyrics (
  track_id   INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
  status     TEXT NOT NULL CHECK (status IN ('synced', 'plain', 'instrumental', 'not_found')),
  synced     TEXT,
  plain      TEXT,
  fetched_at TEXT NOT NULL
);