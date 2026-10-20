use chrono::{SecondsFormat, Utc};
use rusqlite::{Connection, params};
use serde::Serialize;

use crate::error::AppResult;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Playlist {
    pub id: i64,
    pub spotify_id: Option<String>,
    pub name: String,
    pub folder: String,
    pub cover_path: Option<String>,
    pub created_at: String,
    pub track_count: i64,
}

#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct NewPlaylist {
    pub spotify_id: Option<String>,
    pub name: String,
    pub folder: String,
    pub cover_path: Option<String>,
}

#[allow(dead_code)]
impl NewPlaylist {
    pub fn basic(name: &str, folder: &str) -> Self {
        Self {
            spotify_id: None,
            name: name.into(),
            folder: folder.into(),
            cover_path: None,
        }
    }
}

pub fn list(conn: &Connection) -> AppResult<Vec<Playlist>> {
    let mut stmt = conn.prepare(
        "SELECT p.id, p.spotify_id, p.name, p.folder, p.cover_path, p.created_at, COUNT(t.id) \
         FROM playlists p LEFT JOIN tracks t ON t.playlist_id = p.id \
         GROUP BY p.id \
         ORDER BY p.created_at DESC, p.id DESC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Playlist {
            id: r.get(0)?,
            spotify_id: r.get(1)?,
            name: r.get(2)?,
            folder: r.get(3)?,
            cover_path: r.get(4)?,
            created_at: r.get(5)?,
            track_count: r.get(6)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

#[allow(dead_code)]
pub fn insert(conn: &Connection, p: &NewPlaylist) -> AppResult<i64> {
    conn.execute(
        "INSERT INTO playlists (spotify_id, name, folder, cover_path, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            p.spotify_id,
            p.name,
            p.folder,
            p.cover_path,
            Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
        ],
    )?;
    Ok(conn.last_insert_rowid())
}
