use chrono::{SecondsFormat, Utc};
use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};

use crate::error::AppResult;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: i64,
    pub spotify_id: Option<String>,
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub duration_ms: i64,
    pub file_path: Option<String>,
    pub cover_path: Option<String>,
    pub playlist_id: Option<i64>,
    pub position: Option<i64>,
    pub status: String,
    pub source_url: Option<String>,
    pub match_score: Option<f64>,
    pub added_at: String,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackFilter {
    pub query: Option<String>,
    pub playlist_id: Option<i64>,
}

// Used by the importer (H7) and the dev seed.
#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct NewTrack {
    pub spotify_id: Option<String>,
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub duration_ms: i64,
    pub file_path: Option<String>,
    pub cover_path: Option<String>,
    pub playlist_id: Option<i64>,
    pub position: Option<i64>,
    pub status: String,
    pub source_url: Option<String>,
    pub match_score: Option<f64>,
}

#[allow(dead_code)]
impl NewTrack {
    pub fn basic(title: &str, artist: &str, duration_ms: i64) -> Self {
        Self {
            spotify_id: None,
            title: title.into(),
            artist: artist.into(),
            album: None,
            duration_ms,
            file_path: None,
            cover_path: None,
            playlist_id: None,
            position: None,
            status: "queued".into(),
            source_url: None,
            match_score: None,
        }
    }
}

const COLUMNS: &str = "id, spotify_id, title, artist, album, duration_ms, file_path, \
                       cover_path, playlist_id, position, status, source_url, match_score, added_at";

fn from_row(row: &Row) -> rusqlite::Result<Track> {
    Ok(Track {
        id: row.get("id")?,
        spotify_id: row.get("spotify_id")?,
        title: row.get("title")?,
        artist: row.get("artist")?,
        album: row.get("album")?,
        duration_ms: row.get("duration_ms")?,
        file_path: row.get("file_path")?,
        cover_path: row.get("cover_path")?,
        playlist_id: row.get("playlist_id")?,
        position: row.get("position")?,
        status: row.get("status")?,
        source_url: row.get("source_url")?,
        match_score: row.get("match_score")?,
        added_at: row.get("added_at")?,
    })
}

/// Builds a LIKE pattern treating the user's text literally (escapes \ % _).
fn like_pattern(query: &str) -> Option<String> {
    let q = query.trim();
    if q.is_empty() {
        return None;
    }
    let escaped = q
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    Some(format!("%{escaped}%"))
}

pub fn list(conn: &Connection, filter: &TrackFilter) -> AppResult<Vec<Track>> {
    // Only the constant COLUMNS is interpolated; all user input goes through bound parameters.
    let sql = format!(
        "SELECT {COLUMNS} FROM tracks \
         WHERE (?1 IS NULL OR playlist_id = ?1) \
           AND (?2 IS NULL OR title LIKE ?2 ESCAPE '\\' \
                           OR artist LIKE ?2 ESCAPE '\\' \
                           OR album LIKE ?2 ESCAPE '\\') \
         ORDER BY CASE WHEN ?1 IS NULL THEN 0 ELSE COALESCE(position, 0) END, \
                  added_at DESC, id DESC"
    );
    let pattern = filter.query.as_deref().and_then(like_pattern);
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![filter.playlist_id, pattern], from_row)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

#[allow(dead_code)]
pub fn insert(conn: &Connection, t: &NewTrack) -> AppResult<i64> {
    conn.execute(
        "INSERT INTO tracks (spotify_id, title, artist, album, duration_ms, file_path, cover_path, \
                             playlist_id, position, status, source_url, match_score, added_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            t.spotify_id,
            t.title,
            t.artist,
            t.album,
            t.duration_ms,
            t.file_path,
            t.cover_path,
            t.playlist_id,
            t.position,
            t.status,
            t.source_url,
            t.match_score,
            Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn get(conn: &Connection, id: i64) -> AppResult<Option<Track>> {
    let sql = format!("SELECT {COLUMNS} FROM tracks WHERE id = ?1");
    Ok(conn.query_row(&sql, [id], from_row).optional()?)
}

/// First track with this Spotify id inside a playlist, or among singles
/// (`playlist_id = None`).
pub fn find_by_spotify(
    conn: &Connection,
    spotify_id: &str,
    playlist_id: Option<i64>,
) -> AppResult<Option<Track>> {
    let sql = format!(
        "SELECT {COLUMNS} FROM tracks \
         WHERE spotify_id = ?1 \
           AND ((?2 IS NULL AND playlist_id IS NULL) OR playlist_id = ?2) \
         ORDER BY id LIMIT 1"
    );
    Ok(conn
        .query_row(&sql, params![spotify_id, playlist_id], from_row)
        .optional()?)
}

pub fn set_status(conn: &Connection, id: i64, status: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE tracks SET status = ?1 WHERE id = ?2",
        params![status, id],
    )?;
    Ok(())
}

pub fn set_match(conn: &Connection, id: i64, source_url: &str, score: f64) -> AppResult<()> {
    conn.execute(
        "UPDATE tracks SET source_url = ?1, match_score = ?2 WHERE id = ?3",
        params![source_url, score, id],
    )?;
    Ok(())
}

pub fn set_done(conn: &Connection, id: i64, file_path: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE tracks SET status = 'done', file_path = ?1 WHERE id = ?2",
        params![file_path, id],
    )?;
    Ok(())
}

pub fn set_cover_path(conn: &Connection, id: i64, path: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE tracks SET cover_path = ?1 WHERE id = ?2",
        params![path, id],
    )?;
    Ok(())
}

/// Marks as `failed` the given tracks that are still in progress.
pub fn fail_unfinished(conn: &Connection, ids: &[i64]) -> AppResult<()> {
    for id in ids {
        conn.execute(
            "UPDATE tracks SET status = 'failed' \
             WHERE id = ?1 AND status IN ('queued', 'searching', 'downloading', 'tagging')",
            [id],
        )?;
    }
    Ok(())
}

/// At startup: anything left in progress by a closed app becomes retryable.
pub fn fail_all_unfinished(conn: &Connection) -> AppResult<usize> {
    Ok(conn.execute(
        "UPDATE tracks SET status = 'failed' \
         WHERE status IN ('queued', 'searching', 'downloading', 'tagging')",
        [],
    )?)
}

/// Edits the user-visible text of a track (H8). `album = None` clears it.
pub fn update_meta(
    conn: &Connection,
    id: i64,
    title: &str,
    artist: &str,
    album: Option<&str>,
) -> AppResult<()> {
    conn.execute(
        "UPDATE tracks SET title = ?1, artist = ?2, album = ?3 WHERE id = ?4",
        params![title, artist, album, id],
    )?;
    Ok(())
}

pub fn set_duration(conn: &Connection, id: i64, duration_ms: i64) -> AppResult<()> {
    conn.execute(
        "UPDATE tracks SET duration_ms = ?1 WHERE id = ?2",
        params![duration_ms, id],
    )?;
    Ok(())
}

/// Removes the row. `plays` rows go with it (ON DELETE CASCADE).
pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM tracks WHERE id = ?1", [id])?;
    Ok(())
}

/// (id, file_path) of tracks that have a file but no known duration.
pub fn list_missing_durations(conn: &Connection) -> AppResult<Vec<(i64, String)>> {
    let mut stmt = conn.prepare(
        "SELECT id, file_path FROM tracks WHERE duration_ms <= 0 AND file_path IS NOT NULL",
    )?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// How many other tracks point at the same cover file.
pub fn count_cover_uses(conn: &Connection, cover_path: &str, except_id: i64) -> AppResult<i64> {
    Ok(conn.query_row(
        "SELECT COUNT(*) FROM tracks WHERE cover_path = ?1 AND id <> ?2",
        params![cover_path, except_id],
        |r| r.get(0),
    )?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{
        Database,
        playlists::{self, NewPlaylist},
    };
    use crate::import::state::TrackStatus;

    fn db() -> Database {
        Database::open_in_memory().expect("open in-memory db")
    }

    fn insert_with_status(conn: &Connection, status: &str) -> i64 {
        let mut t = NewTrack::basic(status, "A", 1000);
        t.status = status.into();
        insert(conn, &t).expect("insert")
    }

    #[test]
    fn import_helpers_update_rows() {
        let d = db();
        let conn = d.conn().expect("conn");
        let id = insert(&conn, &NewTrack::basic("T", "A", 1000)).expect("insert");
        set_status(&conn, id, "searching").expect("status");
        set_match(
            &conn,
            id,
            "https://www.youtube.com/watch?v=dGoHLoDmHdI",
            102.0,
        )
        .expect("match");
        set_done(&conn, id, "C:\\Music\\a.opus").expect("done");
        let t = get(&conn, id).expect("get").expect("exists");
        assert_eq!(t.status, "done");
        assert_eq!(t.file_path.as_deref(), Some("C:\\Music\\a.opus"));
        assert_eq!(t.match_score, Some(102.0));
        assert!(t.source_url.is_some());
        assert!(get(&conn, 9999).expect("get").is_none());
    }

    #[test]
    fn all_import_statuses_are_accepted_by_the_schema() {
        let d = db();
        let conn = d.conn().expect("conn");
        let id = insert(&conn, &NewTrack::basic("T", "A", 1000)).expect("insert");
        for status in [
            TrackStatus::Queued,
            TrackStatus::Searching,
            TrackStatus::Downloading,
            TrackStatus::Tagging,
            TrackStatus::Done,
            TrackStatus::NeedsReview,
            TrackStatus::Failed,
        ] {
            set_status(&conn, id, status.as_str())
                .unwrap_or_else(|_| panic!("{}", status.as_str()));
        }
    }

    #[test]
    fn find_by_spotify_is_scoped_by_playlist() {
        let d = db();
        let conn = d.conn().expect("conn");
        let pid = playlists::insert(&conn, &NewPlaylist::basic("Mix", "Mix")).expect("playlist");
        let mut single = NewTrack::basic("S", "A", 1000);
        single.spotify_id = Some("sp1".into());
        let single_id = insert(&conn, &single).expect("insert");
        let mut in_pl = NewTrack::basic("S", "A", 1000);
        in_pl.spotify_id = Some("sp1".into());
        in_pl.playlist_id = Some(pid);
        let in_pl_id = insert(&conn, &in_pl).expect("insert");

        let a = find_by_spotify(&conn, "sp1", None)
            .expect("find")
            .expect("single");
        let b = find_by_spotify(&conn, "sp1", Some(pid))
            .expect("find")
            .expect("in playlist");
        assert_eq!((a.id, b.id), (single_id, in_pl_id));
        assert!(
            find_by_spotify(&conn, "other", None)
                .expect("find")
                .is_none()
        );
        assert!(
            find_by_spotify(&conn, "sp1", Some(pid + 1))
                .expect("find")
                .is_none()
        );
    }

    #[test]
    fn fail_helpers_only_touch_in_progress_rows() {
        let d = db();
        let conn = d.conn().expect("conn");
        let names = [
            "queued",
            "searching",
            "downloading",
            "tagging",
            "done",
            "needs_review",
            "failed",
        ];
        let ids: Vec<i64> = names.iter().map(|s| insert_with_status(&conn, s)).collect();

        fail_unfinished(&conn, &[ids[0], ids[4]]).expect("fail some");
        let status = |i: usize| get(&conn, ids[i]).expect("get").expect("row").status;
        assert_eq!(status(0), "failed");
        assert_eq!(status(1), "searching"); // not in the list
        assert_eq!(status(4), "done"); // finished rows are never touched

        assert_eq!(fail_all_unfinished(&conn).expect("fail all"), 3);
        let after: Vec<String> = (0..7).map(status).collect();
        assert_eq!(
            after,
            [
                "failed",
                "failed",
                "failed",
                "failed",
                "done",
                "needs_review",
                "failed"
            ]
        );
    }
}
