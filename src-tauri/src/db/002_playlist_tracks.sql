-- H8.6: playlist membership, separate from the library.
-- A track can be in many playlists; removing it from one never deletes it.
CREATE TABLE playlist_tracks (
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  track_id    INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL DEFAULT 0,
  added_at    TEXT NOT NULL,
  PRIMARY KEY (playlist_id, track_id)
);

CREATE INDEX idx_playlist_tracks_track ON playlist_tracks(track_id);

-- Playlists imported from Spotify so far.
INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position, added_at)
  SELECT playlist_id, id, COALESCE(position, 0), added_at
  FROM tracks
  WHERE playlist_id IS NOT NULL;

-- The importer keeps writing tracks.playlist_id: these triggers mirror it.
CREATE TRIGGER trg_tracks_join_playlist_insert
AFTER INSERT ON tracks
WHEN NEW.playlist_id IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position, added_at)
  VALUES (NEW.playlist_id, NEW.id, COALESCE(NEW.position, 0), NEW.added_at);
END;

-- Only when playlist_id really changes: a re-import must not bring back
-- a track the user removed from the playlist.
CREATE TRIGGER trg_tracks_join_playlist_update
AFTER UPDATE OF playlist_id ON tracks
WHEN NEW.playlist_id IS NOT NULL AND OLD.playlist_id IS NOT NEW.playlist_id
BEGIN
  INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position, added_at)
  VALUES (NEW.playlist_id, NEW.id, COALESCE(NEW.position, 0), NEW.added_at);
END;