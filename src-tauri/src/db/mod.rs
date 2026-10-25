//! SQLite access. Only Rust touches the database.

pub mod lyrics;
pub mod playlists;
#[cfg(debug_assertions)]
mod seed;
pub mod stats;
pub mod tracks;

use std::{
    path::Path,
    sync::{Mutex, MutexGuard},
};

use rusqlite::Connection;

use crate::error::{AppError, AppResult};

/// Ordered migrations. Migration N sets `PRAGMA user_version = N`.
/// To change the schema: append a new file here, never edit an old one.
const MIGRATIONS: &[&str] = &[
    include_str!("schema.sql"),
    include_str!("002_playlist_tracks.sql"),
    include_str!("003_lyrics.sql"),
    include_str!("004_lyrics_offset.sql"),
];

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    pub fn open(path: &Path) -> AppResult<Self> {
        Self::init(Connection::open(path)?)
    }

    #[cfg(test)]
    pub fn open_in_memory() -> AppResult<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(mut conn: Connection) -> AppResult<Self> {
        conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")?;
        migrate(&mut conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn conn(&self) -> AppResult<MutexGuard<'_, Connection>> {
        self.conn
            .lock()
            .map_err(|_| AppError::Msg("database lock poisoned".into()))
    }
}

/// Applies pending migrations, each in its own transaction.
pub fn migrate(conn: &mut Connection) -> AppResult<()> {
    let current: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    let latest = MIGRATIONS.len() as i64;
    if current > latest {
        return Err(AppError::Msg(format!(
            "database version {current} is newer than this app supports ({latest})"
        )));
    }
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(current as usize) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", (i + 1) as i64)?;
        tx.commit()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::playlists::{self, NewPlaylist};
    use super::tracks::{self, NewTrack, TrackFilter};
    use super::*;

    fn db() -> Database {
        Database::open_in_memory().expect("open in-memory db")
    }

    fn user_version(conn: &Connection) -> i64 {
        conn.query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap()
    }

    #[test]
    fn migration_creates_schema_and_sets_version() {
        let d = db();
        let conn = d.conn().unwrap();
        assert_eq!(user_version(&conn), MIGRATIONS.len() as i64);
        for table in ["tracks", "playlists", "plays", "monthly_stats", "lyrics"] {
            let n: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
                    [table],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(n, 1, "missing table {table}");
        }
    }

    #[test]
    fn migration_is_idempotent() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrate(&mut conn).unwrap();
        migrate(&mut conn).unwrap();
        assert_eq!(user_version(&conn), MIGRATIONS.len() as i64);
    }

    #[test]
    fn rejects_database_from_newer_app() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "user_version", 99).unwrap();
        assert!(migrate(&mut conn).is_err());
    }

    #[test]
    fn insert_and_list_tracks() {
        let d = db();
        let conn = d.conn().unwrap();
        tracks::insert(&conn, &NewTrack::basic("One", "A", 1000)).unwrap();
        tracks::insert(&conn, &NewTrack::basic("Two", "B", 2000)).unwrap();
        let all = tracks::list(&conn, &TrackFilter::default()).unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].status, "queued");
    }

    #[test]
    fn search_is_case_insensitive_and_escapes_wildcards() {
        let d = db();
        let conn = d.conn().unwrap();
        tracks::insert(&conn, &NewTrack::basic("100% Love", "A", 1000)).unwrap();
        tracks::insert(&conn, &NewTrack::basic("Plain", "B", 1000)).unwrap();
        let q = |s: &str| {
            tracks::list(
                &conn,
                &TrackFilter {
                    query: Some(s.into()),
                    playlist_id: None,
                },
            )
            .unwrap()
            .len()
        };
        assert_eq!(q("plain"), 1);
        assert_eq!(q("%"), 1); // literal %, not "match everything"
        assert_eq!(q("_"), 0); // literal _, not "any char"
        assert_eq!(q("   "), 2); // blank query = no filter
    }

    #[test]
    fn filter_by_playlist_orders_by_position() {
        let d = db();
        let conn = d.conn().unwrap();
        let pid = playlists::insert(&conn, &NewPlaylist::basic("Mix", "Mix")).unwrap();
        for (title, pos) in [("B", 2), ("A", 1)] {
            let mut t = NewTrack::basic(title, "X", 1000);
            t.playlist_id = Some(pid);
            t.position = Some(pos);
            tracks::insert(&conn, &t).unwrap();
        }
        tracks::insert(&conn, &NewTrack::basic("Single", "X", 1000)).unwrap();
        let list = tracks::list(
            &conn,
            &TrackFilter {
                query: None,
                playlist_id: Some(pid),
            },
        )
        .unwrap();
        let titles: Vec<_> = list.iter().map(|t| t.title.as_str()).collect();
        assert_eq!(titles, ["A", "B"]);
    }

    #[test]
    fn playlist_track_count_and_delete_keeps_tracks() {
        let d = db();
        let conn = d.conn().unwrap();
        let pid = playlists::insert(&conn, &NewPlaylist::basic("Mix", "Mix")).unwrap();
        let mut t = NewTrack::basic("A", "X", 1000);
        t.playlist_id = Some(pid);
        tracks::insert(&conn, &t).unwrap();
        tracks::insert(&conn, &t).unwrap();

        let pl = playlists::list(&conn).unwrap();
        assert_eq!(pl[0].track_count, 2);

        conn.execute("DELETE FROM playlists WHERE id = ?1", [pid])
            .unwrap();
        let all = tracks::list(&conn, &TrackFilter::default()).unwrap();
        assert_eq!(all.len(), 2);
        assert!(all.iter().all(|t| t.playlist_id.is_none())); // ON DELETE SET NULL
    }

    #[test]
    fn invalid_status_is_rejected() {
        let d = db();
        let conn = d.conn().unwrap();
        let mut t = NewTrack::basic("A", "X", 1000);
        t.status = "bogus".into();
        assert!(tracks::insert(&conn, &t).is_err());
    }
}