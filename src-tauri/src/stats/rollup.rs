//! Monthly close: freezes the summary of every finished month (H9).

use chrono::{DateTime, Local, Utc};
use rusqlite::Connection;

use crate::db::stats::{self as history, month_key_of};
use crate::error::AppResult;

/// How many artists and tracks a stored summary keeps. The yearly Wrapped (H12) adds the
/// twelve summaries up, so keeping more than the top 5 avoids losing anyone near the top.
pub const KEEP: usize = 50;

/// Computes and stores the summary of one month. `false` if it was already closed.
pub fn close_month(
    conn: &Connection,
    month_key: &str,
    closed_at: DateTime<Utc>,
) -> AppResult<bool> {
    let seconds = history::month_seconds(conn, month_key)?;
    let artists = history::top_artists(conn, month_key, KEEP)?;
    let tracks = history::top_tracks(conn, month_key, KEEP)?;
    history::insert_closed(
        conn,
        month_key,
        history::to_minutes(seconds),
        &artists,
        &tracks,
        closed_at,
    )
}

/// Closes every month before the current one that has listening time and no summary
/// yet (this also covers an app that stayed closed for several months).
/// Safe to run on every start: closed months are never touched again.
/// Returns the month keys closed now, oldest first.
pub fn close_pending_months(conn: &Connection, now: DateTime<Local>) -> AppResult<Vec<String>> {
    let current = month_key_of(now);
    let mut closed = Vec::new();
    for key in history::unclosed_months_before(conn, &current)? {
        if close_month(conn, &key, now.with_timezone(&Utc))? {
            closed.push(key);
        }
    }
    Ok(closed)
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

    fn closed_count(conn: &Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM monthly_stats", [], |r| r.get(0))
            .expect("count")
    }

    #[test]
    fn closes_every_finished_month_once() {
        let d = db();
        let conn = d.conn().expect("conn");
        let t = track(&conn, "T", "A");
        listen(&conn, t, at(2026, 7, 3, 12, 0), 150);
        listen(&conn, t, at(2026, 8, 9, 12, 0), 90);
        listen(&conn, t, at(2026, 10, 20, 12, 0), 600); // current month: stays open
        listen(&conn, t, at(2026, 6, 1, 12, 0), 0); // nothing really listened
        // September has no plays at all.

        let now = at(2026, 10, 24, 12, 0);
        assert_eq!(
            close_pending_months(&conn, now).expect("close"),
            ["2026-07", "2026-08"]
        );
        assert_eq!(closed_count(&conn), 2);

        // Running it again changes nothing.
        assert!(close_pending_months(&conn, now).expect("again").is_empty());
        assert_eq!(closed_count(&conn), 2);

        let july = history::get_closed(&conn, "2026-07")
            .expect("read")
            .expect("closed");
        let august = history::get_closed(&conn, "2026-08")
            .expect("read")
            .expect("closed");
        assert_eq!((july.minutes, august.minutes), (3, 2));
        assert!(
            history::get_closed(&conn, "2026-10")
                .expect("read")
                .is_none()
        );
        assert!(
            history::get_closed(&conn, "2026-09")
                .expect("read")
                .is_none()
        );
    }

    #[test]
    fn a_month_closes_only_after_the_month_changes() {
        let d = db();
        let conn = d.conn().expect("conn");
        let t = track(&conn, "T", "A");
        listen(&conn, t, at(2026, 10, 15, 12, 0), 120);

        let last_minute = at(2026, 10, 31, 23, 59);
        assert!(
            close_pending_months(&conn, last_minute)
                .expect("oct")
                .is_empty()
        );

        let next_month = at(2026, 11, 1, 0, 5);
        assert_eq!(
            close_pending_months(&conn, next_month).expect("nov"),
            ["2026-10"]
        );
    }

    #[test]
    fn the_summary_survives_deleting_the_track() {
        let d = db();
        let conn = d.conn().expect("conn");
        let a = track(&conn, "Song A", "Car, the garden");
        let b = track(&conn, "Song B", "Kiri");
        listen(&conn, a, at(2026, 7, 3, 12, 0), 200);
        listen(&conn, b, at(2026, 7, 4, 12, 0), 100);
        close_pending_months(&conn, at(2026, 10, 24, 12, 0)).expect("close");

        tracks::delete(&conn, a).expect("delete"); // its plays go with it (D-109)

        let july = history::get_closed(&conn, "2026-07")
            .expect("read")
            .expect("closed");
        assert_eq!(july.minutes, 5);
        assert_eq!(july.top_tracks[0].title, "Song A");
        assert_eq!(july.top_artists[0].artist, "Car, the garden");
        assert_eq!(july.top_tracks.len(), 2);
    }

    #[test]
    fn a_late_play_does_not_change_a_closed_month() {
        let d = db();
        let conn = d.conn().expect("conn");
        let t = track(&conn, "T", "A");
        listen(&conn, t, at(2026, 7, 3, 12, 0), 150);
        let now = at(2026, 10, 24, 12, 0);
        close_pending_months(&conn, now).expect("close");

        // e.g. the user moved the system clock back and listened again.
        listen(&conn, t, at(2026, 7, 20, 12, 0), 600);
        assert!(close_pending_months(&conn, now).expect("again").is_empty());

        let july = history::get_closed(&conn, "2026-07")
            .expect("read")
            .expect("closed");
        assert_eq!(july.minutes, 3);
    }
}
