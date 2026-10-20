//! Dev-only sample data. Compiled out of release builds.
//! Enable with: $env:CUPID_SEED = "1"; pnpm tauri dev

use std::path::Path;

use rusqlite::params;

use super::{
    Database,
    playlists::{self, NewPlaylist},
    tracks::{self, NewTrack},
};
use crate::error::AppResult;

impl Database {
    pub fn seed_dev_data(&self) -> AppResult<()> {
        let conn = self.conn()?;
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM tracks", [], |r| r.get(0))?;
        if count > 0 {
            return Ok(()); // never touch a database that already has data
        }

        let pid = playlists::insert(&conn, &NewPlaylist::basic("Dev Mix", "Dev Mix"))?;
        let in_playlist = [
            ("Midnight Drive", "Nova Lane", 215_000, "done"),
            ("Paper Hearts", "Cupid Club", 187_000, "done"),
            ("Sugar Static", "Nova Lane", 203_000, "needs_review"),
            ("Pink Horizon", "Mint Parade", 241_000, "queued"),
        ];
        for (i, (title, artist, ms, status)) in in_playlist.iter().enumerate() {
            let mut t = NewTrack::basic(title, artist, *ms);
            t.playlist_id = Some(pid);
            t.position = Some(i as i64 + 1);
            t.status = (*status).into();
            tracks::insert(&conn, &t)?;
        }

        let singles = [
            ("Velvet Morning", "Lavender Fields", 198_000),
            ("Clover", "Mint Parade", 176_000),
            ("Rosewater", "Classic Hours", 222_000),
        ];
        for (title, artist, ms) in singles {
            let mut t = NewTrack::basic(title, artist, ms);
            t.status = "done".into();
            tracks::insert(&conn, &t)?;
        }
        Ok(())
    }

    /// Adds the real test files found in `singles_dir`. Safe to call on every start:
    /// a file that is already registered (same path) or missing on disk is skipped.
    pub fn seed_dev_audio(&self, singles_dir: &Path) -> AppResult<()> {
        let conn = self.conn()?;
        // (file name, title, duration in ms; 0 = unknown, the player reads the real one)
        let files = [
            ("Que_Sera_Sera.m4a", "Que Sera Sera", 273_000),
            ("Partner.m4a", "Partner", 0),
            ("Gyutto.m4a", "Gyutto", 0),
        ];
        for (file, title, ms) in files {
            let path = singles_dir.join(file);
            if !path.is_file() {
                continue;
            }
            let path_str = path.to_string_lossy().into_owned();
            let known: i64 = conn.query_row(
                "SELECT COUNT(*) FROM tracks WHERE file_path = ?1",
                params![path_str],
                |r| r.get(0),
            )?;
            if known > 0 {
                continue;
            }
            let mut t = NewTrack::basic(title, "Dev Audio", ms);
            t.file_path = Some(path_str);
            t.status = "done".into();
            tracks::insert(&conn, &t)?;
        }
        Ok(())
    }
}
