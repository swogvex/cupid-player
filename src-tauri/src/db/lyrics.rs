//! Lyrics cache: one row per track.

use rusqlite::{Connection, OptionalExtension, params};

use crate::error::AppResult;
use crate::lyrics::TrackKey;

#[derive(Debug, Clone, PartialEq)]
pub struct StoredLyrics {
    /// "synced" | "plain" | "instrumental" | "not_found"
    pub status: String,
    /// Raw LRC text.
    pub synced: Option<String>,
    pub plain: Option<String>,
    /// RFC 3339, UTC.
    pub fetched_at: String,
}

/// What LRCLIB needs to know about a track. `None` if the track does not exist.
pub fn track_key(conn: &Connection, track_id: i64) -> AppResult<Option<TrackKey>> {
    let row = conn
        .query_row(
            "SELECT title, artist, album, duration_ms FROM tracks WHERE id = ?1",
            [track_id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, i64>(3)?,
                ))
            },
        )
        .optional()?;
    Ok(row.map(|(title, artist, album, ms)| TrackKey {
        title,
        artist,
        album: album.filter(|a| !a.trim().is_empty()),
        duration_secs: if ms > 0 {
            Some(ms as f64 / 1000.0)
        } else {
            None
        },
    }))
}

pub fn get(conn: &Connection, track_id: i64) -> AppResult<Option<StoredLyrics>> {
    let row = conn
        .query_row(
            "SELECT status, synced, plain, fetched_at FROM lyrics WHERE track_id = ?1",
            [track_id],
            |r| {
                Ok(StoredLyrics {
                    status: r.get(0)?,
                    synced: r.get(1)?,
                    plain: r.get(2)?,
                    fetched_at: r.get(3)?,
                })
            },
        )
        .optional()?;
    Ok(row)
}

pub fn put(conn: &Connection, track_id: i64, s: &StoredLyrics) -> AppResult<()> {
    conn.execute(
        "INSERT INTO lyrics (track_id, status, synced, plain, fetched_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(track_id) DO UPDATE SET
           status = excluded.status,
           synced = excluded.synced,
           plain = excluded.plain,
           fetched_at = excluded.fetched_at",
        params![track_id, s.status, s.synced, s.plain, s.fetched_at],
    )?;
    Ok(())
}

/// Largest shift the user can apply, in either direction.
pub const OFFSET_LIMIT_MS: i64 = 10_000;

/// Saved shift of a track's lyrics in ms (> 0 shows them later). 0 if nothing is saved.
pub fn get_offset(conn: &Connection, track_id: i64) -> AppResult<i64> {
    let value = conn
        .query_row(
            "SELECT offset_ms FROM lyrics WHERE track_id = ?1",
            [track_id],
            |r| r.get::<_, i64>(0),
        )
        .optional()?;
    Ok(value.unwrap_or(0))
}

/// Saves the shift (clamped to ±10 s) and returns the value stored.
/// It needs an existing lyrics row; `put` never touches this column.
pub fn set_offset(conn: &Connection, track_id: i64, offset_ms: i64) -> AppResult<i64> {
    let value = offset_ms.clamp(-OFFSET_LIMIT_MS, OFFSET_LIMIT_MS);
    conn.execute(
        "UPDATE lyrics SET offset_ms = ?1 WHERE track_id = ?2",
        params![value, track_id],
    )?;
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;

    fn track(conn: &Connection, album: Option<&str>, duration_ms: i64) -> i64 {
        conn.execute(
            "INSERT INTO tracks (title, artist, album, duration_ms, status, added_at)
             VALUES ('T', 'A', ?1, ?2, 'done', '2026-01-01T00:00:00Z')",
            params![album, duration_ms],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn stored(status: &str) -> StoredLyrics {
        StoredLyrics {
            status: status.into(),
            synced: None,
            plain: Some("x".into()),
            fetched_at: "2026-10-24T00:00:00+00:00".into(),
        }
    }

    #[test]
    fn put_get_and_overwrite() {
        let d = Database::open_in_memory().unwrap();
        let conn = d.conn().unwrap();
        let id = track(&conn, None, 200_000);
        assert!(get(&conn, id).unwrap().is_none());
        put(&conn, id, &stored("plain")).unwrap();
        assert_eq!(get(&conn, id).unwrap().unwrap().status, "plain");
        put(&conn, id, &stored("not_found")).unwrap();
        assert_eq!(get(&conn, id).unwrap().unwrap().status, "not_found");
    }

    #[test]
    fn deleting_the_track_deletes_its_lyrics() {
        let d = Database::open_in_memory().unwrap();
        let conn = d.conn().unwrap();
        let id = track(&conn, None, 200_000);
        put(&conn, id, &stored("plain")).unwrap();
        conn.execute("DELETE FROM tracks WHERE id = ?1", [id])
            .unwrap();
        assert!(get(&conn, id).unwrap().is_none());
    }

    #[test]
    fn rejects_unknown_status() {
        let d = Database::open_in_memory().unwrap();
        let conn = d.conn().unwrap();
        let id = track(&conn, None, 200_000);
        assert!(put(&conn, id, &stored("bogus")).is_err());
    }

    #[test]
    fn track_key_ignores_missing_duration_and_blank_album() {
        let d = Database::open_in_memory().unwrap();
        let conn = d.conn().unwrap();
        let a = track(&conn, Some("  "), 0);
        let k = track_key(&conn, a).unwrap().unwrap();
        assert!(k.album.is_none() && k.duration_secs.is_none());
        let b = track(&conn, Some("Album"), 213_400);
        let k = track_key(&conn, b).unwrap().unwrap();
        assert_eq!(k.album.as_deref(), Some("Album"));
        assert_eq!(k.duration_secs, Some(213.4));
        assert!(track_key(&conn, 9999).unwrap().is_none());
    }

    #[test]
    fn offset_defaults_to_zero_persists_and_survives_a_refresh() {
        let d = Database::open_in_memory().unwrap();
        let conn = d.conn().unwrap();
        let id = track(&conn, None, 200_000);
        assert_eq!(get_offset(&conn, id).unwrap(), 0); // no row yet
        put(&conn, id, &stored("synced")).unwrap();
        assert_eq!(set_offset(&conn, id, 500).unwrap(), 500);
        assert_eq!(get_offset(&conn, id).unwrap(), 500);
        put(&conn, id, &stored("plain")).unwrap(); // a refresh rewrites the row
        assert_eq!(get_offset(&conn, id).unwrap(), 500);
    }

    #[test]
    fn offset_is_clamped() {
        let d = Database::open_in_memory().unwrap();
        let conn = d.conn().unwrap();
        let id = track(&conn, None, 200_000);
        put(&conn, id, &stored("synced")).unwrap();
        assert_eq!(set_offset(&conn, id, 99_999).unwrap(), OFFSET_LIMIT_MS);
        assert_eq!(set_offset(&conn, id, -99_999).unwrap(), -OFFSET_LIMIT_MS);
    }
}
