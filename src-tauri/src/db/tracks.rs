use chrono::{SecondsFormat, Utc};
use rusqlite::{Connection, Row, params};
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
