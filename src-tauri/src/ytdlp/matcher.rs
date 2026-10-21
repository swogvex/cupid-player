//! Chooses the YouTube candidate that best matches a Spotify track.
//! Pure functions: no network, easy to test.

use std::cmp::Reverse;
use std::collections::HashSet;

use super::search::Candidate;
use crate::spotify::model::TrackMeta;

/// Candidates scoring below this are not downloaded automatically (needs_review).
pub const MIN_ACCEPT_SCORE: i32 = 60;

const MAX_DURATION_DIFF_SECS: u64 = 10;
const POINTS_DURATION_CLOSE: i32 = 40; // <= 3 s
const POINTS_DURATION_NEAR: i32 = 20; // <= 6 s
const POINTS_DURATION_LOOSE: i32 = 5; // <= 10 s
const POINTS_TITLE: i32 = 25;
const POINTS_ARTIST_FULL: i32 = 25;
const POINTS_ARTIST_PARTIAL: i32 = 10;
const POINTS_TOPIC_CHANNEL: i32 = 12;
const POINTS_OFFICIAL_AUDIO: i32 = 8;
const PENALTY_PER_PHRASE: i32 = 50;
const MAX_PENALTY: i32 = 100;
/// Penalized when the video title has them and the original track does not.
/// "8d", "instrumental" and "inst" were added after real search results showed
/// 8D-audio and instrumental uploads tying with the right one.
const BAD_VARIANTS: [&str; 9] = [
    "live",
    "cover",
    "remix",
    "sped up",
    "slowed",
    "karaoke",
    "8d",
    "instrumental",
    "inst",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Scored {
    pub candidate: Candidate,
    pub score: i32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MatchOutcome {
    Accepted(Scored),
    /// No candidate reached the threshold. Ranked best-first (possibly empty),
    /// so the UI can later offer a manual choice.
    NeedsReview(Vec<Scored>),
}

/// Folds common accented Latin letters (input is already lowercase).
fn fold(c: char) -> char {
    match c {
        'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' | 'ā' | 'ă' | 'ą' => 'a',
        'ç' | 'ć' | 'č' => 'c',
        'è' | 'é' | 'ê' | 'ë' | 'ē' | 'ę' | 'ě' => 'e',
        'ì' | 'í' | 'î' | 'ï' | 'ī' => 'i',
        'ñ' | 'ń' | 'ň' => 'n',
        'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ø' | 'ō' | 'ő' => 'o',
        'ù' | 'ú' | 'û' | 'ü' | 'ū' | 'ů' | 'ű' => 'u',
        'ý' | 'ÿ' => 'y',
        'š' | 'ś' => 's',
        'ž' | 'ź' | 'ż' => 'z',
        'ł' => 'l',
        _ => c,
    }
}

/// Lowercase, accent-folded words separated by single spaces. Every
/// non-alphanumeric character (including ' and ’) acts as a separator.
fn normalize(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut pending_space = false;
    for c in s.chars().flat_map(char::to_lowercase) {
        let c = fold(c);
        if c.is_alphanumeric() {
            if pending_space && !out.is_empty() {
                out.push(' ');
            }
            pending_space = false;
            out.push(c);
        } else {
            pending_space = true;
        }
    }
    out
}

/// Whole-word phrase search on already normalized text ("alive" does not contain "live").
fn contains_phrase(hay: &str, phrase: &str) -> bool {
    !phrase.is_empty() && format!(" {hay} ").contains(&format!(" {phrase} "))
}

fn strip_brackets(s: &str) -> String {
    let mut depth = 0u32;
    let mut out = String::new();
    for c in s.chars() {
        match c {
            '(' | '[' => depth += 1,
            ')' | ']' => depth = depth.saturating_sub(1),
            _ if depth == 0 => out.push(c),
            _ => {}
        }
    }
    out
}

/// Title without "(feat. ...)", "[...]" and a " - Remastered ..." suffix.
fn core_title(title: &str) -> String {
    let no_brackets = strip_brackets(title);
    let head = no_brackets.split(" - ").next().unwrap_or("");
    let core = normalize(head);
    if core.is_empty() {
        normalize(title)
    } else {
        core
    }
}

/// `None` means the candidate is discarded. Unknown durations never discard.
fn duration_points(spotify_ms: u32, cand_secs: Option<u32>) -> Option<i32> {
    let (ms, cand) = match (spotify_ms, cand_secs) {
        (0, _) | (_, None) => return Some(0),
        (ms, Some(c)) => (ms, c),
    };
    let spotify_secs = (u64::from(ms) + 500) / 1000;
    let diff = spotify_secs.abs_diff(u64::from(cand));
    match diff {
        0..=3 => Some(POINTS_DURATION_CLOSE),
        4..=6 => Some(POINTS_DURATION_NEAR),
        d if d <= MAX_DURATION_DIFF_SECS => Some(POINTS_DURATION_LOOSE),
        _ => None,
    }
}

/// The artist text is never split by commas (D-78); words are compared instead.
fn artist_points(artist: &str, hay: &str) -> i32 {
    let artist_norm = normalize(artist);
    let words: Vec<&str> = artist_norm.split(' ').filter(|w| !w.is_empty()).collect();
    if words.is_empty() {
        return 0;
    }
    let hay_words: HashSet<&str> = hay.split(' ').collect();
    let found = words.iter().filter(|w| hay_words.contains(*w)).count();
    if found == words.len() {
        POINTS_ARTIST_FULL
    } else if found * 2 >= words.len() {
        POINTS_ARTIST_PARTIAL
    } else {
        0
    }
}

/// Score of one candidate, or `None` if it must be discarded.
pub fn score_candidate(track: &TrackMeta, cand: &Candidate) -> Option<i32> {
    if cand.is_live {
        return None;
    }
    let mut score = duration_points(track.duration_ms, cand.duration_secs)?;

    let cand_title = normalize(&cand.title);
    let cand_channel = normalize(&cand.channel);

    if contains_phrase(&cand_title, &core_title(&track.title)) {
        score += POINTS_TITLE;
    }
    let hay = format!("{cand_title} {cand_channel}");
    score += artist_points(&track.artist, &hay);

    // Official sources: "... - Topic" channels and label uploads ("Provided to YouTube by").
    if cand.auto_generated || cand_channel == "topic" || cand_channel.ends_with(" topic") {
        score += POINTS_TOPIC_CHANNEL;
    } else if contains_phrase(&cand_title, "official audio") {
        score += POINTS_OFFICIAL_AUDIO;
    }

    let original = normalize(&format!("{} {}", track.title, track.artist));
    let bad = BAD_VARIANTS
        .iter()
        .filter(|w| contains_phrase(&cand_title, w) && !contains_phrase(&original, w))
        .count();
    score -= (bad as i32 * PENALTY_PER_PHRASE).min(MAX_PENALTY);

    Some(score)
}

/// Candidates that were not discarded, best first. Ties keep YouTube's order.
pub fn rank(track: &TrackMeta, cands: &[Candidate]) -> Vec<Scored> {
    let mut scored: Vec<Scored> = cands
        .iter()
        .filter_map(|c| {
            score_candidate(track, c).map(|score| Scored {
                candidate: c.clone(),
                score,
            })
        })
        .collect();
    scored.sort_by_key(|s| Reverse(s.score)); // stable sort
    scored
}

pub fn choose_best(track: &TrackMeta, cands: &[Candidate]) -> MatchOutcome {
    let mut ranked = rank(track, cands);
    let accept = ranked.first().is_some_and(|b| b.score >= MIN_ACCEPT_SCORE);
    if accept {
        MatchOutcome::Accepted(ranked.remove(0))
    } else {
        MatchOutcome::NeedsReview(ranked)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(title: &str, artist: &str, ms: u32) -> TrackMeta {
        TrackMeta {
            spotify_id: "id".into(),
            title: title.into(),
            artist: artist.into(),
            duration_ms: ms,
        }
    }

    fn c(id: &str, title: &str, channel: &str, secs: Option<u32>) -> Candidate {
        Candidate {
            video_id: id.into(),
            title: title.into(),
            channel: channel.into(),
            duration_secs: secs,
            is_live: false,
            auto_generated: false,
        }
    }

    fn accepted_id(o: &MatchOutcome) -> Option<&str> {
        match o {
            MatchOutcome::Accepted(s) => Some(s.candidate.video_id.as_str()),
            MatchOutcome::NeedsReview(_) => None,
        }
    }

    const REAL_RESULTS: &str = include_str!("../../tests/fixtures/ytsearch_sample.jsonl");

    fn ids(ranked: &[Scored]) -> Vec<String> {
        ranked
            .iter()
            .map(|s| s.candidate.video_id.clone())
            .collect()
    }

    fn scores(ranked: &[Scored]) -> Vec<i32> {
        ranked.iter().map(|s| s.score).collect()
    }

    #[test]
    fn accepts_clean_official_audio() {
        let track = t("Scars leave beautiful trace", "Car, the garden", 213_946);
        let cands = [c(
            "a",
            "Car, the garden - Scars leave beautiful trace (Official Audio)",
            "Car, the garden",
            Some(214),
        )];
        assert_eq!(accepted_id(&choose_best(&track, &cands)), Some("a"));
        assert_eq!(score_candidate(&track, &cands[0]), Some(98));
    }

    #[test]
    fn prefers_studio_over_live_and_flags_live_only() {
        let track = t("Scars leave beautiful trace", "Car, the garden", 213_946);
        let live = c(
            "live",
            "Car, the garden - Scars leave beautiful trace (Live at Somewhere)",
            "Car, the garden",
            Some(214),
        );
        let studio = c(
            "studio",
            "Car, the garden - Scars leave beautiful trace",
            "Car, the garden",
            Some(213),
        );
        let both = choose_best(&track, &[live.clone(), studio]);
        assert_eq!(accepted_id(&both), Some("studio"));

        match choose_best(&track, &[live]) {
            MatchOutcome::NeedsReview(v) => {
                assert_eq!(v.len(), 1);
                assert_eq!(v[0].score, 40);
            }
            other => panic!("expected NeedsReview, got {other:?}"),
        }
    }

    #[test]
    fn remix_penalty_depends_on_the_original() {
        let cand = c("a", "Artist - Song (Remix)", "Artist", Some(200));
        let remix_track = t("Song (Remix)", "Artist", 200_000);
        let plain_track = t("Song", "Artist", 200_000);
        assert_eq!(score_candidate(&remix_track, &cand), Some(90));
        assert_eq!(score_candidate(&plain_track, &cand), Some(40));
    }

    #[test]
    fn discards_big_duration_gaps() {
        let track = t("Scars leave beautiful trace", "Car, the garden", 213_946); // 214 s
        let title = "Car, the garden - Scars leave beautiful trace";
        let ten = c("a", title, "Car, the garden", Some(224));
        let eleven = c("b", title, "Car, the garden", Some(225));
        assert!(score_candidate(&track, &ten).is_some());
        assert_eq!(score_candidate(&track, &eleven), None);
        match choose_best(&track, &[eleven]) {
            MatchOutcome::NeedsReview(v) => assert!(v.is_empty()),
            other => panic!("expected NeedsReview, got {other:?}"),
        }
    }

    #[test]
    fn closer_duration_wins_regardless_of_order() {
        let track = t("Song", "Artist", 215_000);
        let far = c("far", "Artist - Song", "Artist", Some(222));
        let near = c("near", "Artist - Song", "Artist", Some(215));
        assert_eq!(
            accepted_id(&choose_best(&track, &[far, near])),
            Some("near")
        );
    }

    #[test]
    fn folds_accents_and_apostrophes() {
        let t1 = t("C’est La Vie", "Amaia", 137_263);
        let c1 = c(
            "a",
            "Amaia - C'est la vie (Official Audio)",
            "Amaia",
            Some(137),
        );
        assert_eq!(accepted_id(&choose_best(&t1, &[c1])), Some("a"));

        let t2 = t("Canción", "Marías", 180_000);
        let c2 = c("b", "Marias - Cancion", "Marias", Some(180));
        assert_eq!(accepted_id(&choose_best(&t2, &[c2])), Some("b"));
    }

    #[test]
    fn handles_feat_suffix_and_multiple_artists() {
        let track = t(
            "All I Did Was Dream of You (feat. The Marías)",
            "beabadoobee, The Marías",
            223_788,
        );
        let cand = c(
            "a",
            "beabadoobee & The Marias - All I Did Was Dream Of You",
            "beabadoobee",
            Some(224),
        );
        assert_eq!(score_candidate(&track, &cand), Some(90));
        assert_eq!(accepted_id(&choose_best(&track, &[cand])), Some("a"));
    }

    #[test]
    fn phrase_matching_respects_word_boundaries() {
        assert!(!contains_phrase("alive and well", "live"));
        assert!(contains_phrase("a live version", "live"));
        assert!(contains_phrase("song sped up", "sped up"));
        assert!(!contains_phrase("anything", ""));
    }

    #[test]
    fn unknown_duration_needs_extra_evidence() {
        let track = t("Song", "Artist", 0);
        let plain = c("a", "Artist - Song", "Artist", Some(200));
        match choose_best(&track, &[plain]) {
            MatchOutcome::NeedsReview(v) => assert_eq!(v[0].score, 50),
            other => panic!("expected NeedsReview, got {other:?}"),
        }
        let topic = c("b", "Song", "Artist - Topic", Some(200));
        assert_eq!(accepted_id(&choose_best(&track, &[topic])), Some("b"));
    }

    #[test]
    fn unrelated_video_needs_review() {
        let track = t("Song", "Artist", 200_000);
        let cand = c("a", "Totally different video", "Someone", Some(200));
        match choose_best(&track, &[cand]) {
            MatchOutcome::NeedsReview(v) => assert_eq!(v[0].score, 40),
            other => panic!("expected NeedsReview, got {other:?}"),
        }
    }

    #[test]
    fn live_streams_are_skipped() {
        let track = t("Song", "Artist", 200_000);
        let mut cand = c("a", "Artist - Song", "Artist", Some(200));
        cand.is_live = true;
        assert_eq!(score_candidate(&track, &cand), None);
    }

    #[test]
    fn topic_channel_gets_a_bonus() {
        let track = t("Scars leave beautiful trace", "Car, the garden", 213_946);
        let topic = c(
            "a",
            "Scars leave beautiful trace",
            "Car, the garden - Topic",
            Some(214),
        );
        let plain = c(
            "b",
            "Scars leave beautiful trace",
            "Car, the garden",
            Some(214),
        );
        let st = score_candidate(&track, &topic).expect("scored");
        let sp = score_candidate(&track, &plain).expect("scored");
        assert_eq!(st - sp, POINTS_TOPIC_CHANNEL);
    }

    #[test]
    fn real_search_results_pick_the_official_audio() {
        use crate::ytdlp::search::parse_search_output;
        let track = t("Scars leave beautiful trace", "Car, the garden", 213_946);
        let mut cands = parse_search_output(REAL_RESULTS);
        assert_eq!(cands.len(), 5);

        let ranked = rank(&track, &cands);
        assert_eq!(
            ids(&ranked),
            [
                "dGoHLoDmHdI",
                "tnDwh3JkyGo",
                "dOPDEBy4xaw",
                "PT8wzSjdGUg",
                "8RBa9IACkVc"
            ]
        );
        assert_eq!(scores(&ranked), [102, 90, 70, 52, 40]);

        // YouTube's result order must not matter.
        cands.reverse();
        assert_eq!(
            accepted_id(&choose_best(&track, &cands)),
            Some("dGoHLoDmHdI")
        );
    }

    #[test]
    fn instrumental_and_8d_versions_are_penalized() {
        let track = t("Song", "Artist", 200_000);
        let studio = c("a", "Artist - Song", "Artist", Some(200));
        let instrumental = c("b", "Artist - Song (Instrumental)", "Artist", Some(200));
        let eight_d = c("c", "Artist - Song | 8D Audio", "Artist", Some(200));
        let short_inst = c("d", "Song (Inst.)", "Artist", Some(200));
        assert_eq!(score_candidate(&track, &studio), Some(90));
        assert_eq!(score_candidate(&track, &instrumental), Some(40));
        assert_eq!(score_candidate(&track, &eight_d), Some(40));
        assert_eq!(score_candidate(&track, &short_inst), Some(40));

        // If the original itself is the instrumental, it is not penalized.
        let inst_track = t("Song (Instrumental)", "Artist", 200_000);
        assert_eq!(score_candidate(&inst_track, &instrumental), Some(90));
    }

    #[test]
    fn auto_generated_uploads_get_the_official_bonus_once() {
        let track = t("Song", "Artist", 200_000);
        let plain = c("a", "Song", "Artist", Some(200));
        let mut auto = c("b", "Song", "Artist", Some(200));
        auto.auto_generated = true;
        let mut auto_official = c("c", "Song (Official Audio)", "Artist", Some(200));
        auto_official.auto_generated = true;
        assert_eq!(score_candidate(&track, &plain), Some(90));
        assert_eq!(score_candidate(&track, &auto), Some(102));
        assert_eq!(score_candidate(&track, &auto_official), Some(102)); // bonuses do not stack
    }
}
