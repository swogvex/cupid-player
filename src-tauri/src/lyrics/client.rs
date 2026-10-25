//! LRCLIB client (https://lrclib.net): public API, no key, no account.
//! Only Rust talks to it. Strict limits: timeout, body size, no redirects.

use std::time::Duration;

use serde::Deserialize;
use url::Url;

use super::{LyricsError, TrackKey};

const BASE: &str = "https://lrclib.net/api";
const MAX_BODY_BYTES: usize = 512 * 1024;
const TIMEOUT_SECS: u64 = 15;
const RETRY_DELAY_MS: u64 = 1500;
/// Largest length difference (seconds) between our file and an LRCLIB entry that
/// still counts as the same recording (a live version or remix is usually further off).
pub const MAX_SEARCH_DIFF_SECS: f64 = 6.0;
/// A synced entry beats an unsynced one unless the latter is this much closer in length.
const SYNCED_BONUS_SECS: f64 = 2.5;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    #[serde(default)]
    pub instrumental: bool,
    #[serde(default)]
    pub duration: Option<f64>,
    #[serde(default)]
    pub synced_lyrics: Option<String>,
    #[serde(default)]
    pub plain_lyrics: Option<String>,
}

fn non_blank(s: &Option<String>) -> bool {
    s.as_deref().is_some_and(|t| !t.trim().is_empty())
}

impl Found {
    pub fn has_lyrics(&self) -> bool {
        non_blank(&self.synced_lyrics) || non_blank(&self.plain_lyrics)
    }
}

/// Picks the search result that is most likely the same recording.
pub fn pick_best(results: Vec<Found>, duration_secs: Option<f64>) -> Option<Found> {
    let mut best: Option<(f64, Found)> = None;
    for f in results
        .into_iter()
        .filter(|f| f.has_lyrics() || f.instrumental)
    {
        let diff = match (duration_secs, f.duration) {
            (Some(want), Some(have)) => (want - have).abs(),
            (Some(_), None) => continue, // cannot be verified
            (None, _) => 0.0,
        };
        if diff > MAX_SEARCH_DIFF_SECS {
            continue;
        }
        let score = diff
            + if non_blank(&f.synced_lyrics) {
                0.0
            } else {
                SYNCED_BONUS_SECS
            };
        if best.as_ref().is_none_or(|(s, _)| score < *s) {
            best = Some((score, f));
        }
    }
    best.map(|(_, f)| f)
}

fn net_err(e: reqwest::Error) -> LyricsError {
    LyricsError::Unavailable(e.without_url().to_string())
}

fn http() -> Result<reqwest::Client, LyricsError> {
    reqwest::Client::builder()
        .user_agent(concat!(
            "CupidPlayer/",
            env!("CARGO_PKG_VERSION"),
            " (https://github.com/swogvex/cupid-player)"
        ))
        .timeout(Duration::from_secs(TIMEOUT_SECS))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(net_err)
}

fn build_url(path: &str, params: &[(&str, &str)]) -> Result<Url, LyricsError> {
    Url::parse_with_params(&format!("{BASE}/{path}"), params).map_err(|_| LyricsError::BadResponse)
}

/// `Ok(None)` = 404. Temporary failures (429, 5xx) are retried once.
async fn get_bytes(client: &reqwest::Client, url: &Url) -> Result<Option<Vec<u8>>, LyricsError> {
    for attempt in 0..2 {
        let mut resp = client.get(url.as_str()).send().await.map_err(net_err)?;
        let status = resp.status();
        if status.as_u16() == 404 {
            return Ok(None);
        }
        if status.is_success() {
            let mut buf: Vec<u8> = Vec::new();
            while let Some(chunk) = resp.chunk().await.map_err(net_err)? {
                if buf.len() + chunk.len() > MAX_BODY_BYTES {
                    return Err(LyricsError::BadResponse);
                }
                buf.extend_from_slice(&chunk);
            }
            return Ok(Some(buf));
        }
        let transient = status.as_u16() == 429 || status.is_server_error();
        if transient && attempt == 0 {
            tokio::time::sleep(Duration::from_millis(RETRY_DELAY_MS)).await;
            continue;
        }
        return Err(if transient {
            LyricsError::Unavailable(format!("HTTP {}", status.as_u16()))
        } else {
            LyricsError::Status(status.as_u16())
        });
    }
    Err(LyricsError::Unavailable("retries exhausted".into()))
}

/// Looks the track up: exact match by artist + title + album + length first,
/// then a search by artist + title filtered by length.
/// `Ok(None)` means LRCLIB has nothing; `Err` means we could not ask (never cache that).
pub async fn lookup(key: &TrackKey) -> Result<Option<Found>, LyricsError> {
    let client = http()?;

    if let (Some(album), Some(secs)) = (key.album.as_deref(), key.duration_secs) {
        let secs_text = (secs.round() as u32).to_string();
        let url = build_url(
            "get",
            &[
                ("artist_name", key.artist.as_str()),
                ("track_name", key.title.as_str()),
                ("album_name", album),
                ("duration", secs_text.as_str()),
            ],
        )?;
        if let Some(body) = get_bytes(&client, &url).await? {
            let found: Found =
                serde_json::from_slice(&body).map_err(|_| LyricsError::BadResponse)?;
            if found.has_lyrics() || found.instrumental {
                return Ok(Some(found));
            }
        }
    }

    let url = build_url(
        "search",
        &[
            ("artist_name", key.artist.as_str()),
            ("track_name", key.title.as_str()),
        ],
    )?;
    let Some(body) = get_bytes(&client, &url).await? else {
        return Ok(None);
    };
    let results: Vec<Found> =
        serde_json::from_slice(&body).map_err(|_| LyricsError::BadResponse)?;
    Ok(pick_best(results, key.duration_secs))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(duration: Option<f64>, synced: bool, plain: bool) -> Found {
        Found {
            instrumental: false,
            duration,
            synced_lyrics: synced.then(|| "[00:01.00]x".to_string()),
            plain_lyrics: plain.then(|| "x".to_string()),
        }
    }

    #[test]
    fn prefers_the_closest_length() {
        let r = vec![entry(Some(215.0), true, true), entry(Some(212.0), true, true)];
        assert_eq!(pick_best(r, Some(213.0)).unwrap().duration, Some(212.0));
    }

    #[test]
    fn discards_other_recordings() {
        let r = vec![entry(Some(260.0), true, true)];
        assert!(pick_best(r, Some(213.0)).is_none());
    }

    #[test]
    fn prefers_synced_when_lengths_are_similar() {
        let r = vec![entry(Some(213.0), false, true), entry(Some(214.5), true, true)];
        assert!(pick_best(r, Some(213.0)).unwrap().synced_lyrics.is_some());
    }

    #[test]
    fn skips_entries_without_lyrics_or_unverifiable() {
        let r = vec![entry(Some(213.0), false, false), entry(None, true, true)];
        assert!(pick_best(r, Some(213.0)).is_none());
    }

    #[test]
    fn without_our_length_takes_a_synced_entry() {
        let r = vec![entry(Some(100.0), false, true), entry(Some(300.0), true, true)];
        assert!(pick_best(r, None).unwrap().synced_lyrics.is_some());
    }

    #[test]
    fn instrumental_entries_are_usable() {
        let f = Found {
            instrumental: true,
            duration: Some(200.0),
            synced_lyrics: None,
            plain_lyrics: None,
        };
        assert!(pick_best(vec![f], Some(200.0)).is_some());
    }

    #[test]
    fn deserializes_lrclib_shape_with_nulls() {
        let json = r#"[{"id":1,"trackName":"T","duration":213.4,"instrumental":false,
                        "plainLyrics":"x","syncedLyrics":null}]"#;
        let v: Vec<Found> = serde_json::from_str(json).unwrap();
        assert_eq!(v[0].duration, Some(213.4));
        assert!(v[0].synced_lyrics.is_none() && v[0].has_lyrics());
    }
}