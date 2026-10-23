//! Import an existing folder of audio files (H8.4).
//!
//! Files outside the music folder are copied into `Singles\`; files already
//! inside it are registered where they are. Nothing is moved or modified: the
//! tags are only read.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde::Serialize;
use thiserror::Error;

use crate::db::tracks::{self, NewTrack, TrackFilter};
use crate::library::edit::{MAX_TAG_CHARS, clean_tag};
use crate::library::{covers, names, tags};
use crate::paths::AppPaths;

pub const AUDIO_EXTENSIONS: [&str; 7] = ["opus", "m4a", "mp3", "flac", "ogg", "wav", "aac"];
const MAX_FILE_BYTES: u64 = 500 * 1024 * 1024;
pub const MAX_FILES: usize = 10_000;
const MAX_DEPTH: usize = 6;
const UNKNOWN_ARTIST: &str = "Unknown artist";

#[derive(Debug, Error)]
pub enum ScanError {
    #[error("not a folder")]
    NotADirectory,
    #[error("database: {0}")]
    Db(String),
    #[error("i/o: {0}")]
    Io(#[from] std::io::Error),
}

impl ScanError {
    /// Stable code the UI translates with `errors.<code>` (D-99).
    pub fn code(&self) -> &'static str {
        match self {
            ScanError::NotADirectory => "scan.not_a_directory",
            ScanError::Db(_) => "scan.db",
            ScanError::Io(_) => "scan.io",
        }
    }
}

#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanReport {
    /// Audio files seen (by extension).
    pub found: usize,
    pub added: usize,
    /// Already in the library, or repeated inside the folder.
    pub duplicates: usize,
    /// Unreadable, empty, too large or impossible to copy.
    pub failed: usize,
    /// The folder had more than `MAX_FILES` audio files; only the first ones were read.
    pub truncated: bool,
}

fn audio_extension(path: &Path) -> Option<String> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    AUDIO_EXTENSIONS.contains(&ext.as_str()).then_some(ext)
}

/// Audio files under `root` (sorted), skipping hidden folders (".covers"...) and symlinks.
fn collect_audio_files(root: &Path, max_files: usize) -> (Vec<PathBuf>, bool) {
    let mut files = Vec::new();
    let mut truncated = false;
    let mut stack = vec![(root.to_path_buf(), 0usize)];
    'walk: while let Some((dir, depth)) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_symlink() {
                continue;
            }
            let path = entry.path();
            if kind.is_dir() {
                let hidden = entry.file_name().to_string_lossy().starts_with('.');
                if !hidden && depth < MAX_DEPTH {
                    stack.push((path, depth + 1));
                }
            } else if kind.is_file() && audio_extension(&path).is_some() {
                if files.len() >= max_files {
                    truncated = true;
                    break 'walk;
                }
                files.push(path);
            }
        }
    }
    files.sort_by_key(|p| p.to_string_lossy().to_lowercase());
    (files, truncated)
}

struct Described {
    title: String,
    artist: String,
    album: Option<String>,
    duration_ms: i64,
}

fn limit(s: String) -> String {
    let cut: String = s.chars().take(MAX_TAG_CHARS).collect();
    cut.trim_end().to_string()
}

/// Reads the file with lofty (this is what proves it is real audio) and decides
/// title and artist: tags first, then an "Artist - Title" file name.
fn describe(path: &Path) -> Option<Described> {
    let info = tags::read_info(path).ok()?;
    let duration_ms = i64::try_from(info.duration_ms).unwrap_or(0);
    let clean = |s: String| Some(clean_tag(&s)).filter(|c| !c.is_empty());
    let title_tag = info.title.and_then(clean);
    let artist_tag = info.artist.and_then(clean);
    let album = info.album.and_then(clean).map(limit);

    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .map(clean_tag)
        .unwrap_or_default();
    let from_name = stem
        .split_once(" - ")
        .map(|(a, t)| (a.trim().to_string(), t.trim().to_string()))
        .filter(|(a, t)| !a.is_empty() && !t.is_empty());

    let (title, artist) = match (title_tag, artist_tag) {
        (Some(t), Some(a)) => (t, a),
        (t, a) => match from_name {
            Some((name_artist, name_title)) => (t.unwrap_or(name_title), a.unwrap_or(name_artist)),
            None => (
                t.unwrap_or_else(|| stem.clone()),
                a.unwrap_or_else(|| UNKNOWN_ARTIST.to_string()),
            ),
        },
    };
    let (title, artist) = (limit(title), limit(artist));
    if title.is_empty() || artist.is_empty() {
        return None;
    }
    Some(Described {
        title,
        artist,
        album,
        duration_ms,
    })
}

fn lower_path(p: &Path) -> String {
    p.to_string_lossy().to_lowercase()
}

fn identity(artist: &str, title: &str) -> String {
    format!("{}\u{1}{}", artist.to_lowercase(), title.to_lowercase())
}

/// Lowercase file stems found in a folder (any extension).
fn stems_in(dir: &Path) -> HashSet<String> {
    fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            e.path()
                .file_stem()
                .map(|s| s.to_string_lossy().to_lowercase())
        })
        .collect()
}

/// Copies `src` to `Singles\<Artist - Title>.<ext>` through a ".part" file.
fn copy_into_singles(
    paths: &AppPaths,
    src: &Path,
    ext: &str,
    stems: &mut HashSet<String>,
    artist: &str,
    title: &str,
) -> std::io::Result<PathBuf> {
    let base = names::track_file_stem(None, artist, title);
    let stem = names::unique_name(
        &base,
        |n| stems.contains(&n.to_lowercase()),
        names::MAX_FILE_STEM_CHARS,
    );
    let dest = paths.singles_dir.join(format!("{stem}.{ext}"));
    if !names::is_inside(&paths.music_dir, &dest) {
        return Err(std::io::Error::other("unsafe destination"));
    }
    let tmp = paths.singles_dir.join(format!("{stem}.{ext}.part"));
    if let Err(e) = fs::copy(src, &tmp).and_then(|_| fs::rename(&tmp, &dest)) {
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }
    stems.insert(stem.to_lowercase());
    Ok(dest)
}

pub fn scan_folder(
    conn: &Connection,
    paths: &AppPaths,
    root: &Path,
) -> Result<ScanReport, ScanError> {
    scan_folder_limited(conn, paths, root, MAX_FILES)
}

fn scan_folder_limited(
    conn: &Connection,
    paths: &AppPaths,
    root: &Path,
    max_files: usize,
) -> Result<ScanReport, ScanError> {
    if !root.is_dir() {
        return Err(ScanError::NotADirectory);
    }
    fs::create_dir_all(&paths.singles_dir)?;

    let existing =
        tracks::list(conn, &TrackFilter::default()).map_err(|e| ScanError::Db(e.to_string()))?;
    let mut known_paths: HashSet<String> = HashSet::new();
    let mut known_ids: HashSet<String> = HashSet::new();
    for t in &existing {
        if let Some(p) = t.file_path.as_deref() {
            known_paths.insert(lower_path(Path::new(p)));
            known_ids.insert(identity(&t.artist, &t.title));
        }
    }
    let mut stems = stems_in(&paths.singles_dir);
    stems.extend(stems_in(&paths.singles_dir.join(covers::COVERS_DIR)));

    let (files, truncated) = collect_audio_files(root, max_files);
    let mut report = ScanReport {
        truncated,
        ..ScanReport::default()
    };

    for path in files {
        report.found += 1;
        let Some(ext) = audio_extension(&path) else {
            continue;
        };
        match fs::metadata(&path) {
            Ok(m) if m.len() > 0 && m.len() <= MAX_FILE_BYTES => {}
            _ => {
                report.failed += 1;
                continue;
            }
        }

        let in_place = names::is_inside(&paths.music_dir, &path);
        if in_place && known_paths.contains(&lower_path(&path)) {
            report.duplicates += 1;
            continue;
        }
        let Some(d) = describe(&path) else {
            report.failed += 1;
            continue;
        };
        let id = identity(&d.artist, &d.title);
        if known_ids.contains(&id) {
            report.duplicates += 1;
            continue;
        }

        let final_path = if in_place {
            path.clone()
        } else {
            match copy_into_singles(paths, &path, &ext, &mut stems, &d.artist, &d.title) {
                Ok(p) => p,
                Err(_) => {
                    report.failed += 1;
                    continue;
                }
            }
        };

        let mut row = NewTrack::basic(&d.title, &d.artist, d.duration_ms);
        row.album = d.album;
        row.file_path = Some(final_path.to_string_lossy().into_owned());
        row.status = "done".into();
        if tracks::insert(conn, &row).is_err() {
            if !in_place {
                let _ = fs::remove_file(&final_path);
            }
            report.failed += 1;
            continue;
        }
        known_ids.insert(id);
        known_paths.insert(lower_path(&final_path));
        report.added += 1;
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;

    struct Fx {
        root: PathBuf,
        paths: AppPaths,
        db: Database,
    }

    impl Fx {
        fn new() -> Self {
            let root =
                std::env::temp_dir().join(format!("cupid-scan-test-{}", uuid::Uuid::new_v4()));
            let paths = AppPaths::new(&root.join("data"), &root.join("CupidPlayer"));
            fs::create_dir_all(&paths.singles_dir).expect("create dirs");
            Self {
                root,
                paths,
                db: Database::open_in_memory().expect("db"),
            }
        }

        fn source(&self) -> PathBuf {
            let dir = self.root.join("source");
            fs::create_dir_all(&dir).expect("source dir");
            dir
        }

        /// Copy of the 1-second opus fixture, optionally tagged as (title, artist).
        fn audio(&self, dir: &Path, name: &str, tag: Option<(&str, &str)>) -> PathBuf {
            fs::create_dir_all(dir).expect("create dir");
            let src = Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("tests")
                .join("fixtures")
                .join("silence.opus");
            let dst = dir.join(name);
            fs::copy(src, &dst).expect("copy fixture");
            if let Some((title, artist)) = tag {
                tags::write_basic_tags(&dst, title, artist, None).expect("tag fixture");
            }
            dst
        }

        fn singles(&self) -> Vec<String> {
            let mut names: Vec<String> = fs::read_dir(&self.paths.singles_dir)
                .expect("read singles")
                .flatten()
                .filter(|e| e.path().is_file())
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect();
            names.sort();
            names
        }
    }

    impl Drop for Fx {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn scan(fx: &Fx, root: &Path) -> ScanReport {
        let conn = fx.db.conn().expect("conn");
        scan_folder(&conn, &fx.paths, root).expect("scan")
    }

    fn all_tracks(fx: &Fx) -> Vec<tracks::Track> {
        let conn = fx.db.conn().expect("conn");
        tracks::list(&conn, &TrackFilter::default()).expect("list")
    }

    #[test]
    fn copies_files_into_singles_and_registers_them() {
        let fx = Fx::new();
        let src = fx.source();
        let a = fx.audio(&src, "a.opus", Some(("Nada", "Amaia")));
        fx.audio(
            &src.join("sub"),
            "b.opus",
            Some(("Scars", "Car, the garden")),
        );

        let r = scan(&fx, &src);
        assert_eq!(
            r,
            ScanReport {
                found: 2,
                added: 2,
                duplicates: 0,
                failed: 0,
                truncated: false
            }
        );
        assert_eq!(
            fx.singles(),
            ["Amaia - Nada.opus", "Car, the garden - Scars.opus"]
        );
        assert!(a.is_file(), "the original is untouched");

        let rows = all_tracks(&fx);
        assert_eq!(rows.len(), 2);
        for t in &rows {
            assert_eq!(t.status, "done");
            assert!((900..=1100).contains(&t.duration_ms), "{}", t.duration_ms);
            assert!(
                t.file_path
                    .as_deref()
                    .is_some_and(|p| Path::new(p).is_file())
            );
        }
    }

    #[test]
    fn scanning_twice_adds_nothing_new() {
        let fx = Fx::new();
        let src = fx.source();
        fx.audio(&src, "a.opus", Some(("Nada", "Amaia")));
        fx.audio(&src, "b.opus", Some(("Scars", "Car, the garden")));
        scan(&fx, &src);
        let r = scan(&fx, &src);
        assert_eq!((r.added, r.duplicates, r.failed), (0, 2, 0));
        assert_eq!(fx.singles().len(), 2);
        assert_eq!(all_tracks(&fx).len(), 2);
    }

    #[test]
    fn untagged_files_use_the_file_name() {
        let fx = Fx::new();
        let src = fx.source();
        fx.audio(&src, "Rhea Ober - Selfish.opus", None);
        fx.audio(&src, "plain.opus", None);
        let r = scan(&fx, &src);
        assert_eq!(r.added, 2);
        let rows = all_tracks(&fx);
        let find = |title: &str| rows.iter().find(|t| t.title == title).expect(title);
        assert_eq!(find("Selfish").artist, "Rhea Ober");
        assert_eq!(find("plain").artist, UNKNOWN_ARTIST);
        assert_eq!(
            fx.singles(),
            ["Rhea Ober - Selfish.opus", "Unknown artist - plain.opus"]
        );
    }

    #[test]
    fn files_already_in_the_music_folder_are_registered_in_place() {
        let fx = Fx::new();
        let playlist_dir = fx.paths.playlists_dir.join("Mix");
        let file = fx.audio(&playlist_dir, "01 - X - Y.opus", Some(("Y", "X")));

        let r = scan(&fx, &fx.paths.music_dir);
        assert_eq!((r.found, r.added), (1, 1));
        assert!(fx.singles().is_empty(), "nothing is copied");
        let rows = all_tracks(&fx);
        assert_eq!(
            rows[0].file_path.as_deref(),
            Some(file.to_string_lossy().as_ref())
        );

        let again = scan(&fx, &fx.paths.music_dir);
        assert_eq!((again.added, again.duplicates), (0, 1));
    }

    #[test]
    fn the_same_song_in_two_folders_is_added_once() {
        let fx = Fx::new();
        let src = fx.source();
        fx.audio(&src.join("one"), "x.opus", Some(("Nada", "Amaia")));
        fx.audio(&src.join("two"), "y.opus", Some(("NADA", "amaia")));
        let r = scan(&fx, &src);
        assert_eq!((r.found, r.added, r.duplicates), (2, 1, 1));
    }

    #[test]
    fn a_song_already_in_the_library_is_a_duplicate() {
        let fx = Fx::new();
        {
            let conn = fx.db.conn().expect("conn");
            let mut t = NewTrack::basic("Nada", "Amaia", 1000);
            t.file_path = Some("C:\\somewhere\\old.opus".into());
            t.status = "done".into();
            tracks::insert(&conn, &t).expect("insert");
        }
        let src = fx.source();
        fx.audio(&src, "a.opus", Some(("Nada", "Amaia")));
        let r = scan(&fx, &src);
        assert_eq!((r.added, r.duplicates), (0, 1));
        assert!(fx.singles().is_empty());
    }

    #[test]
    fn names_that_sanitize_to_the_same_stem_get_a_suffix() {
        let fx = Fx::new();
        let src = fx.source();
        fx.audio(&src, "1.opus", Some(("T", "AC/DC")));
        fx.audio(&src, "2.opus", Some(("T", "AC_DC")));
        let r = scan(&fx, &src);
        assert_eq!(r.added, 2);
        assert_eq!(fx.singles(), ["AC_DC - T (2).opus", "AC_DC - T.opus"]);
    }

    #[test]
    fn unreadable_files_are_counted_and_other_files_are_ignored() {
        let fx = Fx::new();
        let src = fx.source();
        fs::write(src.join("fake.mp3"), b"this is not audio").expect("fake");
        fs::write(src.join("empty.opus"), b"").expect("empty");
        fs::write(src.join("notes.txt"), b"text").expect("txt");
        fs::write(src.join("cover.jpg"), b"jpg").expect("jpg");
        fx.audio(&src.join(".covers"), "hidden.opus", Some(("H", "H")));
        fx.audio(&src, "ok.opus", Some(("Nada", "Amaia")));

        let r = scan(&fx, &src);
        assert_eq!(
            r,
            ScanReport {
                found: 3,
                added: 1,
                duplicates: 0,
                failed: 2,
                truncated: false
            }
        );
        assert_eq!(fx.singles(), ["Amaia - Nada.opus"]);
    }

    #[test]
    fn stops_at_the_file_limit_and_reports_it() {
        let fx = Fx::new();
        let src = fx.source();
        for i in 0..3 {
            fx.audio(&src, &format!("{i}.opus"), Some((&format!("T{i}"), "A")));
        }
        let conn = fx.db.conn().expect("conn");
        let r = scan_folder_limited(&conn, &fx.paths, &src, 2).expect("scan");
        assert_eq!((r.found, r.added, r.truncated), (2, 2, true));
    }

    #[test]
    fn rejects_something_that_is_not_a_folder() {
        let fx = Fx::new();
        let file = fx.audio(&fx.source(), "a.opus", None);
        let conn = fx.db.conn().expect("conn");
        assert!(matches!(
            scan_folder(&conn, &fx.paths, &file),
            Err(ScanError::NotADirectory)
        ));
        assert!(matches!(
            scan_folder(&conn, &fx.paths, &fx.root.join("missing")),
            Err(ScanError::NotADirectory)
        ));
    }
}
