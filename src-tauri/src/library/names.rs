//! Safe file and folder names, and a lexical "is inside" path check.
//! Anything that comes from Spotify or YouTube goes through here before it
//! becomes part of a path.

use std::path::{Component, Path};

pub const MAX_FOLDER_CHARS: usize = 60;
pub const MAX_FILE_STEM_CHARS: usize = 90;

const FORBIDDEN: [char; 9] = ['\\', '/', ':', '*', '?', '"', '<', '>', '|'];
const RESERVED: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Control characters plus invisible/bidi characters that could disguise a name
/// (e.g. U+202E reversing the extension).
fn is_invisible(c: char) -> bool {
    c.is_control()
        || matches!(
            c,
            '\u{200B}'..='\u{200F}'
                | '\u{2028}'..='\u{202E}'
                | '\u{2060}'..='\u{2064}'
                | '\u{2066}'..='\u{2069}'
                | '\u{FEFF}'
        )
}

/// Windows reserves these names with or without an extension ("nul.txt").
fn is_reserved(name: &str) -> bool {
    let base = name.split('.').next().unwrap_or(name).trim_end();
    RESERVED.iter().any(|r| r.eq_ignore_ascii_case(base))
}

fn trim_dots_and_spaces(s: &str) -> &str {
    s.trim_matches(|c: char| c == ' ' || c == '.')
}

/// One path component (a file stem or a folder name), safe on Windows:
/// forbidden characters become '_', whitespace is collapsed, leading/trailing
/// dots and spaces are dropped, reserved names get a '_' prefix and the length
/// is capped. Never returns an empty string.
pub fn sanitize_component(input: &str, max_chars: usize) -> String {
    let mut out = String::with_capacity(input.len());
    let mut last_was_space = true;
    for c in input.chars() {
        if is_invisible(c) {
            continue;
        }
        if c.is_whitespace() {
            if !last_was_space {
                out.push(' ');
                last_was_space = true;
            }
            continue;
        }
        out.push(if FORBIDDEN.contains(&c) { '_' } else { c });
        last_was_space = false;
    }
    let capped: String = trim_dots_and_spaces(&out).chars().take(max_chars).collect();
    let mut name = trim_dots_and_spaces(&capped).to_string();
    if name.is_empty() {
        return "untitled".to_string();
    }
    if is_reserved(&name) {
        name.insert(0, '_');
    }
    name
}

/// True when `s` is already exactly what `sanitize_component` would produce.
pub fn is_safe_component(s: &str, max_chars: usize) -> bool {
    !s.is_empty() && sanitize_component(s, max_chars) == s
}

/// "Artist - Title" for singles, "03 - Artist - Title" inside a playlist.
pub fn track_file_stem(position: Option<u32>, artist: &str, title: &str) -> String {
    let name = if artist.trim().is_empty() {
        title.to_string()
    } else {
        format!("{artist} - {title}")
    };
    let raw = match position {
        Some(p) => format!("{p:02} - {name}"),
        None => name,
    };
    sanitize_component(&raw, MAX_FILE_STEM_CHARS)
}

/// `base` if free, otherwise "base (2)", "base (3)"... The total length never
/// exceeds `max_chars`. `taken` decides what counts as already used (e.g. a
/// case-insensitive comparison on Windows).
pub fn unique_name(base: &str, taken: impl Fn(&str) -> bool, max_chars: usize) -> String {
    if !taken(base) {
        return base.to_string();
    }
    for n in 2..10_000u32 {
        let suffix = format!(" ({n})");
        let keep = max_chars.saturating_sub(suffix.chars().count());
        let head: String = base.chars().take(keep).collect();
        let candidate = format!("{}{suffix}", trim_dots_and_spaces(&head));
        if !taken(&candidate) {
            return candidate;
        }
    }
    let id = uuid::Uuid::new_v4().simple().to_string();
    sanitize_component(&format!("{base} {}", &id[..8]), max_chars)
}

/// Lexical check (the path may not exist yet): `candidate` is under `root` and
/// has no ".." component. Symlinks are not resolved.
pub fn is_inside(root: &Path, candidate: &Path) -> bool {
    candidate.starts_with(root)
        && !candidate
            .components()
            .any(|c| matches!(c, Component::ParentDir))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_forbidden_characters_and_whitespace() {
        assert_eq!(
            sanitize_component("a/b\\c:d*e?f\"g<h>i|j", 50),
            "a_b_c_d_e_f_g_h_i_j"
        );
        assert_eq!(sanitize_component("  Hello   world  ", 50), "Hello world");
        assert_eq!(sanitize_component("name. ", 50), "name");
        assert_eq!(sanitize_component("AC/DC", 50), "AC_DC");
    }

    #[test]
    fn strips_dots_and_falls_back_to_untitled() {
        assert_eq!(sanitize_component("..hidden", 50), "hidden");
        assert_eq!(sanitize_component("...", 50), "untitled");
        assert_eq!(sanitize_component("", 50), "untitled");
        assert_eq!(sanitize_component("   ", 50), "untitled");
        assert_eq!(sanitize_component("..", 50), "untitled");
    }

    #[test]
    fn prefixes_windows_reserved_names() {
        assert_eq!(sanitize_component("CON", 50), "_CON");
        assert_eq!(sanitize_component("nul.txt", 50), "_nul.txt");
        assert_eq!(sanitize_component("Com1", 50), "_Com1");
        assert_eq!(sanitize_component("LPT9.log", 50), "_LPT9.log");
        assert_eq!(sanitize_component("console", 50), "console");
        assert_eq!(sanitize_component("COM10", 50), "COM10");
    }

    #[test]
    fn removes_invisible_and_control_characters() {
        assert_eq!(
            sanitize_component("a\u{202E}b\u{0007}c\u{200B}d", 50),
            "abcd"
        );
    }

    #[test]
    fn truncates_without_leaving_trailing_dots() {
        assert_eq!(
            sanitize_component(&"a".repeat(200), 100).chars().count(),
            100
        );
        let tricky = format!("{}. b", "a".repeat(99));
        assert_eq!(sanitize_component(&tricky, 100), "a".repeat(99));
    }

    #[test]
    fn keeps_unicode_and_is_idempotent() {
        assert_eq!(sanitize_component("腹芸 ~ 🎧 C’est", 50), "腹芸 ~ 🎧 C’est");
        for s in [
            "a/b",
            "CON",
            "..x..",
            "  y  ",
            "腹芸",
            "T.N.T.",
            &"x".repeat(300),
        ] {
            let once = sanitize_component(s, 60);
            assert_eq!(sanitize_component(&once, 60), once, "{s}");
        }
    }

    #[test]
    fn is_safe_component_rejects_unsanitized_names() {
        assert!(is_safe_component(
            "Car, the garden - Scars",
            MAX_FILE_STEM_CHARS
        ));
        assert!(!is_safe_component("a/b", MAX_FILE_STEM_CHARS));
        assert!(!is_safe_component("..", MAX_FILE_STEM_CHARS));
        assert!(!is_safe_component("CON", MAX_FILE_STEM_CHARS));
        assert!(!is_safe_component("name.", MAX_FILE_STEM_CHARS));
        assert!(!is_safe_component("", MAX_FILE_STEM_CHARS));
        assert!(!is_safe_component(
            &"a".repeat(MAX_FILE_STEM_CHARS + 1),
            MAX_FILE_STEM_CHARS
        ));
    }

    #[test]
    fn builds_track_file_stems() {
        assert_eq!(
            track_file_stem(Some(3), "Car, the garden", "Scars leave beautiful trace"),
            "03 - Car, the garden - Scars leave beautiful trace"
        );
        assert_eq!(
            track_file_stem(None, "Amaia", "C’est La Vie"),
            "Amaia - C’est La Vie"
        );
        assert_eq!(track_file_stem(Some(105), "A", "B"), "105 - A - B");
        assert_eq!(track_file_stem(None, "", "Title"), "Title");
        assert_eq!(track_file_stem(None, "AC/DC", "T.N.T."), "AC_DC - T.N.T");
        assert_eq!(
            track_file_stem(None, "A", "100% Pure Love"),
            "A - 100% Pure Love"
        );
        let long = track_file_stem(Some(1), &"a".repeat(200), &"b".repeat(200));
        assert!(long.chars().count() <= MAX_FILE_STEM_CHARS);
    }

    #[test]
    fn unique_name_adds_numeric_suffixes() {
        assert_eq!(unique_name("Mix", |_| false, 60), "Mix");
        assert_eq!(unique_name("Mix", |n| n == "Mix", 60), "Mix (2)");
        assert_eq!(
            unique_name("Mix", |n| n == "Mix" || n == "Mix (2)", 60),
            "Mix (3)"
        );
        let ci = |n: &str| n.eq_ignore_ascii_case("mix");
        assert_eq!(unique_name("Mix", ci, 60), "Mix (2)");
        let long = "a".repeat(60);
        let out = unique_name(&long, |n| n == long, 60);
        assert!(out.chars().count() <= 60 && out.ends_with(" (2)"));
        assert!(is_safe_component(&out, 60));
    }

    #[test]
    fn is_inside_rejects_other_roots_and_parent_dirs() {
        let root = std::env::temp_dir().join("CupidPlayer");
        assert!(is_inside(&root, &root.join("Singles").join("a.opus")));
        assert!(is_inside(&root, &root));
        assert!(!is_inside(
            &root,
            &std::env::temp_dir().join("Other").join("a.opus")
        ));
        assert!(!is_inside(&root, &root.join("..").join("x.opus")));
        assert!(!is_inside(
            &root,
            &root.join("Singles").join("..").join("..").join("x")
        ));
    }
}
