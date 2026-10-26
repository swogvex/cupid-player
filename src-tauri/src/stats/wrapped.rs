//! Yearly Wrapped (H12): adds up the monthly summaries of one year.
//!
//! `month_stats` already reads a closed month from its frozen summary and computes the open
//! month live, so the Wrapped uses exactly the numbers the Stats screen shows.
//!
//! Known limits (accepted):
//! - Each stored month keeps its top `rollup::KEEP` (50) artists and tracks, so an item that
//!   falls outside the top 50 of several months adds up to a little less than its real total.
//!   It cannot reach the top 5 that way unless the year is very flat.
//! - Minutes are rounded per month, so the total can differ from the exact sum by up to
//!   half a minute per month.
//! - Tracks are merged by `(title, artist)`: stored summaries carry no track id.

use std::collections::HashMap;

use rusqlite::Connection;
use serde::Serialize;

use super::{MonthStats, month_stats, rollup};
use crate::db::stats::{self as history, ArtistStat, TrackStat};
use crate::error::{AppError, AppResult};

/// How many artists and tracks the Wrapped keeps.
pub const TOP: usize = 5;

/// Minutes listened in one month of the year.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthTotal {
    /// `YYYY-MM`, local time.
    pub month_key: String,
    pub minutes: i64,
}

/// What the Wrapped screens show for one year.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Wrapped {
    pub year: i32,
    pub minutes: i64,
    /// Months with listening time, oldest first. Empty = no Wrapped for this year.
    pub months: Vec<MonthTotal>,
    /// The month with most minutes (the earliest one on a tie).
    pub top_month: Option<MonthTotal>,
    pub top_artists: Vec<ArtistStat>,
    pub top_tracks: Vec<TrackStat>,
}

/// Wrapped of `year` (local time). Rejects an absurd year with `stats.bad_year`.
pub fn wrapped(conn: &Connection, year: i32) -> AppResult<Wrapped> {
    if !(1970..=9999).contains(&year) {
        return Err(AppError::Msg("stats.bad_year".into()));
    }
    let prefix = format!("{year:04}-");
    // `list_months` is newest first; the Wrapped wants oldest first.
    let mut keys: Vec<String> = history::list_months(conn)?
        .into_iter()
        .filter(|k| k.starts_with(&prefix))
        .collect();
    keys.reverse();

    let mut months = Vec::with_capacity(keys.len());
    for key in &keys {
        months.push(month_stats(conn, key, rollup::KEEP)?);
    }
    Ok(build(year, &months))
}

/// Pure merge of the months (oldest first). Months without listening are ignored.
fn build(year: i32, months: &[MonthStats]) -> Wrapped {
    let mut totals: Vec<MonthTotal> = Vec::new();
    let mut artists: HashMap<&str, i64> = HashMap::new();
    let mut tracks: HashMap<(&str, &str), (i64, i64)> = HashMap::new();

    for m in months {
        if m.minutes == 0 && m.top_tracks.is_empty() {
            continue;
        }
        totals.push(MonthTotal {
            month_key: m.month_key.clone(),
            minutes: m.minutes,
        });
        for a in &m.top_artists {
            *artists.entry(a.artist.as_str()).or_insert(0) += a.seconds;
        }
        for t in &m.top_tracks {
            let entry = tracks
                .entry((t.title.as_str(), t.artist.as_str()))
                .or_insert((0, 0));
            entry.0 += t.seconds;
            entry.1 += t.plays;
        }
    }

    let mut top_artists: Vec<ArtistStat> = artists
        .into_iter()
        .map(|(artist, seconds)| ArtistStat {
            artist: artist.to_string(),
            seconds,
        })
        .collect();
    top_artists.sort_by(|a, b| {
        b.seconds
            .cmp(&a.seconds)
            .then_with(|| a.artist.cmp(&b.artist))
    });
    top_artists.truncate(TOP);

    let mut top_tracks: Vec<TrackStat> = tracks
        .into_iter()
        .map(|((title, artist), (seconds, plays))| TrackStat {
            title: title.to_string(),
            artist: artist.to_string(),
            seconds,
            plays,
        })
        .collect();
    top_tracks.sort_by(|a, b| {
        b.seconds
            .cmp(&a.seconds)
            .then_with(|| b.plays.cmp(&a.plays))
            .then_with(|| a.title.cmp(&b.title))
            .then_with(|| a.artist.cmp(&b.artist))
    });
    top_tracks.truncate(TOP);

    let minutes = totals.iter().map(|m| m.minutes).sum();
    let mut top_month: Option<MonthTotal> = None;
    for m in &totals {
        if top_month
            .as_ref()
            .is_none_or(|best| m.minutes > best.minutes)
        {
            top_month = Some(m.clone());
        }
    }

    Wrapped {
        year,
        minutes,
        months: totals,
        top_month,
        top_artists,
        top_tracks,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{
        Database,
        stats::test_support::{at, listen, track},
        tracks,
    };
    use crate::stats::rollup;

    fn db() -> Database {
        Database::open_in_memory().expect("open in-memory db")
    }

    fn month(
        key: &str,
        minutes: i64,
        artists: &[(&str, i64)],
        tracks: &[(&str, &str, i64, i64)],
    ) -> MonthStats {
        MonthStats {
            month_key: key.to_string(),
            minutes,
            top_artists: artists
                .iter()
                .map(|(artist, seconds)| ArtistStat {
                    artist: artist.to_string(),
                    seconds: *seconds,
                })
                .collect(),
            top_tracks: tracks
                .iter()
                .map(|(title, artist, seconds, plays)| TrackStat {
                    title: title.to_string(),
                    artist: artist.to_string(),
                    seconds: *seconds,
                    plays: *plays,
                })
                .collect(),
            closed: true,
        }
    }

    fn keys(w: &Wrapped) -> Vec<&str> {
        w.months.iter().map(|m| m.month_key.as_str()).collect()
    }

    #[test]
    fn adds_minutes_and_merges_rankings_across_months() {
        let july = month(
            "2026-07",
            5,
            &[("Car, the garden", 200), ("Kiri", 250)],
            &[
                ("Song A", "Car, the garden", 200, 2),
                ("Song C", "Kiri", 250, 1),
            ],
        );
        let august = month(
            "2026-08",
            2,
            &[("Car, the garden", 100), ("Other", 50)],
            &[
                ("Song A", "Car, the garden", 100, 1),
                ("Song A", "Other", 50, 1), // same title, other artist: not merged
            ],
        );
        let w = build(2026, &[july, august]);

        assert_eq!(w.year, 2026);
        assert_eq!(w.minutes, 7);
        let artists: Vec<(&str, i64)> = w
            .top_artists
            .iter()
            .map(|a| (a.artist.as_str(), a.seconds))
            .collect();
        assert_eq!(
            artists,
            [("Car, the garden", 300), ("Kiri", 250), ("Other", 50)]
        );
        let tracks: Vec<(&str, &str, i64, i64)> = w
            .top_tracks
            .iter()
            .map(|t| (t.title.as_str(), t.artist.as_str(), t.seconds, t.plays))
            .collect();
        assert_eq!(
            tracks,
            [
                ("Song A", "Car, the garden", 300, 3),
                ("Song C", "Kiri", 250, 1),
                ("Song A", "Other", 50, 1),
            ]
        );
    }

    #[test]
    fn keeps_the_top_five_and_picks_the_top_month() {
        let names = ["A", "B", "C", "D", "E", "F", "G"];
        let artists: Vec<(&str, i64)> = names
            .iter()
            .enumerate()
            .map(|(i, n)| (*n, 70 - 10 * i as i64))
            .collect();
        let tracks: Vec<(&str, &str, i64, i64)> = names
            .iter()
            .enumerate()
            .map(|(i, n)| (*n, *n, 70 - 10 * i as i64, 1))
            .collect();
        let w = build(
            2026,
            &[
                month("2026-01", 10, &artists, &tracks),
                month("2026-02", 30, &[], &[]),
                month("2026-03", 30, &[], &[]),
            ],
        );
        assert_eq!(w.top_artists.len(), 5);
        assert_eq!(w.top_tracks.len(), 5);
        assert_eq!(w.top_artists[0].artist, "A");
        assert_eq!(w.top_artists[4].artist, "E");
        assert_eq!(keys(&w), ["2026-01", "2026-02", "2026-03"]);
        // February and March tie: the earlier one wins.
        assert_eq!(w.top_month.expect("top month").month_key, "2026-02");
        assert_eq!(w.minutes, 70);
    }

    #[test]
    fn months_without_listening_are_ignored() {
        let w = build(2026, &[month("2026-01", 0, &[], &[])]);
        assert!(w.months.is_empty());
        assert_eq!(w.minutes, 0);
        assert!(w.top_month.is_none());
        assert!(w.top_artists.is_empty() && w.top_tracks.is_empty());

        // Under one minute of real listening still counts as a month.
        let w = build(
            2026,
            &[month("2026-02", 0, &[("A", 20)], &[("T", "A", 20, 1)])],
        );
        assert_eq!(keys(&w), ["2026-02"]);
        assert_eq!(w.minutes, 0);
        assert_eq!(w.top_artists.len(), 1);
    }

    #[test]
    fn reads_closed_and_open_months_from_the_database() {
        let d = db();
        let conn = d.conn().expect("conn");
        let t = track(&conn, "T", "A");
        listen(&conn, t, at(2025, 12, 20, 12, 0), 120); // another year
        listen(&conn, t, at(2026, 7, 3, 12, 0), 150);
        listen(&conn, t, at(2026, 8, 9, 12, 0), 90);
        listen(&conn, t, at(2026, 10, 20, 12, 0), 600); // current month: stays open
        rollup::close_pending_months(&conn, at(2026, 10, 24, 12, 0)).expect("close");

        let w = wrapped(&conn, 2026).expect("wrapped 2026");
        assert_eq!(keys(&w), ["2026-07", "2026-08", "2026-10"]);
        assert_eq!(w.minutes, 15);
        let top = w.top_month.clone().expect("top month");
        assert_eq!((top.month_key.as_str(), top.minutes), ("2026-10", 10));
        assert_eq!(w.top_tracks[0].seconds, 840);
        assert_eq!(w.top_tracks[0].plays, 3);
        assert_eq!(w.top_artists[0].seconds, 840);

        let last_year = wrapped(&conn, 2025).expect("wrapped 2025");
        assert_eq!((last_year.minutes, last_year.months.len()), (2, 1));
        assert!(wrapped(&conn, 2024).expect("empty").months.is_empty());

        // Closed months survive deleting the track; the open one loses its history (D-109).
        tracks::delete(&conn, t).expect("delete");
        let after = wrapped(&conn, 2026).expect("after delete");
        assert_eq!(keys(&after), ["2026-07", "2026-08"]);
        assert_eq!(after.minutes, 5);
        assert_eq!(after.top_tracks[0].title, "T");
    }

    #[test]
    fn rejects_an_absurd_year() {
        let d = db();
        let conn = d.conn().expect("conn");
        for bad in [-1, 0, 1969, 10_000] {
            let err = wrapped(&conn, bad).expect_err("bad year");
            assert_eq!(err.to_string(), "stats.bad_year");
        }
    }
}
