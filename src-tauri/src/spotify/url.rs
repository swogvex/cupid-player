//! Strict validation of public Spotify links (track / playlist only).
//!
//! The original text is never forwarded anywhere: callers only receive a
//! `SpotifyRef` and rebuild canonical URLs from it.

use ::url::Url;
use thiserror::Error;

const MAX_INPUT_LEN: usize = 300;
const SPOTIFY_HOST: &str = "open.spotify.com";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SpotifyKind {
    Track,
    Playlist,
}

impl SpotifyKind {
    pub fn as_str(self) -> &'static str {
        match self {
            SpotifyKind::Track => "track",
            SpotifyKind::Playlist => "playlist",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpotifyRef {
    pub kind: SpotifyKind,
    pub id: String,
}

impl SpotifyRef {
    /// Public page for the item, rebuilt from validated parts.
    pub fn canonical_url(&self) -> String {
        format!("https://{SPOTIFY_HOST}/{}/{}", self.kind.as_str(), self.id)
    }

    /// Public embed page used to read metadata (no API key).
    pub fn embed_url(&self) -> String {
        format!("https://{SPOTIFY_HOST}/embed/{}/{}", self.kind.as_str(), self.id)
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum UrlError {
    #[error("empty input")]
    Empty,
    #[error("input too long")]
    TooLong,
    #[error("input contains whitespace or control characters")]
    BadChars,
    #[error("not a valid URL")]
    NotAUrl,
    #[error("only https links are accepted")]
    NotHttps,
    #[error("credentials or ports are not allowed in the link")]
    BadAuthority,
    #[error("not an open.spotify.com link")]
    WrongHost,
    #[error("only track and playlist links are supported")]
    UnsupportedKind,
    #[error("unexpected link path")]
    MalformedPath,
    #[error("invalid Spotify id")]
    BadId,
}

impl UrlError {
    /// Stable code for the frontend to map to an i18n message.
    pub fn code(&self) -> &'static str {
        match self {
            UrlError::Empty => "spotify_url.empty",
            UrlError::TooLong => "spotify_url.too_long",
            UrlError::BadChars => "spotify_url.bad_chars",
            UrlError::NotAUrl => "spotify_url.not_a_url",
            UrlError::NotHttps => "spotify_url.not_https",
            UrlError::BadAuthority => "spotify_url.bad_authority",
            UrlError::WrongHost => "spotify_url.wrong_host",
            UrlError::UnsupportedKind => "spotify_url.unsupported_kind",
            UrlError::MalformedPath => "spotify_url.malformed_path",
            UrlError::BadId => "spotify_url.bad_id",
        }
    }
}

/// `intl-xx` locale prefix that Spotify adds to shared links.
fn is_intl_segment(s: &str) -> bool {
    s.len() == 7
        && s.starts_with("intl-")
        && s[5..].bytes().all(|b| b.is_ascii_lowercase())
}

/// Spotify ids are 22 ASCII alphanumeric characters.
fn is_valid_id(s: &str) -> bool {
    s.len() == 22 && s.bytes().all(|b| b.is_ascii_alphanumeric())
}

pub fn parse_spotify_url(input: &str) -> Result<SpotifyRef, UrlError> {
    let input = input.trim();
    if input.is_empty() {
        return Err(UrlError::Empty);
    }
    if input.len() > MAX_INPUT_LEN {
        return Err(UrlError::TooLong);
    }
    if input.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err(UrlError::BadChars);
    }

    let url = Url::parse(input).map_err(|_| UrlError::NotAUrl)?;
    if url.scheme() != "https" {
        return Err(UrlError::NotHttps);
    }
    if !url.username().is_empty() || url.password().is_some() || url.port().is_some() {
        return Err(UrlError::BadAuthority);
    }
    if url.host_str() != Some(SPOTIFY_HOST) {
        return Err(UrlError::WrongHost);
    }

    // Query (?si=...) and fragment are ignored on purpose.
    let mut segs: Vec<&str> = url
        .path_segments()
        .map(|s| s.collect())
        .unwrap_or_default();
    if segs.last() == Some(&"") {
        segs.pop(); // one trailing slash is fine
    }
    if segs.first().is_some_and(|s| is_intl_segment(s)) {
        segs.remove(0);
    }

    let [kind, id] = segs.as_slice() else {
        return Err(UrlError::MalformedPath);
    };
    let kind = match *kind {
        "track" => SpotifyKind::Track,
        "playlist" => SpotifyKind::Playlist,
        _ => return Err(UrlError::UnsupportedKind),
    };
    if !is_valid_id(id) {
        return Err(UrlError::BadId);
    }

    Ok(SpotifyRef { kind, id: (*id).to_string() })
}

#[cfg(test)]
mod tests {
    use super::*;

    const TRACK: &str = "4uLU6hMCjMI75M1A2tKUQC";
    const PLAYLIST: &str = "37i9dQZF1DXcBWIGoYBM5M";

    fn ok(input: &str) -> SpotifyRef {
        parse_spotify_url(input).expect("should be valid")
    }

    #[test]
    fn accepts_plain_track_and_playlist() {
        let t = ok(&format!("https://open.spotify.com/track/{TRACK}"));
        assert_eq!(t, SpotifyRef { kind: SpotifyKind::Track, id: TRACK.into() });
        let p = ok(&format!("https://open.spotify.com/playlist/{PLAYLIST}"));
        assert_eq!(p.kind, SpotifyKind::Playlist);
        assert_eq!(p.id, PLAYLIST);
    }

    #[test]
    fn accepts_intl_prefix_query_fragment_trailing_slash_and_spaces() {
        let t = ok(&format!("  https://open.spotify.com/intl-es/track/{TRACK}?si=abc123#x  "));
        assert_eq!(t.id, TRACK);
        ok(&format!("https://open.spotify.com/playlist/{PLAYLIST}/"));
        ok(&format!("https://OPEN.SPOTIFY.COM/track/{TRACK}"));
    }

    #[test]
    fn canonical_and_embed_urls_are_rebuilt() {
        let t = ok(&format!("https://open.spotify.com/intl-es/track/{TRACK}?si=zzz"));
        assert_eq!(t.canonical_url(), format!("https://open.spotify.com/track/{TRACK}"));
        assert_eq!(t.embed_url(), format!("https://open.spotify.com/embed/track/{TRACK}"));
    }

    #[test]
    fn rejects_empty_and_too_long() {
        assert_eq!(parse_spotify_url("   "), Err(UrlError::Empty));
        let long = format!("https://open.spotify.com/track/{}", "a".repeat(400));
        assert_eq!(parse_spotify_url(&long), Err(UrlError::TooLong));
    }

    #[test]
    fn rejects_whitespace_and_control_chars() {
        let url = format!("https://open.spotify.com/track/{TRACK}; calc");
        assert_eq!(parse_spotify_url(&url), Err(UrlError::BadChars));
        let url = format!("https://open.spotify.com/track/{TRACK}\n--exec");
        assert_eq!(parse_spotify_url(&url), Err(UrlError::BadChars));
    }

    #[test]
    fn rejects_non_url_and_other_schemes() {
        assert_eq!(parse_spotify_url("hola"), Err(UrlError::NotAUrl));
        assert_eq!(parse_spotify_url(&format!("spotify:track:{TRACK}")), Err(UrlError::NotHttps));
        assert_eq!(parse_spotify_url("javascript:alert(1)"), Err(UrlError::NotHttps));
        assert_eq!(
            parse_spotify_url(&format!("http://open.spotify.com/track/{TRACK}")),
            Err(UrlError::NotHttps)
        );
    }

    #[test]
    fn rejects_lookalike_hosts_and_credentials() {
        for host in [
            "open.spotify.com.evil.com",
            "evil.com",
            "spotify.com",
            "open.spotify.com.",
            "xopen.spotify.com",
        ] {
            let url = format!("https://{host}/track/{TRACK}");
            assert_eq!(parse_spotify_url(&url), Err(UrlError::WrongHost), "{host}");
        }
        // The real host here is evil.com.
        let url = format!("https://open.spotify.com@evil.com/track/{TRACK}");
        assert_eq!(parse_spotify_url(&url), Err(UrlError::BadAuthority));
        let url = format!("https://open.spotify.com:8443/track/{TRACK}");
        assert_eq!(parse_spotify_url(&url), Err(UrlError::BadAuthority));
    }

    #[test]
    fn rejects_unsupported_kinds_and_bad_paths() {
        for kind in ["album", "artist", "episode", "show", "user"] {
            let url = format!("https://open.spotify.com/{kind}/{TRACK}");
            assert_eq!(parse_spotify_url(&url), Err(UrlError::UnsupportedKind), "{kind}");
        }
        assert_eq!(
            parse_spotify_url("https://open.spotify.com/track"),
            Err(UrlError::MalformedPath)
        );
        assert_eq!(
            parse_spotify_url(&format!("https://open.spotify.com/embed/track/{TRACK}")),
            Err(UrlError::MalformedPath)
        );
        assert_eq!(
            parse_spotify_url(&format!("https://open.spotify.com/track/{TRACK}/extra")),
            Err(UrlError::MalformedPath)
        );
    }

    #[test]
    fn rejects_bad_ids() {
        for id in [
            "short",
            "4uLU6hMCjMI75M1A2tKUQ",       // 21 chars
            "4uLU6hMCjMI75M1A2tKUQCC",     // 23 chars
            "4uLU6hMCjMI75M1A2tKU-C",      // symbol
            "4uLU6hMCjMI75M1A2tK%55",      // percent-encoding
            "4uLU6hMCjMI75M1A2t&&calc",    // shell-looking suffix
        ] {
            let url = format!("https://open.spotify.com/track/{id}");
            assert_eq!(parse_spotify_url(&url), Err(UrlError::BadId), "{id}");
        }
    }

    #[test]
    fn error_codes_are_stable_and_prefixed() {
        assert_eq!(UrlError::WrongHost.code(), "spotify_url.wrong_host");
        assert!(UrlError::BadId.code().starts_with("spotify_url."));
    }
}