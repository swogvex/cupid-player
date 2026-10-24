//! User playlists and playlist membership (H8.6).
//!
//! Membership lives in `playlist_tracks`, separate from the library: removing a
//! track from a playlist, or deleting a playlist, never deletes a track or a file.
//! Imported (Spotify) playlists are members too: SQL triggers keep the table in
//! sync with `tracks.playlist_id`, so the importer needs no changes.

use std::path::{Path, PathBuf};

use chrono::{SecondsFormat, Utc};
use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::Serialize;
use thiserror::Error;

use crate::db::playlists::{self, NewPlaylist};
use crate::library::edit::clean_tag;
use crate::library::names;

pub const MAX_NAME_CHARS: usize = 60;
/// Tracks that can be added to a playlist in one call.
pub const MAX_ADD: usize = 5000;

#[derive(Debug, Error)]
pub enum ListError {
    #[error("playlist not found")]
    NotFound,
    #[error("invalid playlist name")]
    InvalidName,
    #[error("a playlist with that name already exists")]
    NameTaken,
    #[error("too many tracks at once")]
    TooMany,
    #[error("the playlist has no usable folder")]
    NoFolder,
    #[error("database: {0}")]
    Db(String),
}

impl From<rusqlite::Error> for ListError {
    fn from(e: rusqlite::Error) -> Self {
        ListError::Db(e.to_string())
    }
}

impl ListError {
    /// Stable code the UI translates with `errors.<code>` (D-99).
    pub fn code(&self) -> &'static str {
        match self {
            ListError::NotFound => "playlist.not_found",
            ListError::InvalidName => "playlist.invalid_name",
            ListError::NameTaken => "playlist.name_taken",
            ListError::TooMany => "playlist.too_many",
            ListError::NoFolder => "playlist.no_folder",
            ListError::Db(_) => "playlist.db",
        }
    }
}

/// Same fields the frontend already knows as `Playlist`; the count comes from
/// `playlist_tracks`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistRow {
    pub id: i64,
    pub spotify_id: Option<String>,
    pub name: String,
    pub folder: String,
    pub cover_path: Option<String>,
    pub created_at: String,
    pub track_count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Member {
    pub playlist_id: i64,
    pub track_id: i64,
}

const SELECT_ROW: &str = "SELECT p.id, p.spotify_id, p.name, p.folder, p.cover_path, p.created_at, \
     (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.playlist_id = p.id) \
     FROM playlists p";

fn from_row(r: &Row) -> rusqlite::Result<PlaylistRow> {
    Ok(PlaylistRow {
        id: r.get(0)?,
        spotify_id: r.get(1)?,
        name: r.get(2)?,
        folder: r.get(3)?,
        cover_path: r.get(4)?,
        created_at: r.get(5)?,
        track_count: r.get(6)?,
    })
}

pub fn list(conn: &Connection) -> Result<Vec<PlaylistRow>, ListError> {
    let sql = format!("{SELECT_ROW} ORDER BY p.name COLLATE NOCASE, p.id");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], from_row)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn get(conn: &Connection, id: i64) -> Result<PlaylistRow, ListError> {
    let sql = format!("{SELECT_ROW} WHERE p.id = ?1");
    conn.query_row(&sql, [id], from_row)
        .optional()?
        .ok_or(ListError::NotFound)
}

/// Cleans the name and checks length and uniqueness (ignoring case) against
/// every other playlist.
fn valid_name(conn: &Connection, raw: &str, except_id: i64) -> Result<String, ListError> {
    let name = clean_tag(raw);
    if name.is_empty() || name.chars().count() > MAX_NAME_CHARS {
        return Err(ListError::InvalidName);
    }
    let taken: i64 = conn.query_row(
        "SELECT COUNT(*) FROM playlists WHERE name = ?1 COLLATE NOCASE AND id <> ?2",
        params![name, except_id],
        |r| r.get(0),
    )?;
    if taken > 0 {
        return Err(ListError::NameTaken);
    }
    Ok(name)
}

/// A playlist of the user's own: no Spotify id and no folder on disk.
pub fn create(conn: &Connection, name: &str) -> Result<PlaylistRow, ListError> {
    let name = valid_name(conn, name, 0)?;
    let id = playlists::insert(conn, &NewPlaylist::basic(&name, ""))
        .map_err(|e| ListError::Db(e.to_string()))?;
    get(conn, id)
}

/// Renames any playlist. For imported ones only the name changes, never the folder.
pub fn rename(conn: &Connection, id: i64, raw: &str) -> Result<PlaylistRow, ListError> {
    get(conn, id)?;
    let name = valid_name(conn, raw, id)?;
    conn.execute(
        "UPDATE playlists SET name = ?1 WHERE id = ?2",
        params![name, id],
    )?;
    get(conn, id)
}

/// Deletes the playlist only. Its tracks stay in the library and no file is touched.
pub fn delete(conn: &Connection, id: i64) -> Result<(), ListError> {
    let n = conn.execute("DELETE FROM playlists WHERE id = ?1", [id])?;
    if n == 0 {
        return Err(ListError::NotFound);
    }
    Ok(())
}

/// Adds tracks at the end, skipping ones already in the playlist and ids that do
/// not exist. Returns how many were added.
pub fn add_tracks(
    conn: &Connection,
    playlist_id: i64,
    track_ids: &[i64],
) -> Result<usize, ListError> {
    if track_ids.len() > MAX_ADD {
        return Err(ListError::TooMany);
    }
    get(conn, playlist_id)?;
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    let tx = conn.unchecked_transaction()?;
    let mut added = 0;
    for id in track_ids {
        added += tx.execute(
            "INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position, added_at) \
             SELECT ?1, t.id, \
                    COALESCE((SELECT MAX(position) FROM playlist_tracks WHERE playlist_id = ?1), 0) + 1, \
                    ?3 \
             FROM tracks t WHERE t.id = ?2",
            params![playlist_id, id, now],
        )?;
    }
    tx.commit()?;
    Ok(added)
}

/// Removes the track from this playlist only; the library keeps it.
pub fn remove_track(conn: &Connection, playlist_id: i64, track_id: i64) -> Result<bool, ListError> {
    get(conn, playlist_id)?;
    let n = conn.execute(
        "DELETE FROM playlist_tracks WHERE playlist_id = ?1 AND track_id = ?2",
        params![playlist_id, track_id],
    )?;
    Ok(n > 0)
}

/// Every (playlist, track) pair, in playlist order.
pub fn list_members(conn: &Connection) -> Result<Vec<Member>, ListError> {
    let mut stmt = conn.prepare(
        "SELECT playlist_id, track_id FROM playlist_tracks \
         ORDER BY playlist_id, position, track_id",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Member {
            playlist_id: r.get(0)?,
            track_id: r.get(1)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// The playlist's folder on disk, only when it has a safe name and exists.
/// User playlists (empty folder) have none.
pub fn playlist_dir(
    conn: &Connection,
    playlists_dir: &Path,
    id: i64,
) -> Result<PathBuf, ListError> {
    let p = get(conn, id)?;
    if !names::is_safe_component(&p.folder, names::MAX_FOLDER_CHARS) {
        return Err(ListError::NoFolder);
    }
    let dir = playlists_dir.join(&p.folder);
    if names::is_inside(playlists_dir, &dir) && dir.is_dir() {
        Ok(dir)
    } else {
        Err(ListError::NoFolder)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;
    use crate::db::tracks::{self, NewTrack, TrackFilter};

    fn db() -> Database {
        Database::open_in_memory().expect("db")
    }

    fn track(conn: &Connection, title: &str) -> i64 {
        tracks::insert(conn, &NewTrack::basic(title, "X", 1000)).expect("track")
    }

    fn ids(conn: &Connection, playlist: i64) -> Vec<i64> {
        list_members(conn)
            .expect("members")
            .into_iter()
            .filter(|m| m.playlist_id == playlist)
            .map(|m| m.track_id)
            .collect()
    }

    #[test]
    fn the_migration_backfills_existing_playlist_tracks() {
        let mut conn = Connection::open_in_memory().expect("conn");
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .expect("pragma");
        conn.execute_batch(include_str!("../db/schema.sql"))
            .expect("version 1 schema");
        conn.pragma_update(None, "user_version", 1)
            .expect("version");

        let pid = playlists::insert(&conn, &NewPlaylist::basic("Mix", "Mix")).expect("playlist");
        for (title, pos) in [("A", 1), ("B", 2)] {
            let mut t = NewTrack::basic(title, "X", 1000);
            t.playlist_id = Some(pid);
            t.position = Some(pos);
            tracks::insert(&conn, &t).expect("insert");
        }
        tracks::insert(&conn, &NewTrack::basic("Single", "X", 1000)).expect("single");

        crate::db::migrate(&mut conn).expect("migrate");
        let members = list_members(&conn).expect("members");
        assert_eq!(members.len(), 2);
        assert!(members.iter().all(|m| m.playlist_id == pid));
    }

    #[test]
    fn creates_renames_and_deletes_playlists() {
        let d = db();
        let conn = d.conn().expect("conn");
        let a = create(&conn, "  Road   trip ").expect("create");
        assert_eq!(
            (a.name.as_str(), a.folder.as_str(), a.track_count),
            ("Road trip", "", 0)
        );
        assert!(a.spotify_id.is_none());
        let b = create(&conn, "Gym").expect("a second playlist of the user");

        assert!(matches!(
            create(&conn, "road TRIP"),
            Err(ListError::NameTaken)
        ));
        for bad in ["   ", "\u{200B}"] {
            assert!(matches!(create(&conn, bad), Err(ListError::InvalidName)));
        }
        assert!(matches!(
            create(&conn, &"a".repeat(MAX_NAME_CHARS + 1)),
            Err(ListError::InvalidName)
        ));

        assert_eq!(
            rename(&conn, a.id, "Road TRIP 2").expect("rename").name,
            "Road TRIP 2"
        );
        assert_eq!(
            rename(&conn, a.id, "road trip 2")
                .expect("same name, other case")
                .name,
            "road trip 2"
        );
        assert!(matches!(
            rename(&conn, a.id, "gym"),
            Err(ListError::NameTaken)
        ));
        assert_eq!(list(&conn).expect("list").len(), 2);

        delete(&conn, b.id).expect("delete");
        assert!(matches!(delete(&conn, b.id), Err(ListError::NotFound)));
        assert!(matches!(get(&conn, b.id), Err(ListError::NotFound)));
        assert!(matches!(rename(&conn, b.id, "x"), Err(ListError::NotFound)));
    }

    #[test]
    fn adding_and_removing_members_never_touches_the_library() {
        let d = db();
        let conn = d.conn().expect("conn");
        let p = create(&conn, "Mix").expect("playlist").id;
        let (a, b) = (track(&conn, "A"), track(&conn, "B"));

        assert_eq!(
            add_tracks(&conn, p, &[a, b, a, 9999]).expect("add"),
            2,
            "duplicates and unknown ids are skipped"
        );
        assert_eq!(ids(&conn, p), [a, b]);
        assert_eq!(add_tracks(&conn, p, &[a]).expect("again"), 0);
        assert_eq!(get(&conn, p).expect("get").track_count, 2);

        assert!(remove_track(&conn, p, a).expect("remove"));
        assert!(!remove_track(&conn, p, a).expect("remove again"));
        assert_eq!(ids(&conn, p), [b]);
        let all = tracks::list(&conn, &TrackFilter::default()).expect("list");
        assert_eq!(all.len(), 2, "the library keeps both tracks");

        add_tracks(&conn, p, &[a]).expect("re-add");
        assert_eq!(ids(&conn, p), [b, a], "a re-added track goes to the end");
        assert!(matches!(
            add_tracks(&conn, 777, &[a]),
            Err(ListError::NotFound)
        ));
        assert!(matches!(
            remove_track(&conn, 777, a),
            Err(ListError::NotFound)
        ));
    }

    #[test]
    fn deleting_a_playlist_or_a_track_only_affects_membership() {
        let d = db();
        let conn = d.conn().expect("conn");
        let (a, b) = (track(&conn, "A"), track(&conn, "B"));
        let p = create(&conn, "One").expect("playlist").id;
        add_tracks(&conn, p, &[a, b]).expect("add");

        delete(&conn, p).expect("delete playlist");
        let all = tracks::list(&conn, &TrackFilter::default()).expect("list");
        assert_eq!(all.len(), 2, "the tracks survive their playlist");
        assert!(list_members(&conn).expect("members").is_empty());

        let p2 = create(&conn, "Two").expect("playlist").id;
        add_tracks(&conn, p2, &[a, b]).expect("add");
        tracks::delete(&conn, a).expect("delete track");
        assert_eq!(ids(&conn, p2), [b]);
        assert_eq!(get(&conn, p2).expect("get").track_count, 1);
    }

    #[test]
    fn imported_playlists_are_members_too_and_removal_keeps_the_origin() {
        let d = db();
        let conn = d.conn().expect("conn");
        let pid = playlists::insert(&conn, &NewPlaylist::basic("Mix", "Mix")).expect("playlist");
        let mut t = NewTrack::basic("A", "X", 1000);
        t.playlist_id = Some(pid);
        t.position = Some(1);
        let a = tracks::insert(&conn, &t).expect("a");
        t.title = "B".into();
        t.position = Some(2);
        let b = tracks::insert(&conn, &t).expect("b");

        assert_eq!(ids(&conn, pid), [a, b], "the triggers mirror the import");
        assert_eq!(get(&conn, pid).expect("get").track_count, 2);

        assert!(remove_track(&conn, pid, a).expect("remove"));
        assert_eq!(get(&conn, pid).expect("get").track_count, 1);
        let row = tracks::get(&conn, a).expect("get").expect("row");
        assert_eq!(row.playlist_id, Some(pid), "the track keeps its origin");

        conn.execute("UPDATE tracks SET position = 5 WHERE id = ?1", [a])
            .expect("update");
        assert_eq!(ids(&conn, pid), [b], "a re-import does not bring it back");
    }

    #[test]
    fn only_playlists_with_a_real_folder_can_be_opened() {
        let d = db();
        let conn = d.conn().expect("conn");
        let root = std::env::temp_dir().join(format!("cupid-lists-test-{}", uuid::Uuid::new_v4()));
        let playlists_dir = root.join("Playlists");
        std::fs::create_dir_all(playlists_dir.join("Mix")).expect("dirs");

        let imported =
            playlists::insert(&conn, &NewPlaylist::basic("Mix", "Mix")).expect("imported");
        let missing =
            playlists::insert(&conn, &NewPlaylist::basic("Gone", "Gone")).expect("missing");
        let evil = playlists::insert(&conn, &NewPlaylist::basic("Evil", "..")).expect("evil");
        let user = create(&conn, "Mine").expect("user").id;

        assert_eq!(
            playlist_dir(&conn, &playlists_dir, imported).expect("dir"),
            playlists_dir.join("Mix")
        );
        for id in [missing, evil, user] {
            assert!(matches!(
                playlist_dir(&conn, &playlists_dir, id),
                Err(ListError::NoFolder)
            ));
        }
        assert!(matches!(
            playlist_dir(&conn, &playlists_dir, 999),
            Err(ListError::NotFound)
        ));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn adding_too_many_tracks_at_once_is_refused() {
        let d = db();
        let conn = d.conn().expect("conn");
        let p = create(&conn, "Big").expect("playlist").id;
        let ids = vec![1_i64; MAX_ADD + 1];
        assert!(matches!(
            add_tracks(&conn, p, &ids),
            Err(ListError::TooMany)
        ));
    }
}
