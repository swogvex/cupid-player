//! Parser for LRC (time-synced lyrics): lines like "[mm:ss.xx] text".

use serde::Serialize;

pub const MAX_LINES: usize = 3000;
pub const MAX_LINE_CHARS: usize = 400;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LrcLine {
    /// Milliseconds from the start of the song.
    pub ms: u32,
    /// Empty for instrumental breaks.
    pub text: String,
}

fn all_digits(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())
}

/// "mm:ss", "mm:ss.x", "mm:ss.xx" or "mm:ss.xxx" (also with a comma) to milliseconds.
fn parse_stamp(s: &str) -> Option<u32> {
    let (min, rest) = s.split_once(':')?;
    let (sec, frac) = rest.split_once(['.', ',']).unwrap_or((rest, ""));
    if !all_digits(min) || min.len() > 3 || !all_digits(sec) || sec.len() > 2 {
        return None;
    }
    if !frac.is_empty() && (!all_digits(frac) || frac.len() > 3) {
        return None;
    }
    let min: u32 = min.parse().ok()?;
    let sec: u32 = sec.parse().ok()?;
    if sec >= 60 {
        return None;
    }
    let frac_ms: u32 = if frac.is_empty() {
        0
    } else {
        let n: u32 = frac.parse().ok()?;
        n * 10u32.pow(3 - frac.len() as u32)
    };
    Some((min * 60 + sec) * 1000 + frac_ms)
}

fn clean_text(s: &str) -> String {
    s.trim()
        .chars()
        .filter(|c| !c.is_control())
        .take(MAX_LINE_CHARS)
        .collect()
}

/// Lines without a valid time stamp (metadata such as "[ar:...]", garbage) are ignored.
/// A line with several stamps is repeated. The result is sorted by time.
pub fn parse_lrc(src: &str) -> Vec<LrcLine> {
    let mut out: Vec<LrcLine> = Vec::new();
    for raw in src.lines() {
        let mut rest = raw.trim_start();
        let mut stamps: Vec<u32> = Vec::new();
        while let Some(after) = rest.strip_prefix('[') {
            let Some(end) = after.find(']') else { break };
            let Some(ms) = parse_stamp(&after[..end]) else {
                break;
            };
            stamps.push(ms);
            rest = after[end + 1..].trim_start();
        }
        if stamps.is_empty() {
            continue;
        }
        let text = clean_text(rest);
        for ms in stamps {
            if out.len() >= MAX_LINES {
                break;
            }
            out.push(LrcLine {
                ms,
                text: text.clone(),
            });
        }
    }
    out.sort_by_key(|l| l.ms);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(ms: u32, text: &str) -> LrcLine {
        LrcLine {
            ms,
            text: text.into(),
        }
    }

    #[test]
    fn parses_stamps_and_fractions() {
        assert_eq!(parse_stamp("00:01"), Some(1000));
        assert_eq!(parse_stamp("00:01.5"), Some(1500));
        assert_eq!(parse_stamp("00:01.05"), Some(1050));
        assert_eq!(parse_stamp("00:01.123"), Some(1123));
        assert_eq!(parse_stamp("00:01,50"), Some(1500));
        assert_eq!(parse_stamp("03:25.10"), Some(205_100));
        for bad in ["", "ar:Someone", "00:61.00", "00:01.1234", "1:2:3", "-1:00", "aa:bb"] {
            assert_eq!(parse_stamp(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn parses_lines() {
        let l = parse_lrc("[00:12.34] one\r\n[01:02.5]two");
        assert_eq!(l, vec![line(12_340, "one"), line(62_500, "two")]);
    }

    #[test]
    fn repeats_lines_with_several_stamps_and_sorts() {
        let l = parse_lrc("[00:20.00][00:10.00]again\n[00:15.00]middle");
        assert_eq!(
            l,
            vec![line(10_000, "again"), line(15_000, "middle"), line(20_000, "again")]
        );
    }

    #[test]
    fn ignores_metadata_and_garbage() {
        let l = parse_lrc("[ar:Someone]\n[length: 03:00]\nplain text\n[99:99.99]x\n[00:01.00]ok");
        assert_eq!(l, vec![line(1000, "ok")]);
        assert!(parse_lrc("").is_empty());
        assert!(parse_lrc("no stamps at all").is_empty());
    }

    #[test]
    fn keeps_empty_lines_and_non_latin_text() {
        let l = parse_lrc("[00:05.00]\n[00:06.00]こんにちは");
        assert_eq!(l, vec![line(5000, ""), line(6000, "こんにちは")]);
    }

    #[test]
    fn strips_control_characters_and_caps_length() {
        let l = parse_lrc("[00:01.00]a\u{0007}b");
        assert_eq!(l, vec![line(1000, "ab")]);
        let long = format!("[00:01.00]{}", "x".repeat(MAX_LINE_CHARS + 50));
        assert_eq!(parse_lrc(&long)[0].text.chars().count(), MAX_LINE_CHARS);
    }

    #[test]
    fn caps_the_number_of_lines() {
        let src: String = (0..MAX_LINES + 10)
            .map(|i| format!("[{:02}:{:02}.00]x\n", (i / 60) % 100, i % 60))
            .collect();
        assert_eq!(parse_lrc(&src).len(), MAX_LINES);
    }
}