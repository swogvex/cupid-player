//! Clean metadata types produced by the Spotify embed parser.

/// Spotify's embed returns at most ~100 entries per playlist and does not report
/// the real total (assumption A-05; a 100-track result was observed).
pub const EMBED_TRACK_LIMIT_HINT: usize = 100;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrackMeta {
    pub spotify_id: String,
    pub title: String,
    /// All credited artists as ONE display text, e.g. "beabadoobee, The Marías".
    /// A single artist name can contain a comma itself (e.g. "Car, the garden"),
    /// so this text must never be split: matchers and file names use it whole.
    pub artist: String,
    /// 0 when unknown.
    pub duration_ms: u32,
}

/// A track read from its own embed page: the same data plus its cover.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrackDetail {
    pub track: TrackMeta,
    pub cover_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlaylistMeta {
    pub spotify_id: String,
    pub name: String,
    pub owner: Option<String>,
    pub cover_url: Option<String>,
    pub tracks: Vec<TrackMeta>,
    /// Entries ignored because they are not regular tracks (episodes, local files...).
    pub skipped: usize,
}

impl PlaylistMeta {
    /// True when the list is as long as the embed's apparent cap, so more tracks
    /// may exist that we cannot see.
    pub fn may_be_truncated(&self) -> bool {
        self.tracks.len() + self.skipped >= EMBED_TRACK_LIMIT_HINT
    }
}