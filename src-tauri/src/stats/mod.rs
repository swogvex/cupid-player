//! Listening statistics (H9).

pub mod rollup;

use rusqlite::Connection;
use serde::Serialize;

use crate::db::stats::{self as history, ArtistStat, TrackStat};
use crate::error::{AppError, AppResult};

/// What the Stats screen shows for one month.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthStats {
    pub month_key: String,
    pub minutes: i64,
    pub top_artists: Vec<ArtistStat>,
    pub top_tracks: Vec<TrackStat>,
    /// `true` when the numbers come from the frozen monthly summary.
    pub closed: bool,
}

/// A closed month is read from its frozen summary; any other month is computed from `plays`.
/// `limit` is how many artists / tracks to return. Rejects a malformed key with the stable
/// code `stats.bad_month`.
pub fn month_stats(conn: &Connection, month_key: &str, limit: usize) -> AppResult<MonthStats> {
    if !history::is_valid_month_key(month_key) {
        return Err(AppError::Msg("stats.bad_month".into()));
    }
    if let Some(mut closed) = history::get_closed(conn, month_key)? {
        closed.top_artists.truncate(limit);
        closed.top_tracks.truncate(limit);
        return Ok(MonthStats {
            month_key: month_key.to_string(),
            minutes: closed.minutes,
            top_artists: closed.top_artists,
            top_tracks: closed.top_tracks,
            closed: true,
        });
    }
    Ok(MonthStats {
        month_key: month_key.to_string(),
        minutes: history::to_minutes(history::month_seconds(conn, month_key)?),
        top_artists: history::top_artists(conn, month_key, limit)?,
        top_tracks: history::top_tracks(conn, month_key, limit)?,
        closed: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{
        Database,
        stats::test_support::{at, listen, track},
        tracks,
    };

    fn db() -> Database {
        Database::open_in_memory().expect("open in-memory db")
    }

    #[test]
    fn open_month_is_live_and_closed_month_is_frozen() {
        let d = db();
        let conn = d.conn().expect("conn");
        let t = track(&conn, "T", "A");
        listen(&conn, t, at(2026, 9, 5, 12, 0), 120);

        let live = month_stats(&conn, "2026-09", 10).expect("live");
        assert!(!live.closed);
        assert_eq!(live.minutes, 2);
        assert_eq!(live.top_tracks.len(), 1);

        rollup::close_pending_months(&conn, at(2026, 10, 1, 9, 0)).expect("close");
        tracks::delete(&conn, t).expect("delete");

        let frozen = month_stats(&conn, "2026-09", 10).expect("frozen");
        assert!(frozen.closed);
        assert_eq!(frozen.minutes, 2);
        assert_eq!(frozen.top_tracks[0].title, "T");
    }

    #[test]
    fn limit_truncates_and_bad_keys_are_rejected() {
        let d = db();
        let conn = d.conn().expect("conn");
        for (i, artist) in ["A", "B", "C"].iter().enumerate() {
            let t = track(&conn, &format!("Song {artist}"), artist);
            listen(&conn, t, at(2026, 9, 5, 12, 0), 100 + i as i64);
        }
        let s = month_stats(&conn, "2026-09", 2).expect("stats");
        assert_eq!((s.top_artists.len(), s.top_tracks.len()), (2, 2));

        for bad in ["2026-13", "nope", "2026-09'; DROP TABLE plays;--"] {
            let err = month_stats(&conn, bad, 5).expect_err("bad key");
            assert_eq!(err.to_string(), "stats.bad_month");
        }
    }
}
