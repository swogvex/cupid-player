CREATE TABLE playlists (
  id          INTEGER PRIMARY KEY,
  spotify_id  TEXT,
  name        TEXT NOT NULL,
  folder      TEXT NOT NULL,          -- folder name relative to <music>\Playlists
  cover_path  TEXT,
  created_at  TEXT NOT NULL           -- ISO-8601 UTC
);

CREATE TABLE tracks (
  id            INTEGER PRIMARY KEY,
  spotify_id    TEXT,
  title         TEXT NOT NULL,
  artist        TEXT NOT NULL,
  album         TEXT,
  duration_ms   INTEGER NOT NULL,
  file_path     TEXT,                 -- absolute path; NULL until downloaded
  cover_path    TEXT,
  playlist_id   INTEGER REFERENCES playlists(id) ON DELETE SET NULL,
  position      INTEGER,
  status        TEXT NOT NULL CHECK (status IN
                  ('queued','searching','downloading','tagging','done','needs_review','failed')),
  source_url    TEXT,
  match_score   REAL,
  added_at      TEXT NOT NULL         -- ISO-8601 UTC
);
CREATE INDEX idx_tracks_playlist ON tracks(playlist_id, position);
CREATE INDEX idx_tracks_status ON tracks(status);

CREATE TABLE plays (
  id               INTEGER PRIMARY KEY,
  track_id         INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  started_at       TEXT NOT NULL,     -- UTC
  month_key        TEXT NOT NULL,     -- 'YYYY-MM', local time when recorded
  seconds_listened INTEGER NOT NULL
);
CREATE INDEX idx_plays_month ON plays(month_key);

CREATE TABLE monthly_stats (
  month_key    TEXT PRIMARY KEY,
  minutes      INTEGER NOT NULL,
  top_artists  TEXT NOT NULL,         -- JSON
  top_tracks   TEXT NOT NULL,         -- JSON
  closed_at    TEXT NOT NULL
);