//! Lyrics: fetched once from LRCLIB (no key, no account) and cached in SQLite.
//! After the first lookup a track's lyrics work offline.

pub mod client;
pub mod lrc;

use chrono::{DateTime, Utc};
use serde::Serialize;
use thiserror::Error;

use crate::db::{Database, lyrics as store, lyrics::StoredLyrics};
use crate::error::AppError;
use client::Found;
use lrc::{LrcLine, parse_lrc};

pub const SYNCED: &str = "synced";
pub const PLAIN: &str = "plain";
pub const INSTRUMENTAL: &str = "instrumental";
pub const NOT_FOUND: &str = "not_found";

/// A "not found" answer is asked again after this many days (the catalog grows).
const NOT_FOUND_RETRY_DAYS: i64 = 7;

/// What is sent to LRCLIB to identify a recording.
#[derive(Debug, Clone, PartialEq)]
pub struct TrackKey {
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub duration_secs: Option<f64>,
}

#[derive(Debug, Error)]
pub enum LyricsError {
    #[error("track not found")]
    NoTrack,
    #[error("lyrics service unavailable: {0}")]
    Unavailable(String),
    #[error("unexpected HTTP status {0}")]
    Status(u16),
    #[error("unexpected response from the lyrics service")]
    BadResponse,
    #[error("database error: {0}")]
    Db(String),
}

impl LyricsError {
    /// Stable code for the frontend (D-99).
    pub fn code(&self) -> &'static str {
        match self {
            LyricsError::NoTrack => "lyrics.no_track",
            LyricsError::Unavailable(_) => "lyrics.unavailable",
            LyricsError::Status(_) | LyricsError::BadResponse => "lyrics.failed",
            LyricsError::Db(_) => "lyrics.db",
        }
    }
}

fn db_err(e: AppError) -> LyricsError {
    LyricsError::Db(e.to_string())
}

/// Sent to the frontend. `lines` is filled for "synced", `plain` for "plain".
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LyricsPayload {
    pub track_id: i64,
    /// "synced" | "plain" | "instrumental" | "not_found"
    pub status: String,
    pub lines: Vec<LrcLine>,
    pub plain: Option<String>,
}

fn classify(f: &Found) -> (&'static str, Option<String>, Option<String>) {
    if f.instrumental {
        return (INSTRUMENTAL, None, None);
    }
    if let Some(s) = f
        .synced_lyrics
        .as_deref()
        .filter(|s| parse_lrc(s).iter().any(|l| !l.text.is_empty()))
    {
        return (SYNCED, Some(s.to_string()), None);
    }
    if let Some(p) = f
        .plain_lyrics
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty())
    {
        return (PLAIN, None, Some(p.to_string()));
    }
    (NOT_FOUND, None, None)
}

fn to_payload(track_id: i64, s: &StoredLyrics) -> LyricsPayload {
    let mut payload = LyricsPayload {
        track_id,
        status: s.status.clone(),
        lines: Vec::new(),
        plain: None,
    };
    match s.status.as_str() {
        SYNCED => {
            payload.lines = s.synced.as_deref().map(parse_lrc).unwrap_or_default();
            if payload.lines.is_empty() {
                payload.status = NOT_FOUND.into(); // corrupt row: behave as "nothing"
            }
        }
        PLAIN => payload.plain = s.plain.clone(),
        _ => {}
    }
    payload
}

/// Found answers never expire; "not found" answers do.
fn is_fresh(status: &str, fetched_at: &str, now: DateTime<Utc>) -> bool {
    if status != NOT_FOUND {
        return true;
    }
    DateTime::parse_from_rfc3339(fetched_at)
        .map(|t| now.signed_duration_since(t.with_timezone(&Utc)).num_days() < NOT_FOUND_RETRY_DAYS)
        .unwrap_or(false)
}

/// Lyrics of a track: from the cache if possible, otherwise from LRCLIB (then cached).
/// A failed request is never cached, so it is simply tried again next time.
pub async fn get_lyrics(
    db: &Database,
    track_id: i64,
    refresh: bool,
    now: DateTime<Utc>,
) -> Result<LyricsPayload, LyricsError> {
    // The database lock is released before any await.
    let (key, cached) = {
        let conn = db.conn().map_err(db_err)?;
        let key = store::track_key(&conn, track_id)
            .map_err(db_err)?
            .ok_or(LyricsError::NoTrack)?;
        let cached = store::get(&conn, track_id).map_err(db_err)?;
        (key, cached)
    };

    if let Some(c) = &cached
        && !refresh
        && is_fresh(&c.status, &c.fetched_at, now)
    {
        return Ok(to_payload(track_id, c));
    }

    match client::lookup(&key).await {
        Ok(found) => {
            let (status, synced, plain) = match &found {
                Some(f) => classify(f),
                None => (NOT_FOUND, None, None),
            };
            let stored = StoredLyrics {
                status: status.into(),
                synced,
                plain,
                fetched_at: now.to_rfc3339(),
            };
            let conn = db.conn().map_err(db_err)?;
            store::put(&conn, track_id, &stored).map_err(db_err)?;
            Ok(to_payload(track_id, &stored))
        }
        Err(e) => {
            // Service down: keep serving an older found answer if we have one.
            if let Some(c) = &cached
                && c.status != NOT_FOUND
            {
                return Ok(to_payload(track_id, c));
            }
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ts(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    fn found(synced: Option<&str>, plain: Option<&str>, instrumental: bool) -> Found {
        Found {
            instrumental,
            duration: Some(200.0),
            synced_lyrics: synced.map(String::from),
            plain_lyrics: plain.map(String::from),
        }
    }

    #[test]
    fn classifies_answers() {
        assert_eq!(classify(&found(Some("[00:01.00]a"), Some("a"), false)).0, SYNCED);
        assert_eq!(classify(&found(None, Some("a\nb"), false)).0, PLAIN);
        assert_eq!(classify(&found(Some("garbage"), Some("a"), false)).0, PLAIN);
        assert_eq!(classify(&found(None, None, true)).0, INSTRUMENTAL);
        assert_eq!(classify(&found(Some("  "), Some("  "), false)).0, NOT_FOUND);
    }

    #[test]
    fn not_found_expires_but_found_does_not() {
        let now = ts("2026-10-24T12:00:00+00:00");
        assert!(is_fresh(NOT_FOUND, "2026-10-20T12:00:00+00:00", now));
        assert!(!is_fresh(NOT_FOUND, "2026-10-10T12:00:00+00:00", now));
        assert!(!is_fresh(NOT_FOUND, "not a date", now));
        assert!(is_fresh(SYNCED, "2020-01-01T00:00:00+00:00", now));
    }

    fn db_with_cached(stored: &StoredLyrics) -> (Database, i64) {
        let d = Database::open_in_memory().unwrap();
        let id = {
            let conn = d.conn().unwrap();
            conn.execute(
                "INSERT INTO tracks (title, artist, duration_ms, status, added_at)
                 VALUES ('T', 'A', 200000, 'done', '2026-01-01T00:00:00Z')",
                [],
            )
            .unwrap();
            let id = conn.last_insert_rowid();
            store::put(&conn, id, stored).unwrap();
            id
        };
        (d, id)
    }

    #[tokio::test]
    async fn serves_cached_lyrics_without_network() {
        let stored = StoredLyrics {
            status: SYNCED.into(),
            synced: Some("[00:02.00]two\n[00:01.00]one".into()),
            plain: None,
            fetched_at: "2026-10-01T00:00:00+00:00".into(),
        };
        let (d, id) = db_with_cached(&stored);
        let p = get_lyrics(&d, id, false, ts("2026-10-24T12:00:00+00:00"))
            .await
            .unwrap();
        assert_eq!(p.status, SYNCED);
        assert_eq!(p.lines.len(), 2);
        assert_eq!(p.lines[0].ms, 1000);
        assert!(p.plain.is_none());
    }

    #[tokio::test]
    async fn unknown_track_is_an_error() {
        let d = Database::open_in_memory().unwrap();
        let r = get_lyrics(&d, 42, false, ts("2026-10-24T12:00:00+00:00")).await;
        assert!(matches!(r, Err(LyricsError::NoTrack)));
    }

    #[test]
    fn corrupt_synced_row_degrades_to_not_found() {
        let s = StoredLyrics {
            status: SYNCED.into(),
            synced: Some("nothing parseable".into()),
            plain: None,
            fetched_at: "2026-10-01T00:00:00+00:00".into(),
        };
        assert_eq!(to_payload(1, &s).status, NOT_FOUND);
    }
}