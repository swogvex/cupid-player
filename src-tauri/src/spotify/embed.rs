//! Reads public playlist and track metadata from Spotify's embed pages (no API key).
//!
//! This is an undocumented format and may change without notice. Everything that
//! depends on it lives in this file, tested against saved real responses.

use std::time::Duration;

use ::url::Url;
use serde::Deserialize;
use thiserror::Error;

use super::model::{PlaylistMeta, TrackDetail, TrackMeta};
use super::url::{SpotifyKind, SpotifyRef, is_valid_id};

const MAX_HTML_BYTES: usize = 2 * 1024 * 1024;
const MAX_TEXT_LEN: usize = 300;
/// The UI never draws a cover larger than ~256 px, so 300 px is plenty.
const TARGET_COVER_WIDTH: u32 = 300;
const SCRIPT_MARKER: &str = r#"id="__NEXT_DATA__""#;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum EmbedError {
    #[error("embed page has no data block (Spotify may have changed the format)")]
    NoData,
    #[error("embed data could not be parsed: {0}")]
    BadJson(String),
    #[error("embed entity is not of the expected type")]
    UnexpectedType,
    #[error("embed data is missing required fields")]
    BadData,
    #[error("playlist has no usable tracks (empty or not public)")]
    NoTracks,
    #[error("network error: {0}")]
    Network(String),
    #[error("request timed out")]
    Timeout,
    #[error("unexpected HTTP status {0}")]
    Status(u16),
    #[error("response too large")]
    TooLarge,
}

impl EmbedError {
    /// Stable code for the frontend to map to an i18n message.
    pub fn code(&self) -> &'static str {
        match self {
            EmbedError::NoData | EmbedError::BadJson(_) | EmbedError::BadData => {
                "embed.format_changed"
            }
            EmbedError::UnexpectedType => "embed.unexpected_type",
            EmbedError::NoTracks => "embed.no_tracks",
            EmbedError::Network(_) => "embed.network",
            EmbedError::Timeout => "embed.timeout",
            EmbedError::Status(404) => "embed.not_found",
            EmbedError::Status(_) => "embed.status",
            EmbedError::TooLarge => "embed.too_large",
        }
    }
}

// ---- Raw JSON shape (only the parts we use; everything else is ignored) ----

#[derive(Deserialize)]
struct NextData {
    props: Props,
}
#[derive(Deserialize)]
struct Props {
    #[serde(rename = "pageProps")]
    page_props: PageProps,
}
#[derive(Deserialize)]
struct PageProps {
    state: State,
}
#[derive(Deserialize)]
struct State {
    data: Data,
}
#[derive(Deserialize)]
struct Data {
    entity: RawEntity,
}
#[derive(Deserialize)]
struct RawEntity {
    #[serde(rename = "type", default)]
    kind: String,
    id: Option<String>,
    name: Option<String>,
    title: Option<String>,
    /// For playlists this is the owner's name.
    subtitle: Option<String>,
    duration: Option<u64>,
    /// Present on tracks only.
    artists: Option<Vec<RawArtist>>,
    #[serde(rename = "coverArt")]
    cover_art: Option<RawCover>,
    #[serde(rename = "visualIdentity")]
    visual_identity: Option<RawVisual>,
    /// Present on playlists only.
    #[serde(rename = "trackList")]
    track_list: Option<Vec<RawTrack>>,
}
#[derive(Deserialize)]
struct RawArtist {
    name: Option<String>,
}
#[derive(Deserialize)]
struct RawCover {
    sources: Option<Vec<RawCoverSource>>,
}
#[derive(Deserialize)]
struct RawCoverSource {
    url: Option<String>,
    width: Option<u32>,
}
#[derive(Deserialize)]
struct RawVisual {
    image: Option<Vec<RawImage>>,
}
#[derive(Deserialize)]
struct RawImage {
    url: Option<String>,
    #[serde(rename = "maxWidth")]
    max_width: Option<u32>,
}
#[derive(Deserialize)]
struct RawTrack {
    uri: Option<String>,
    title: Option<String>,
    subtitle: Option<String>,
    duration: Option<u64>,
}

// ---- Helpers ----

fn extract_next_data(html: &str) -> Option<&str> {
    let start = html.find(SCRIPT_MARKER)?;
    let after = &html[start..];
    let open = after.find('>')? + 1;
    let body = &after[open..];
    let close = body.find("</script>")?;
    Some(&body[..close])
}

fn parse_entity(html: &str) -> Result<RawEntity, EmbedError> {
    let json = extract_next_data(html).ok_or(EmbedError::NoData)?;
    let data: NextData =
        serde_json::from_str(json).map_err(|e| EmbedError::BadJson(e.to_string()))?;
    Ok(data.props.page_props.state.data.entity)
}

/// Removes control characters, turns any Unicode whitespace (e.g. the non-breaking
/// space Spotify puts between artists) into a plain space, collapses runs of
/// spaces and caps the length. Filename sanitizing is a separate, stricter step
/// done where paths are built.
fn clean_text(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut last_was_space = true; // also trims leading whitespace
    for c in s.chars() {
        if c.is_whitespace() {
            if !last_was_space {
                out.push(' ');
                last_was_space = true;
            }
        } else if !c.is_control() {
            out.push(c);
            last_was_space = false;
        }
    }
    let capped: String = out.trim_end().chars().take(MAX_TEXT_LEN).collect();
    capped.trim_end().to_string()
}

fn track_id_from_uri(uri: &str) -> Option<&str> {
    let id = uri.strip_prefix("spotify:track:")?;
    is_valid_id(id).then_some(id)
}

/// Only https images from Spotify's CDNs are ever downloaded later.
pub fn safe_cover_url(raw: &str) -> Option<String> {
    let u = Url::parse(raw).ok()?;
    let host = u.host_str()?;
    let host_ok = host == "spotifycdn.com"
        || host.ends_with(".spotifycdn.com")
        || host == "scdn.co"
        || host.ends_with(".scdn.co");
    let clean = u.scheme() == "https"
        && host_ok
        && u.username().is_empty()
        && u.password().is_none()
        && u.port().is_none();
    clean.then(|| u.to_string())
}

/// Picks the smallest image at least `TARGET_COVER_WIDTH` wide; if none, the
/// largest smaller one; if no sizes are known, the first candidate.
fn pick_cover(cands: Vec<(String, Option<u32>)>) -> Option<String> {
    let mut best_ge: Option<(u32, &str)> = None;
    let mut best_lt: Option<(u32, &str)> = None;
    for (url, width) in &cands {
        let Some(w) = *width else { continue };
        if w >= TARGET_COVER_WIDTH {
            if best_ge.is_none_or(|(bw, _)| w < bw) {
                best_ge = Some((w, url.as_str()));
            }
        } else if best_lt.is_none_or(|(bw, _)| w > bw) {
            best_lt = Some((w, url.as_str()));
        }
    }
    best_ge
        .or(best_lt)
        .map(|(_, url)| url.to_string())
        .or_else(|| cands.first().map(|(url, _)| url.clone()))
}

fn cover_candidates<I>(items: I) -> Vec<(String, Option<u32>)>
where
    I: IntoIterator<Item = (Option<String>, Option<u32>)>,
{
    items
        .into_iter()
        .filter_map(|(url, width)| Some((safe_cover_url(url.as_deref()?)?, width)))
        .collect()
}

fn entity_cover(cover_art: Option<RawCover>, visual: Option<RawVisual>) -> Option<String> {
    let from_art = cover_art
        .and_then(|c| c.sources)
        .unwrap_or_default()
        .into_iter()
        .map(|s| (s.url, s.width));
    let from_visual = visual
        .and_then(|v| v.image)
        .unwrap_or_default()
        .into_iter()
        .map(|i| (i.url, i.max_width));
    pick_cover(cover_candidates(from_art.chain(from_visual)))
}

// ---- Public API ----

/// Pure parser (no network): easy to test against saved responses.
pub fn parse_playlist_embed(html: &str) -> Result<PlaylistMeta, EmbedError> {
    let e = parse_entity(html)?;
    if e.kind != "playlist" {
        return Err(EmbedError::UnexpectedType);
    }
    let spotify_id =
        e.id.filter(|id| is_valid_id(id))
            .ok_or(EmbedError::BadData)?;
    let name = clean_text(&e.name.or(e.title).unwrap_or_default());
    if name.is_empty() {
        return Err(EmbedError::BadData);
    }
    let owner = e.subtitle.map(|s| clean_text(&s)).filter(|s| !s.is_empty());
    let cover_url = entity_cover(e.cover_art, e.visual_identity);

    let raw_tracks = e.track_list.unwrap_or_default();
    let mut tracks = Vec::with_capacity(raw_tracks.len());
    let mut skipped = 0usize;
    for t in raw_tracks {
        let uri = t.uri.unwrap_or_default();
        let Some(id) = track_id_from_uri(&uri) else {
            skipped += 1;
            continue;
        };
        let title = clean_text(&t.title.unwrap_or_default());
        if title.is_empty() {
            skipped += 1;
            continue;
        }
        tracks.push(TrackMeta {
            spotify_id: id.to_string(),
            title,
            artist: clean_text(&t.subtitle.unwrap_or_default()),
            duration_ms: t.duration.and_then(|d| u32::try_from(d).ok()).unwrap_or(0),
        });
    }
    if tracks.is_empty() {
        return Err(EmbedError::NoTracks);
    }

    Ok(PlaylistMeta {
        spotify_id,
        name,
        owner,
        cover_url,
        tracks,
        skipped,
    })
}

/// Pure parser for a single track's embed page.
pub fn parse_track_embed(html: &str) -> Result<TrackDetail, EmbedError> {
    let e = parse_entity(html)?;
    if e.kind != "track" {
        return Err(EmbedError::UnexpectedType);
    }
    let spotify_id =
        e.id.filter(|id| is_valid_id(id))
            .ok_or(EmbedError::BadData)?;
    let title = clean_text(&e.title.or(e.name).unwrap_or_default());
    // Same joining as Spotify uses in playlists; the result is never split again.
    let artist = e
        .artists
        .unwrap_or_default()
        .into_iter()
        .map(|a| clean_text(&a.name.unwrap_or_default()))
        .filter(|n| !n.is_empty())
        .collect::<Vec<_>>()
        .join(", ");
    if title.is_empty() || artist.is_empty() {
        return Err(EmbedError::BadData);
    }
    let duration_ms = e.duration.and_then(|d| u32::try_from(d).ok()).unwrap_or(0);
    let cover_url = entity_cover(e.cover_art, e.visual_identity);

    Ok(TrackDetail {
        track: TrackMeta {
            spotify_id,
            title,
            artist,
            duration_ms,
        },
        cover_url,
    })
}

fn net_err(e: reqwest::Error) -> EmbedError {
    if e.is_timeout() {
        EmbedError::Timeout
    } else {
        EmbedError::Network(e.without_url().to_string())
    }
}

async fn fetch_html(url: &str) -> Result<String, EmbedError> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0")
        .timeout(Duration::from_secs(15))
        // Follow at most 3 redirects, and only within open.spotify.com.
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() < 3 && attempt.url().host_str() == Some("open.spotify.com")
            {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .build()
        .map_err(net_err)?;

    let mut resp = client.get(url).send().await.map_err(net_err)?;
    if !resp.status().is_success() {
        return Err(EmbedError::Status(resp.status().as_u16()));
    }
    if resp
        .content_length()
        .is_some_and(|l| l > MAX_HTML_BYTES as u64)
    {
        return Err(EmbedError::TooLarge);
    }
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(net_err)? {
        if buf.len() + chunk.len() > MAX_HTML_BYTES {
            return Err(EmbedError::TooLarge);
        }
        buf.extend_from_slice(&chunk);
    }
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

pub async fn fetch_playlist(r: &SpotifyRef) -> Result<PlaylistMeta, EmbedError> {
    if r.kind != SpotifyKind::Playlist {
        return Err(EmbedError::UnexpectedType);
    }
    let html = fetch_html(&r.embed_url()).await?;
    parse_playlist_embed(&html)
}

pub async fn fetch_track(r: &SpotifyRef) -> Result<TrackDetail, EmbedError> {
    if r.kind != SpotifyKind::Track {
        return Err(EmbedError::UnexpectedType);
    }
    let html = fetch_html(&r.embed_url()).await?;
    parse_track_embed(&html)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    const FIXTURE: &str = include_str!("../../tests/fixtures/playlist_embed.html");
    const TRACK_FIXTURE: &str = include_str!("../../tests/fixtures/track_embed.html");
    const PL_ID: &str = "7g3GSq7qgq0J7zK5DhG6hv";
    const TRACK_ID: &str = "2FpCmHXj7UPSuEmGXw8GFt";
    const SINGLE_ID: &str = "1y6dEjheBdnopNo0xDXJ9P";

    fn page(entity: Value) -> String {
        let doc = json!({"props": {"pageProps": {"state": {"data": {"entity": entity}}}}});
        format!(r#"<html><script id="__NEXT_DATA__" type="application/json">{doc}</script></html>"#)
    }

    fn track(uri: &str, title: &str) -> Value {
        json!({"uri": uri, "title": title, "subtitle": "Artist", "duration": 1000})
    }

    fn playlist(tracks: Vec<Value>) -> Value {
        json!({"type": "playlist", "id": PL_ID, "name": "Test", "trackList": tracks})
    }

    fn track_entity() -> Value {
        json!({"type": "track", "id": SINGLE_ID, "title": "Song",
               "artists": [{"name": "A"}], "duration": 1000})
    }

    fn c(url: &str, w: Option<u32>) -> (String, Option<u32>) {
        (url.to_string(), w)
    }

    #[test]
    fn parses_real_playlist_fixture() {
        let p = parse_playlist_embed(FIXTURE).expect("fixture should parse");
        assert_eq!(p.spotify_id, PL_ID);
        assert_eq!(p.name, "B~腹芸");
        assert_eq!(p.owner.as_deref(), Some("swogvex"));
        assert_eq!(p.tracks.len(), 4);
        assert_eq!(p.skipped, 0);
        assert!(!p.may_be_truncated());
        assert_eq!(
            p.cover_url.as_deref(),
            Some(
                "https://image-cdn-fa.spotifycdn.com/image/ab67706c0000da84b72d0c7e02888e481be00939"
            )
        );

        let first = &p.tracks[0];
        assert_eq!(first.spotify_id, TRACK_ID);
        assert_eq!(first.title, "C’est La Vie");
        assert_eq!(first.artist, "Amaia");
        assert_eq!(first.duration_ms, 137_263);

        let last = &p.tracks[3];
        assert_eq!(last.title, "All I Did Was Dream of You (feat. The Marías)");
        assert_eq!(last.artist, "beabadoobee, The Marías");
    }

    #[test]
    fn parses_real_track_fixture() {
        let d = parse_track_embed(TRACK_FIXTURE).expect("fixture should parse");
        assert_eq!(d.track.spotify_id, SINGLE_ID);
        assert_eq!(d.track.title, "Scars leave beautiful trace");
        // One artist whose name contains a comma: must stay whole.
        assert_eq!(d.track.artist, "Car, the garden");
        assert_eq!(d.track.duration_ms, 213_946);
        assert_eq!(
            d.cover_url.as_deref(),
            Some(
                "https://image-cdn-fa.spotifycdn.com/image/ab67616d00001e02a5b3932c6497daf873029eb3"
            )
        );
    }

    #[test]
    fn skips_entries_that_are_not_regular_tracks() {
        let tracks = vec![
            track(&format!("spotify:track:{TRACK_ID}"), "Good"),
            track(&format!("spotify:episode:{TRACK_ID}"), "Episode"),
            track("spotify:track:short", "Bad id"),
            track(&format!("spotify:track:{TRACK_ID}"), ""),
            json!({"title": "No uri"}),
        ];
        let p = parse_playlist_embed(&page(playlist(tracks))).unwrap();
        assert_eq!(p.tracks.len(), 1);
        assert_eq!(p.skipped, 4);
    }

    #[test]
    fn strips_control_characters_from_text() {
        let uri = format!("spotify:track:{TRACK_ID}");
        let p = parse_playlist_embed(&page(playlist(vec![track(&uri, "A\u{0007}B\n")]))).unwrap();
        assert_eq!(p.tracks[0].title, "AB");
    }

    #[test]
    fn normalizes_unicode_whitespace() {
        assert_eq!(clean_text("a,\u{a0}b"), "a, b");
        assert_eq!(clean_text("  a \u{2003}\t b  "), "a b");
        assert_eq!(clean_text("\u{a0}\n"), "");
    }

    #[test]
    fn flags_possibly_truncated_playlists() {
        let tracks: Vec<Value> = (0..100)
            .map(|i| track(&format!("spotify:track:{i:0>22}"), "T"))
            .collect();
        let p = parse_playlist_embed(&page(playlist(tracks))).unwrap();
        assert_eq!(p.tracks.len(), 100);
        assert!(p.may_be_truncated());
    }

    #[test]
    fn rejects_wrong_type_empty_and_broken_pages() {
        let album = json!({"type": "album", "id": PL_ID, "name": "x", "trackList": []});
        assert_eq!(
            parse_playlist_embed(&page(album)),
            Err(EmbedError::UnexpectedType)
        );
        assert_eq!(
            parse_playlist_embed(&page(playlist(vec![]))),
            Err(EmbedError::NoTracks)
        );
        assert_eq!(
            parse_playlist_embed("<html></html>"),
            Err(EmbedError::NoData)
        );
        let bad = r#"<script id="__NEXT_DATA__" type="application/json">{not json</script>"#;
        assert!(matches!(
            parse_playlist_embed(bad),
            Err(EmbedError::BadJson(_))
        ));
        let empty_obj = r#"<script id="__NEXT_DATA__" type="application/json">{}</script>"#;
        assert!(matches!(
            parse_playlist_embed(empty_obj),
            Err(EmbedError::BadJson(_))
        ));
    }

    #[test]
    fn cover_urls_must_be_https_spotify_cdn() {
        assert!(safe_cover_url("https://i.scdn.co/image/abc").is_some());
        assert!(safe_cover_url("https://image-cdn-ak.spotifycdn.com/image/abc").is_some());
        for bad in [
            "http://i.scdn.co/image/abc",
            "https://evil.com/x.jpg",
            "https://i.scdn.co.evil.com/x.jpg",
            "https://user@i.scdn.co/x.jpg",
            "https://i.scdn.co:8443/x.jpg",
            "not a url",
        ] {
            assert!(safe_cover_url(bad).is_none(), "{bad}");
        }
    }

    #[test]
    fn pick_cover_prefers_closest_to_300px() {
        let pick = |v| pick_cover(v);
        assert_eq!(
            pick(vec![c("a", Some(64)), c("b", Some(640)), c("c", Some(300))]).as_deref(),
            Some("c")
        );
        assert_eq!(
            pick(vec![c("a", Some(400)), c("b", Some(500))]).as_deref(),
            Some("a")
        );
        assert_eq!(
            pick(vec![c("a", Some(64)), c("b", Some(100))]).as_deref(),
            Some("b")
        );
        assert_eq!(
            pick(vec![c("a", None), c("b", Some(64))]).as_deref(),
            Some("b")
        );
        assert_eq!(pick(vec![c("a", None), c("b", None)]).as_deref(), Some("a"));
        assert_eq!(pick(vec![]), None);
    }

    #[test]
    fn playlist_cover_ignores_untrusted_hosts() {
        let mut entity = playlist(vec![track(&format!("spotify:track:{TRACK_ID}"), "T")]);
        entity["coverArt"] = json!({"sources": [
            {"url": "https://evil.com/huge.jpg", "width": 4000},
            {"url": "https://i.scdn.co/image/ok", "width": 640},
        ]});
        let p = parse_playlist_embed(&page(entity)).unwrap();
        assert_eq!(p.cover_url.as_deref(), Some("https://i.scdn.co/image/ok"));
    }

    #[test]
    fn track_rejects_wrong_type_and_missing_fields() {
        assert_eq!(
            parse_track_embed(&page(playlist(vec![]))),
            Err(EmbedError::UnexpectedType)
        );
        assert_eq!(
            parse_playlist_embed(&page(track_entity())),
            Err(EmbedError::UnexpectedType)
        );

        let mut no_artist = track_entity();
        no_artist["artists"] = json!([]);
        assert_eq!(
            parse_track_embed(&page(no_artist)),
            Err(EmbedError::BadData)
        );

        let mut bad_id = track_entity();
        bad_id["id"] = json!("nope");
        assert_eq!(parse_track_embed(&page(bad_id)), Err(EmbedError::BadData));

        let mut no_title = track_entity();
        no_title["title"] = json!(" ");
        assert_eq!(parse_track_embed(&page(no_title)), Err(EmbedError::BadData));
    }

    #[test]
    fn track_joins_artists_without_splitting_names() {
        let mut e = track_entity();
        e["artists"] = json!([{"name": "Car, the garden"}, {"name": "B\u{a0}C"}, {"name": " "}]);
        let d = parse_track_embed(&page(e)).unwrap();
        assert_eq!(d.track.artist, "Car, the garden, B C");
        assert_eq!(d.cover_url, None);
    }

    #[test]
    fn error_codes_are_stable() {
        assert_eq!(EmbedError::NoData.code(), "embed.format_changed");
        assert_eq!(EmbedError::Status(404).code(), "embed.not_found");
        assert_eq!(EmbedError::Status(500).code(), "embed.status");
    }
}
