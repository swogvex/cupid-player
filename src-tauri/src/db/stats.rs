//! Listening history (H9). One `plays` row per listening session.
//!
//! The frontend counts real listening time (clock time while the audio is playing).
//! It creates the row with `start_play` once a track has been heard for a few seconds
//! and then raises `seconds_listened` with `update_play` (checkpoints and final flush).

use chrono::{DateTime, Local, SecondsFormat, Utc};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::error::AppResult;

/// Upper bound for one session (12 h): a bug or a clock jump must not poison the stats.
pub const MAX_PLAY_SECONDS: i64 = 12 * 3600;

// The two structs below are also stored as JSON inside `monthly_stats`:
// renaming a field would break old summaries.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtistStat {
    pub artist: String,
    pub seconds: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackStat {
    pub title: String,
    pub artist: String,
    pub seconds: i64,
    /// Listening sessions of this track in the month.
    pub plays: i64,
}

/// A frozen monthly summary read back from `monthly_stats`.
#[derive(Debug, Clone)]
pub struct ClosedMonth {
    pub minutes: i64,
    pub top_artists: Vec<ArtistStat>,
    pub top_tracks: Vec<TrackStat>,
}

/// `YYYY-MM` in local time.
pub fn month_key_of(at: DateTime<Local>) -> String {
    at.format("%Y-%m").to_string()
}

/// Strict shape check for a month key coming from the frontend.
pub fn is_valid_month_key(key: &str) -> bool {
    let b = key.as_bytes();
    if b.len() != 7 || b[4] != b'-' {
        return false;
    }
    if !b[..4].iter().all(u8::is_ascii_digit) || !b[5..].iter().all(u8::is_ascii_digit) {
        return false;
    }
    // Everything is ASCII here, so slicing at byte 5 is safe.
    let month: u8 = key[5..].parse().unwrap_or(0);
    (1..=12).contains(&month)
}

/// Seconds rounded to the nearest minute.
pub fn to_minutes(seconds: i64) -> i64 {
    (seconds + 30) / 60
}

/// Creates the row for a new listening session (0 seconds so far). Returns its id.
/// Fails if the track does not exist (foreign key).
pub fn start_play(conn: &Connection, track_id: i64, now: DateTime<Local>) -> AppResult<i64> {
    conn.execute(
        "INSERT INTO plays (track_id, started_at, month_key, seconds_listened) \
         VALUES (?1, ?2, ?3, 0)",
        params![
            track_id,
            now.with_timezone(&Utc)
                .to_rfc3339_opts(SecondsFormat::Secs, true),
            month_key_of(now),
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Raises the seconds of a session. Never lowers them, and caps them at
/// `MAX_PLAY_SECONDS`. Returns `false` if the session does not exist.
pub fn update_play(conn: &Connection, play_id: i64, seconds: i64) -> AppResult<bool> {
    let secs = seconds.clamp(0, MAX_PLAY_SECONDS);
    let changed = conn.execute(
        "UPDATE plays SET seconds_listened = MAX(seconds_listened, ?1) WHERE id = ?2",
        params![secs, play_id],
    )?;
    Ok(changed > 0)
}

pub fn month_seconds(conn: &Connection, month_key: &str) -> AppResult<i64> {
    Ok(conn.query_row(
        "SELECT COALESCE(SUM(seconds_listened), 0) FROM plays WHERE month_key = ?1",
        [month_key],
        |r| r.get(0),
    )?)
}

/// Artists by total listening time. The artist text is compared whole (D-78).
pub fn top_artists(conn: &Connection, month_key: &str, limit: usize) -> AppResult<Vec<ArtistStat>> {
    let mut stmt = conn.prepare(
        "SELECT t.artist, SUM(p.seconds_listened) AS secs \
         FROM plays p JOIN tracks t ON t.id = p.track_id \
         WHERE p.month_key = ?1 AND p.seconds_listened > 0 \
         GROUP BY t.artist \
         ORDER BY secs DESC, t.artist ASC \
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![month_key, limit as i64], |r| {
        Ok(ArtistStat {
            artist: r.get(0)?,
            seconds: r.get(1)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// Tracks by total listening time.
pub fn top_tracks(conn: &Connection, month_key: &str, limit: usize) -> AppResult<Vec<TrackStat>> {
    let mut stmt = conn.prepare(
        "SELECT t.title, t.artist, SUM(p.seconds_listened) AS secs, COUNT(*) AS plays \
         FROM plays p JOIN tracks t ON t.id = p.track_id \
         WHERE p.month_key = ?1 AND p.seconds_listened > 0 \
         GROUP BY p.track_id, t.title, t.artist \
         ORDER BY secs DESC, plays DESC, t.title ASC, t.artist ASC \
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![month_key, limit as i64], |r| {
        Ok(TrackStat {
            title: r.get(0)?,
            artist: r.get(1)?,
            seconds: r.get(2)?,
            plays: r.get(3)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// Months before `before` that have listening time but no stored summary, oldest first.
pub fn unclosed_months_before(conn: &Connection, before: &str) -> AppResult<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT month_key FROM plays \
         WHERE month_key < ?1 AND seconds_listened > 0 \
           AND month_key NOT IN (SELECT month_key FROM monthly_stats) \
         ORDER BY month_key",
    )?;
    let rows = stmt.query_map([before], |r| r.get::<_, String>(0))?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// Stores a summary. Returns `false` (and changes nothing) if the month was already closed.
pub fn insert_closed(
    conn: &Connection,
    month_key: &str,
    minutes: i64,
    artists: &[ArtistStat],
    tracks: &[TrackStat],
    closed_at: DateTime<Utc>,
) -> AppResult<bool> {
    let changed = conn.execute(
        "INSERT OR IGNORE INTO monthly_stats (month_key, minutes, top_artists, top_tracks, closed_at) \
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            month_key,
            minutes,
            serde_json::to_string(artists)?,
            serde_json::to_string(tracks)?,
            closed_at.to_rfc3339_opts(SecondsFormat::Secs, true),
        ],
    )?;
    Ok(changed > 0)
}

pub fn get_closed(conn: &Connection, month_key: &str) -> AppResult<Option<ClosedMonth>> {
    let row = conn
        .query_row(
            "SELECT minutes, top_artists, top_tracks FROM monthly_stats WHERE month_key = ?1",
            [month_key],
            |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            },
        )
        .optional()?;
    row.map(|(minutes, artists, tracks)| -> AppResult<ClosedMonth> {
        Ok(ClosedMonth {
            minutes,
            top_artists: serde_json::from_str(&artists)?,
            top_tracks: serde_json::from_str(&tracks)?,
        })
    })
    .transpose()
}

/// Months that have listening time (still open or already closed), newest first.
pub fn list_months(conn: &Connection) -> AppResult<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT month_key FROM plays WHERE seconds_listened > 0 \
         UNION \
         SELECT month_key FROM monthly_stats \
         ORDER BY month_key DESC",
    )?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// Helpers shared by the tests of `db::stats`, `stats::rollup` and `stats`.
#[cfg(test)]
pub mod test_support {
    use chrono::{DateTime, Local, TimeZone};
    use rusqlite::Connection;

    use super::{start_play, update_play};
    use crate::db::tracks::{self, NewTrack};

    /// A local date-time (seconds = 0).
    pub fn at(y: i32, m: u32, d: u32, h: u32, min: u32) -> DateTime<Local> {
        Local
            .with_ymd_and_hms(y, m, d, h, min, 0)
            .single()
            .expect("valid local time")
    }

    pub fn track(conn: &Connection, title: &str, artist: &str) -> i64 {
        tracks::insert(conn, &NewTrack::basic(title, artist, 200_000)).expect("insert track")
    }

    /// One finished listening session of `seconds` seconds.
    pub fn listen(conn: &Connection, track_id: i64, when: DateTime<Local>, seconds: i64) -> i64 {
        let id = start_play(conn, track_id, when).expect("start play");
        update_play(conn, id, seconds).expect("update play");
        id
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::{at, listen, track};
    use super::*;
    use crate::db::{Database, tracks};

    fn db() -> Database {
        Database::open_in_memory().expect("open in-memory db")
    }

    fn seconds_of(conn: &Connection, play_id: i64) -> i64 {
        conn.query_row(
            "SELECT seconds_listened FROM plays WHERE id = ?1",
            [play_id],
            |r| r.get(0),
        )
        .expect("play row")
    }

    #[test]
    fn month_key_is_local_and_started_at_is_utc() {
        let d = db();
        let conn = d.conn().expect("conn");
        let t = track(&conn, "T", "A");
        let late = start_play(&conn, t, at(2026, 8, 31, 23, 50)).expect("start");
        let early = start_play(&conn, t, at(2026, 9, 1, 0, 10)).expect("start");
        let row = |id: i64| -> (String, String) {
            conn.query_row(
                "SELECT month_key, started_at FROM plays WHERE id = ?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .expect("row")
        };
        let (key_late, started) = row(late);
        assert_eq!(key_late, "2026-08");
        assert!(started.ends_with('Z'));
        assert_eq!(row(early).0, "2026-09");
    }

    #[test]
    fn update_play_only_grows_and_is_capped() {
        let d = db();
        let conn = d.conn().expect("conn");
        let t = track(&conn, "T", "A");
        let id = start_play(&conn, t, at(2026, 9, 10, 12, 0)).expect("start");
        assert_eq!(seconds_of(&conn, id), 0);

        assert!(update_play(&conn, id, 30).expect("update"));
        assert_eq!(seconds_of(&conn, id), 30);
        update_play(&conn, id, 10).expect("lower value");
        assert_eq!(seconds_of(&conn, id), 30); // never goes down
        update_play(&conn, id, -5).expect("negative value");
        assert_eq!(seconds_of(&conn, id), 30);
        update_play(&conn, id, 1_000_000_000).expect("huge value");
        assert_eq!(seconds_of(&conn, id), MAX_PLAY_SECONDS);

        assert!(!update_play(&conn, 9999, 5).expect("unknown session"));
    }

    #[test]
    fn start_play_rejects_an_unknown_track() {
        let d = db();
        let conn = d.conn().expect("conn");
        assert!(start_play(&conn, 9999, at(2026, 9, 10, 12, 0)).is_err());
    }

    #[test]
    fn month_totals_and_rankings() {
        let d = db();
        let conn = d.conn().expect("conn");
        let a1 = track(&conn, "Song A", "Car, the garden");
        let a2 = track(&conn, "Song B", "Car, the garden");
        let b = track(&conn, "Song C", "Kiri");
        let z = track(&conn, "Never", "Zed");
        listen(&conn, a1, at(2026, 9, 2, 12, 0), 120);
        listen(&conn, a1, at(2026, 9, 3, 12, 0), 60);
        listen(&conn, a2, at(2026, 9, 4, 12, 0), 100);
        listen(&conn, b, at(2026, 9, 5, 12, 0), 250);
        listen(&conn, z, at(2026, 9, 6, 12, 0), 0); // a session with no listened time
        listen(&conn, b, at(2026, 8, 30, 12, 0), 999); // another month

        assert_eq!(month_seconds(&conn, "2026-09").expect("sum"), 530);

        let artists = top_artists(&conn, "2026-09", 10).expect("artists");
        assert_eq!(
            artists,
            vec![
                ArtistStat {
                    artist: "Car, the garden".into(), // never split on commas (D-78)
                    seconds: 280
                },
                ArtistStat {
                    artist: "Kiri".into(),
                    seconds: 250
                },
            ]
        );

        let ranking = top_tracks(&conn, "2026-09", 10).expect("tracks");
        let summary: Vec<(&str, i64, i64)> = ranking
            .iter()
            .map(|t| (t.title.as_str(), t.seconds, t.plays))
            .collect();
        assert_eq!(
            summary,
            [("Song C", 250, 1), ("Song A", 180, 2), ("Song B", 100, 1)]
        );
        assert_eq!(top_tracks(&conn, "2026-09", 2).expect("limit").len(), 2);

        assert_eq!(month_seconds(&conn, "2026-07").expect("empty month"), 0);
        assert!(top_artists(&conn, "2026-07", 10).expect("empty").is_empty());
        assert!(top_tracks(&conn, "2026-07", 10).expect("empty").is_empty());
    }

    #[test]
    fn deleting_a_track_removes_its_history() {
        let d = db();
        let conn = d.conn().expect("conn");
        let t = track(&conn, "T", "A");
        listen(&conn, t, at(2026, 9, 2, 12, 0), 100);
        assert_eq!(month_seconds(&conn, "2026-09").expect("sum"), 100);
        tracks::delete(&conn, t).expect("delete");
        assert_eq!(month_seconds(&conn, "2026-09").expect("sum"), 0);
    }

    #[test]
    fn month_key_validation() {
        for ok in ["2026-09", "1999-12", "2030-01"] {
            assert!(is_valid_month_key(ok), "{ok} should be valid");
        }
        for bad in [
            "",
            "2026-9",
            "2026-13",
            "2026-00",
            "26-09",
            "2026/09",
            "abcd-ef",
            "2026-09-01",
            "2026-1a",
            "２０２６-０９",
            "2026-09'; --",
        ] {
            assert!(!is_valid_month_key(bad), "{bad:?} should be invalid");
        }
    }

    #[test]
    fn minutes_round_to_the_nearest_minute() {
        assert_eq!(to_minutes(0), 0);
        assert_eq!(to_minutes(29), 0);
        assert_eq!(to_minutes(30), 1);
        assert_eq!(to_minutes(90), 2);
        assert_eq!(to_minutes(3600), 60);
    }

    #[test]
    fn lists_months_with_listening_newest_first() {
        let d = db();
        let conn = d.conn().expect("conn");
        assert!(list_months(&conn).expect("empty").is_empty());

        let t = track(&conn, "T", "A");
        listen(&conn, t, at(2026, 8, 5, 12, 0), 100);
        listen(&conn, t, at(2026, 8, 6, 12, 0), 100); // same month twice
        listen(&conn, t, at(2026, 9, 5, 12, 0), 50);
        listen(&conn, t, at(2026, 7, 5, 12, 0), 0); // nothing heard: not listed
        // A closed month whose plays no longer exist still counts.
        insert_closed(&conn, "2026-05", 10, &[], &[], Utc::now()).expect("closed");

        assert_eq!(
            list_months(&conn).expect("months"),
            ["2026-09", "2026-08", "2026-05"]
        );
    }
}
