//! Builds yt-dlp search queries and parses its JSON-lines output.
//! Everything except `search_candidates` is pure and unit-tested.

use std::time::Duration;

use serde::Deserialize;
use tauri::AppHandle;

use super::{RunError, run_ytdlp};
use crate::spotify::model::TrackMeta;

const SEARCH_RESULTS: usize = 5;
/// Description prefix of YouTube's auto-generated "Art Track" uploads, which come
/// straight from the label (seen on real results; yt-dlp requests English).
const AUTO_GENERATED_MARKER: &str = "Provided to YouTube by";
const MAX_QUERY_LEN: usize = 200;
const SEARCH_TIMEOUT: Duration = Duration::from_secs(40);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QueryVariant {
    /// "<artist> - <title> audio" (first attempt).
    Audio,
    /// "<artist> <title>" (retry, as in 03-ARQUITECTURA).
    Plain,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Candidate {
    pub video_id: String,
    pub title: String,
    pub channel: String,
    pub duration_secs: Option<u32>,
    pub is_live: bool,
    /// Label-provided upload ("Provided to YouTube by ..."): an official source.
    pub auto_generated: bool,
}

impl Candidate {
    /// Always rebuilt from the validated id; the URL inside yt-dlp's JSON is never used.
    pub fn url(&self) -> String {
        format!("https://www.youtube.com/watch?v={}", self.video_id)
    }
}

/// YouTube video ids are 11 characters: letters, digits, '-' and '_'.
pub fn is_valid_video_id(s: &str) -> bool {
    s.len() == 11
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

#[derive(Deserialize)]
struct RawCandidate {
    id: Option<String>,
    title: Option<String>,
    channel: Option<String>,
    uploader: Option<String>,
    description: Option<String>,
    duration: Option<f64>,
    live_status: Option<String>,
}

fn tidy(s: &str) -> String {
    s.chars()
        .filter(|c| !c.is_control())
        .collect::<String>()
        .trim()
        .to_string()
}

/// Parses `--dump-json --flat-playlist` output (one JSON object per line).
/// Lines that are not valid candidates are skipped.
pub fn parse_search_output(stdout: &str) -> Vec<Candidate> {
    stdout
        .trim_start_matches('\u{feff}')
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() {
                return None;
            }
            let raw: RawCandidate = serde_json::from_str(line).ok()?;
            let video_id = raw.id.filter(|id| is_valid_video_id(id))?;
            let title = tidy(&raw.title?);
            if title.is_empty() {
                return None;
            }
            let channel = tidy(&raw.channel.or(raw.uploader).unwrap_or_default());
            let duration_secs = raw
                .duration
                .filter(|d| d.is_finite() && *d >= 0.0)
                .map(|d| d.round() as u32);
            let is_live = matches!(
                raw.live_status.as_deref(),
                Some("is_live" | "is_upcoming" | "post_live")
            );
            let auto_generated = raw
                .description
                .as_deref()
                .is_some_and(|d| d.contains(AUTO_GENERATED_MARKER));
            Some(Candidate {
                video_id,
                title,
                channel,
                duration_secs,
                is_live,
                auto_generated,
            })
        })
        .collect()
}

pub fn build_query(track: &TrackMeta, variant: QueryVariant) -> String {
    let base = match (variant, track.artist.is_empty()) {
        (QueryVariant::Audio, false) => format!("{} - {} audio", track.artist, track.title),
        (QueryVariant::Audio, true) => format!("{} audio", track.title),
        (QueryVariant::Plain, false) => format!("{} {}", track.artist, track.title),
        (QueryVariant::Plain, true) => track.title.clone(),
    };
    let flat: String = base
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    let joined = flat.split_whitespace().collect::<Vec<_>>().join(" ");
    let capped: String = joined.chars().take(MAX_QUERY_LEN).collect();
    capped.trim_end().to_string()
}

/// Arguments for the search. The user-derived text is ONE argument that always
/// starts with "ytsearchN:", so it can never be read as an option.
pub fn search_args(query: &str) -> Vec<String> {
    vec![
        "--ignore-config".into(),
        "--no-warnings".into(),
        "--dump-json".into(),
        "--flat-playlist".into(),
        "--socket-timeout".into(),
        "15".into(),
        "--".into(),
        format!("ytsearch{SEARCH_RESULTS}:{query}"),
    ]
}

pub async fn search_candidates(
    app: &AppHandle,
    track: &TrackMeta,
    variant: QueryVariant,
) -> Result<Vec<Candidate>, RunError> {
    let args = search_args(&build_query(track, variant));
    let out = run_ytdlp(app, &args, SEARCH_TIMEOUT).await?;
    Ok(parse_search_output(&out.stdout))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = include_str!("../../tests/fixtures/ytsearch_sample.jsonl");

    // A real line from yt-dlp 2026.08.19 (trimmed).
    const REAL_LINE: &str = r#"{"_type": "url", "ie_key": "Youtube", "id": "A2VpR8HahKc", "url": "https://www.youtube.com/watch?v=A2VpR8HahKc", "title": "Daft Punk - One More Time (Official Audio)", "description": "Listen, order & watch now", "duration": 321, "channel_id": "UC_kRDKYrUlrbtrSiyu5Tflg", "channel": "Daft Punk", "uploader": "Daft Punk", "uploader_id": null, "uploader_url": null, "view_count": 38217309, "live_status": null, "channel_is_verified": true, "extractor": "youtube", "playlist_index": 1}"#;

    fn t(title: &str, artist: &str) -> TrackMeta {
        TrackMeta {
            spotify_id: "id".into(),
            title: title.into(),
            artist: artist.into(),
            duration_ms: 1000,
        }
    }

    #[test]
    fn builds_query_variants() {
        let tr = t("Scars leave beautiful trace", "Car, the garden");
        assert_eq!(
            build_query(&tr, QueryVariant::Audio),
            "Car, the garden - Scars leave beautiful trace audio"
        );
        assert_eq!(
            build_query(&tr, QueryVariant::Plain),
            "Car, the garden Scars leave beautiful trace"
        );
    }

    #[test]
    fn query_is_sanitized_and_capped() {
        assert_eq!(
            build_query(&t("A\nB\t C", "X"), QueryVariant::Audio),
            "X - A B C audio"
        );
        assert_eq!(
            build_query(&t("Title", ""), QueryVariant::Audio),
            "Title audio"
        );
        assert_eq!(build_query(&t("Title", ""), QueryVariant::Plain), "Title");
        let long = build_query(&t(&"a".repeat(500), "X"), QueryVariant::Audio);
        assert!(long.chars().count() <= MAX_QUERY_LEN);
    }

    #[test]
    fn search_args_never_expose_user_text_as_option() {
        let tr = t("T", "--exec=calc");
        let args = search_args(&build_query(&tr, QueryVariant::Audio));
        let n = args.len();
        assert!(args[n - 1].starts_with("ytsearch5:"));
        assert_eq!(args[n - 2], "--");
        assert!(
            args[..n - 2]
                .iter()
                .all(|a| (a.starts_with("--") || a == "15") && !a.contains("calc"))
        );
    }

    #[test]
    fn parses_real_flat_playlist_line() {
        let c = parse_search_output(REAL_LINE);
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].video_id, "A2VpR8HahKc");
        assert_eq!(c[0].title, "Daft Punk - One More Time (Official Audio)");
        assert_eq!(c[0].channel, "Daft Punk");
        assert_eq!(c[0].duration_secs, Some(321));
        assert!(!c[0].is_live);
        assert!(!c[0].auto_generated);
        assert_eq!(c[0].url(), "https://www.youtube.com/watch?v=A2VpR8HahKc");
    }

    #[test]
    fn parse_skips_bad_lines_and_rebuilds_url() {
        let input = format!(
            "\u{feff}\r\n{REAL_LINE}\r\n\r\nnot json\r\n{}\r\n{}\r\n{}\r\n",
            r#"{"id":"short","title":"Bad id"}"#,
            r#"{"id":"A2VpR8HahKc","title":"  "}"#,
            r#"{"id":"abcdefghijk","title":"Evil url","url":"https://evil.com/x","channel":"c","duration":10.6}"#,
        );
        let c = parse_search_output(&input);
        assert_eq!(c.len(), 2);
        assert_eq!(c[1].url(), "https://www.youtube.com/watch?v=abcdefghijk");
        assert_eq!(c[1].duration_secs, Some(11));
    }

    #[test]
    fn parse_handles_live_status_and_durations() {
        let input = [
            r#"{"id":"aaaaaaaaaaa","title":"L","live_status":"is_live"}"#,
            r#"{"id":"bbbbbbbbbbb","title":"U","live_status":"is_upcoming"}"#,
            r#"{"id":"ccccccccccc","title":"N","live_status":"not_live","duration":null}"#,
            r#"{"id":"ddddddddddd","title":"Up","uploader":"Uploader"}"#,
        ]
        .join("\n");
        let c = parse_search_output(&input);
        assert_eq!(c.len(), 4);
        assert!(c[0].is_live && c[1].is_live && !c[2].is_live && !c[3].is_live);
        assert!(c.iter().all(|x| x.duration_secs.is_none()));
        assert_eq!(c[3].channel, "Uploader");
    }

    #[test]
    fn parses_sample_fixture() {
        let c = parse_search_output(SAMPLE);
        assert!(!c.is_empty() && c.len() <= SEARCH_RESULTS);
        assert!(
            c.iter()
                .all(|x| is_valid_video_id(&x.video_id) && !x.title.is_empty())
        );
    }

    #[test]
    fn detects_auto_generated_uploads() {
        let line = r#"{"id":"dGoHLoDmHdI","title":"Scars leave beautiful trace","description":"Provided to YouTube by Genie Music Corporation Scars leave beautiful trace","duration":214}"#;
        let c = parse_search_output(line);
        assert_eq!(c.len(), 1);
        assert!(c[0].auto_generated);
    }
}
