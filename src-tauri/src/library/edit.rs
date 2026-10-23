//! Library edits (H8): change tags, set a cover, delete a track and fix missing
//! durations. Every file touched must lie inside the music folder
//! (`names::is_inside`); otherwise nothing is written or deleted.

use std::io::Read;
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde::Deserialize;
use thiserror::Error;

use crate::db::tracks::{self, Track};
use crate::error::AppError;
use crate::library::{covers, names, tags};

pub const MAX_TAG_CHARS: usize = 200;
/// Staged covers live in `.covers\pending-<id>.<ext>` until the edit dialog is saved.
pub(crate) const PENDING_PREFIX: &str = "pending-";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagsInput {
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
}

#[derive(Debug, Error)]
pub enum EditError {
    #[error("track not found")]
    NotFound,
    #[error("invalid or empty text")]
    InvalidText,
    #[error("the track has no file")]
    NoFile,
    #[error("no staged cover")]
    NoStagedCover,
    #[error("file is outside the music folder")]
    OutsideMusicDir,
    #[error("tags: {0}")]
    Tags(#[from] tags::TagError),
    #[error("cover: {0}")]
    Cover(#[from] covers::CoverError),
    #[error("database: {0}")]
    Db(String),
    #[error("i/o: {0}")]
    Io(#[from] std::io::Error),
}

impl EditError {
    /// Stable code the UI translates with `errors.<code>` (D-99).
    pub fn code(&self) -> &'static str {
        match self {
            EditError::NotFound => "library.not_found",
            EditError::InvalidText => "library.invalid_text",
            EditError::NoFile => "library.no_file",
            EditError::NoStagedCover => "library.no_staged_cover",
            EditError::OutsideMusicDir => "library.outside_music",
            EditError::Tags(_) => "library.tags_failed",
            EditError::Cover(covers::CoverError::NotAnImage) => "library.cover_invalid",
            EditError::Cover(covers::CoverError::TooLarge) => "library.cover_too_large",
            EditError::Cover(_) => "library.cover_failed",
            EditError::Io(_) => "library.io",
            EditError::Db(_) => "library.db",
        }
    }
}

fn db_err(e: AppError) -> EditError {
    EditError::Db(e.to_string())
}

fn is_invisible(c: char) -> bool {
    c.is_control()
        || matches!(
            c,
            '\u{200B}'..='\u{200F}'
                | '\u{202A}'..='\u{202E}'
                | '\u{2060}'..='\u{2064}'
                | '\u{2066}'..='\u{2069}'
                | '\u{FEFF}'
        )
}

/// Collapses whitespace, drops control and invisible characters, trims.
pub(crate) fn clean_tag(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut pending_space = false;
    for c in input.chars() {
        if c.is_whitespace() {
            pending_space = !out.is_empty();
            continue;
        }
        if is_invisible(c) {
            continue;
        }
        if pending_space {
            out.push(' ');
            pending_space = false;
        }
        out.push(c);
    }
    out
}

/// The track's file when it is set, lies inside the music folder and exists.
/// `Err` if the path points outside the music folder.
fn music_file(music_dir: &Path, track: &Track) -> Result<Option<PathBuf>, EditError> {
    let Some(p) = track.file_path.as_deref() else {
        return Ok(None);
    };
    let path = PathBuf::from(p);
    if !names::is_inside(music_dir, &path) {
        return Err(EditError::OutsideMusicDir);
    }
    Ok(path.is_file().then_some(path))
}

fn load(conn: &Connection, id: i64) -> Result<Track, EditError> {
    tracks::get(conn, id)
        .map_err(db_err)?
        .ok_or(EditError::NotFound)
}

/// Updates title, artist and album in the database and, when the file exists,
/// in its tags. The file is written first: if that fails, the database is untouched.
/// The file name is never changed (it would break the queue and the asset scope).
pub fn update_tags(
    conn: &Connection,
    music_dir: &Path,
    id: i64,
    input: &TagsInput,
) -> Result<Track, EditError> {
    let title = clean_tag(&input.title);
    let artist = clean_tag(&input.artist);
    let album = input
        .album
        .as_deref()
        .map(clean_tag)
        .filter(|a| !a.is_empty());
    let longest = [
        title.chars().count(),
        artist.chars().count(),
        album.as_deref().map_or(0, |a| a.chars().count()),
    ]
    .into_iter()
    .max()
    .unwrap_or(0);
    if title.is_empty() || artist.is_empty() || longest > MAX_TAG_CHARS {
        return Err(EditError::InvalidText);
    }

    let track = load(conn, id)?;
    if let Some(file) = music_file(music_dir, &track)? {
        tags::write_basic_tags(&file, &title, &artist, album.as_deref())?;
    }
    tracks::update_meta(conn, id, &title, &artist, album.as_deref()).map_err(db_err)?;
    load(conn, id)
}

/// Reads an image chosen by the user: size is checked before reading and the
/// type by its first bytes (JPEG/PNG, up to 2 MB).
fn read_image_file(path: &Path) -> Result<covers::Image, EditError> {
    let meta = std::fs::metadata(path)?;
    if !meta.is_file() {
        return Err(covers::CoverError::NotAnImage.into());
    }
    let max = covers::MAX_IMAGE_BYTES as u64;
    if meta.len() > max {
        return Err(covers::CoverError::TooLarge.into());
    }
    let mut buf = Vec::new();
    std::fs::File::open(path)?
        .take(max + 1)
        .read_to_end(&mut buf)?;
    Ok(covers::accept_image(buf)?)
}

/// Deletes a cover file only if it lives in a ".covers" folder inside the music
/// folder and no other track uses it (a playlist's `cover.jpg` is never touched).
fn remove_cover_if_unused(conn: &Connection, music_dir: &Path, cover: &str, except_id: i64) {
    let path = Path::new(cover);
    let in_covers_dir = path
        .parent()
        .and_then(|p| p.file_name())
        .is_some_and(|n| n.to_str() == Some(covers::COVERS_DIR));
    if !in_covers_dir || !names::is_inside(music_dir, path) {
        return;
    }
    if matches!(tracks::count_cover_uses(conn, cover, except_id), Ok(0)) {
        let _ = std::fs::remove_file(path);
    }
}

/// Copies the chosen image to `<track folder>\.covers\<file name>.<ext>` and
/// stores that path. The cover is not embedded in the audio (D-95).
pub fn set_cover_from_path(
    conn: &Connection,
    music_dir: &Path,
    id: i64,
    image_path: &Path,
) -> Result<Track, EditError> {
    let track = load(conn, id)?;
    let file = music_file(music_dir, &track)?.ok_or(EditError::NoFile)?;
    let image = read_image_file(image_path)?;

    let dest_dir = file.parent().ok_or(EditError::NoFile)?;
    let stem = file
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or(EditError::NoFile)?;
    let stem = names::sanitize_component(stem, names::MAX_FILE_STEM_CHARS);

    let new_path = covers::store_track_cover(dest_dir, &stem, &image)?;
    let new_str = new_path.to_string_lossy().into_owned();
    if let Some(old) = track.cover_path.as_deref()
        && old != new_str
    {
        remove_cover_if_unused(conn, music_dir, old, id);
    }
    tracks::set_cover_path(conn, id, &new_str).map_err(db_err)?;
    load(conn, id)
}

/// Removes the row and, when `delete_file` is true, the audio file and its own
/// cover. The file goes first: if it cannot be deleted (e.g. locked while
/// playing) the row stays and nothing is lost.
pub fn delete_track(
    conn: &Connection,
    music_dir: &Path,
    id: i64,
    delete_file: bool,
) -> Result<(), EditError> {
    let track = load(conn, id)?;
    if delete_file {
        if let Some(file) = music_file(music_dir, &track)? {
            std::fs::remove_file(&file)?;
        }
        if let Some(cover) = track.cover_path.as_deref() {
            remove_cover_if_unused(conn, music_dir, cover, id);
        }
    }
    tracks::delete(conn, id).map_err(db_err)
}

/// Absolute path of the track's audio file, if it exists inside the music folder.
pub fn locate(conn: &Connection, music_dir: &Path, id: i64) -> Result<PathBuf, EditError> {
    let track = load(conn, id)?;
    music_file(music_dir, &track)?.ok_or(EditError::NoFile)
}

fn staged_paths(dest_dir: &Path, id: i64) -> [PathBuf; 2] {
    let dir = dest_dir.join(covers::COVERS_DIR);
    [covers::ImageKind::Jpeg, covers::ImageKind::Png]
        .map(|k| dir.join(format!("{PENDING_PREFIX}{id}.{}", k.extension())))
}

fn discard_staged_in(dest_dir: &Path, id: i64) {
    for p in staged_paths(dest_dir, id) {
        let _ = std::fs::remove_file(p);
    }
}

/// The folder where the track's covers live: the folder of its audio file.
fn cover_home(music_dir: &Path, track: &Track) -> Result<PathBuf, EditError> {
    let file = music_file(music_dir, track)?.ok_or(EditError::NoFile)?;
    Ok(file.parent().ok_or(EditError::NoFile)?.to_path_buf())
}

/// Validates the image and saves it as a *staged* cover without touching the
/// track. Nothing changes until `commit_staged_cover`. A previous staged cover
/// of the same track is replaced.
pub fn stage_cover_from_path(
    conn: &Connection,
    music_dir: &Path,
    id: i64,
    image_path: &Path,
) -> Result<PathBuf, EditError> {
    let track = load(conn, id)?;
    let dest_dir = cover_home(music_dir, &track)?;
    let image = read_image_file(image_path)?;
    discard_staged_in(&dest_dir, id);
    Ok(covers::store_track_cover(
        &dest_dir,
        &format!("{PENDING_PREFIX}{id}"),
        &image,
    )?)
}

/// Turns the staged cover into the track's real cover (and removes the staged copy).
pub fn commit_staged_cover(
    conn: &Connection,
    music_dir: &Path,
    id: i64,
) -> Result<Track, EditError> {
    let track = load(conn, id)?;
    let dest_dir = cover_home(music_dir, &track)?;
    let staged = staged_paths(&dest_dir, id)
        .into_iter()
        .find(|p| p.is_file())
        .ok_or(EditError::NoStagedCover)?;
    let result = set_cover_from_path(conn, music_dir, id, &staged);
    discard_staged_in(&dest_dir, id);
    result
}

/// Forgets the staged cover; the track keeps whatever cover it had.
pub fn discard_staged_cover(conn: &Connection, music_dir: &Path, id: i64) -> Result<(), EditError> {
    let track = load(conn, id)?;
    if let Ok(dir) = cover_home(music_dir, &track) {
        discard_staged_in(&dir, id);
    }
    Ok(())
}

/// Fills `duration_ms` for tracks stored with 0 using the real length of the
/// file. Returns how many were fixed.
pub fn backfill_durations(conn: &Connection, music_dir: &Path) -> Result<usize, EditError> {
    let missing = tracks::list_missing_durations(conn).map_err(db_err)?;
    let mut fixed = 0;
    for (id, file) in missing {
        let path = PathBuf::from(file);
        if !names::is_inside(music_dir, &path) || !path.is_file() {
            continue;
        }
        let Ok(info) = tags::read_info(&path) else {
            continue;
        };
        let Ok(ms) = i64::try_from(info.duration_ms) else {
            continue;
        };
        if ms > 0 {
            tracks::set_duration(conn, id, ms).map_err(db_err)?;
            fixed += 1;
        }
    }
    Ok(fixed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;
    use crate::db::tracks::NewTrack;

    const JPEG: [u8; 6] = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10];
    const PNG: [u8; 10] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0];

    struct Fx {
        root: PathBuf,
        music: PathBuf,
        singles: PathBuf,
        db: Database,
    }

    impl Fx {
        fn new() -> Self {
            let root =
                std::env::temp_dir().join(format!("cupid-edit-test-{}", uuid::Uuid::new_v4()));
            let music = root.join("CupidPlayer");
            let singles = music.join("Singles");
            std::fs::create_dir_all(&singles).expect("create dirs");
            Self {
                root,
                music,
                singles,
                db: Database::open_in_memory().expect("db"),
            }
        }

        /// Copy of the 1-second opus fixture inside `dir`.
        fn audio_in(&self, dir: &Path, name: &str) -> PathBuf {
            std::fs::create_dir_all(dir).expect("create dir");
            let src = Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("tests")
                .join("fixtures")
                .join("silence.opus");
            let dst = dir.join(name);
            std::fs::copy(src, &dst).expect("copy fixture");
            dst
        }

        fn audio(&self, name: &str) -> PathBuf {
            self.audio_in(&self.singles, name)
        }
    }

    impl Drop for Fx {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    fn add_track(conn: &Connection, file: Option<&Path>, duration_ms: i64) -> i64 {
        let mut t = NewTrack::basic("Old title", "Old artist", duration_ms);
        t.status = "done".into();
        t.file_path = file.map(|f| f.to_string_lossy().into_owned());
        tracks::insert(conn, &t).expect("insert")
    }

    fn row(conn: &Connection, id: i64) -> Track {
        tracks::get(conn, id).expect("get").expect("row")
    }

    fn input(title: &str, artist: &str, album: Option<&str>) -> TagsInput {
        TagsInput {
            title: title.into(),
            artist: artist.into(),
            album: album.map(String::from),
        }
    }

    #[test]
    fn update_tags_writes_the_file_and_the_database() {
        let fx = Fx::new();
        let conn = fx.db.conn().expect("conn");
        let file = fx.audio("A - B.opus");
        let id = add_track(&conn, Some(&file), 1000);

        let t = update_tags(
            &conn,
            &fx.music,
            id,
            &input("  New   Title ", "Car, the garden", Some(" Alb ")),
        )
        .expect("update");
        assert_eq!(t.title, "New Title");
        assert_eq!(t.artist, "Car, the garden");
        assert_eq!(t.album.as_deref(), Some("Alb"));

        let info = tags::read_info(&file).expect("read");
        assert_eq!(info.title.as_deref(), Some("New Title"));
        assert_eq!(info.artist.as_deref(), Some("Car, the garden"));
        assert_eq!(info.album.as_deref(), Some("Alb"));
        assert!(file.is_file(), "the file keeps its name");

        let t = update_tags(&conn, &fx.music, id, &input("Two", "B", Some("   "))).expect("again");
        assert_eq!(t.album, None);
        assert_eq!(tags::read_info(&file).expect("read").album, None);
    }

    #[test]
    fn update_tags_rejects_empty_and_too_long_text() {
        let fx = Fx::new();
        let conn = fx.db.conn().expect("conn");
        let id = add_track(&conn, None, 1000);
        let long = "a".repeat(MAX_TAG_CHARS + 1);
        for bad in [
            input("   ", "A", None),
            input("T", "\u{200B}\u{0007}", None),
            input(&long, "A", None),
            input("T", &long, None),
            input("T", "A", Some(&long)),
        ] {
            assert!(matches!(
                update_tags(&conn, &fx.music, id, &bad),
                Err(EditError::InvalidText)
            ));
        }
        assert_eq!(row(&conn, id).title, "Old title");
        let ok = "a".repeat(MAX_TAG_CHARS);
        assert!(update_tags(&conn, &fx.music, id, &input(&ok, "A", None)).is_ok());
    }

    #[test]
    fn update_tags_without_a_file_only_touches_the_database() {
        let fx = Fx::new();
        let conn = fx.db.conn().expect("conn");
        let id = add_track(&conn, None, 1000);
        let t = update_tags(&conn, &fx.music, id, &input("T", "A", None)).expect("update");
        assert_eq!((t.title.as_str(), t.artist.as_str()), ("T", "A"));
        assert!(matches!(
            update_tags(&conn, &fx.music, id + 99, &input("T", "A", None)),
            Err(EditError::NotFound)
        ));
    }

    #[test]
    fn update_tags_refuses_files_outside_the_music_folder() {
        let fx = Fx::new();
        let conn = fx.db.conn().expect("conn");
        let outside = fx.audio_in(&fx.root.join("elsewhere"), "x.opus");
        let id = add_track(&conn, Some(&outside), 1000);
        assert!(matches!(
            update_tags(&conn, &fx.music, id, &input("T", "A", None)),
            Err(EditError::OutsideMusicDir)
        ));
        assert_eq!(row(&conn, id).title, "Old title");
        assert_eq!(tags::read_info(&outside).expect("read").title, None);
    }

    #[test]
    fn set_cover_stores_the_image_and_replaces_the_old_one() {
        let fx = Fx::new();
        let conn = fx.db.conn().expect("conn");
        let file = fx.audio("A - B.opus");
        let id = add_track(&conn, Some(&file), 1000);

        let jpg = fx.root.join("pic.jpg");
        std::fs::write(&jpg, JPEG).expect("write jpg");
        let t = set_cover_from_path(&conn, &fx.music, id, &jpg).expect("jpeg cover");
        let first = fx.singles.join(covers::COVERS_DIR).join("A - B.jpg");
        assert_eq!(
            t.cover_path.as_deref(),
            Some(first.to_string_lossy().as_ref())
        );
        assert_eq!(std::fs::read(&first).expect("read"), JPEG);

        let png = fx.root.join("pic.png");
        std::fs::write(&png, PNG).expect("write png");
        let t = set_cover_from_path(&conn, &fx.music, id, &png).expect("png cover");
        let second = fx.singles.join(covers::COVERS_DIR).join("A - B.png");
        assert_eq!(
            t.cover_path.as_deref(),
            Some(second.to_string_lossy().as_ref())
        );
        assert!(second.is_file());
        assert!(!first.exists(), "the previous cover is removed");
    }

    #[test]
    fn set_cover_rejects_bad_images_and_tracks_without_a_file() {
        let fx = Fx::new();
        let conn = fx.db.conn().expect("conn");
        let file = fx.audio("A - B.opus");
        let id = add_track(&conn, Some(&file), 1000);

        let text = fx.root.join("notes.jpg");
        std::fs::write(&text, b"not an image").expect("write");
        assert!(matches!(
            set_cover_from_path(&conn, &fx.music, id, &text),
            Err(EditError::Cover(covers::CoverError::NotAnImage))
        ));

        let big = fx.root.join("big.jpg");
        let mut bytes = vec![0xFF, 0xD8, 0xFF];
        bytes.resize(covers::MAX_IMAGE_BYTES + 1, 0);
        std::fs::write(&big, bytes).expect("write");
        assert!(matches!(
            set_cover_from_path(&conn, &fx.music, id, &big),
            Err(EditError::Cover(covers::CoverError::TooLarge))
        ));

        assert!(set_cover_from_path(&conn, &fx.music, id, &fx.root).is_err());
        assert!(
            !fx.singles.join(covers::COVERS_DIR).exists(),
            "nothing was stored"
        );

        let no_file = add_track(&conn, None, 1000);
        let jpg = fx.root.join("pic.jpg");
        std::fs::write(&jpg, JPEG).expect("write");
        assert!(matches!(
            set_cover_from_path(&conn, &fx.music, no_file, &jpg),
            Err(EditError::NoFile)
        ));
    }

    #[test]
    fn delete_removes_row_file_and_own_cover() {
        let fx = Fx::new();
        let conn = fx.db.conn().expect("conn");
        let file = fx.audio("A - B.opus");
        let id = add_track(&conn, Some(&file), 1000);
        let jpg = fx.root.join("pic.jpg");
        std::fs::write(&jpg, JPEG).expect("write");
        let t = set_cover_from_path(&conn, &fx.music, id, &jpg).expect("cover");
        let cover = PathBuf::from(t.cover_path.expect("cover path"));

        delete_track(&conn, &fx.music, id, true).expect("delete");
        assert!(tracks::get(&conn, id).expect("get").is_none());
        assert!(!file.exists());
        assert!(!cover.exists());
        assert!(matches!(
            delete_track(&conn, &fx.music, id, true),
            Err(EditError::NotFound)
        ));
    }

    #[test]
    fn delete_without_the_file_flag_keeps_the_audio() {
        let fx = Fx::new();
        let conn = fx.db.conn().expect("conn");
        let file = fx.audio("A - B.opus");
        let id = add_track(&conn, Some(&file), 1000);
        delete_track(&conn, &fx.music, id, false).expect("delete");
        assert!(tracks::get(&conn, id).expect("get").is_none());
        assert!(file.is_file());
    }

    #[test]
    fn delete_refuses_files_outside_the_music_folder() {
        let fx = Fx::new();
        let conn = fx.db.conn().expect("conn");
        let outside = fx.audio_in(&fx.root.join("elsewhere"), "x.opus");
        let id = add_track(&conn, Some(&outside), 1000);
        assert!(matches!(
            delete_track(&conn, &fx.music, id, true),
            Err(EditError::OutsideMusicDir)
        ));
        assert!(outside.is_file());
        assert!(tracks::get(&conn, id).expect("get").is_some());
    }

    #[test]
    fn delete_keeps_a_cover_shared_with_another_track() {
        let fx = Fx::new();
        let conn = fx.db.conn().expect("conn");
        let covers_dir = fx.singles.join(covers::COVERS_DIR);
        std::fs::create_dir_all(&covers_dir).expect("covers dir");
        let shared = covers_dir.join("shared.jpg");
        std::fs::write(&shared, JPEG).expect("write");
        let shared_str = shared.to_string_lossy().into_owned();

        let ids: Vec<i64> = ["one.opus", "two.opus"]
            .iter()
            .map(|n| {
                let f = fx.audio(n);
                let id = add_track(&conn, Some(&f), 1000);
                tracks::set_cover_path(&conn, id, &shared_str).expect("cover");
                id
            })
            .collect();

        delete_track(&conn, &fx.music, ids[0], true).expect("first");
        assert!(shared.is_file(), "still used by the second track");
        delete_track(&conn, &fx.music, ids[1], true).expect("second");
        assert!(!shared.exists(), "nobody uses it any more");
    }

    #[test]
    fn delete_never_removes_a_cover_outside_a_covers_folder() {
        let fx = Fx::new();
        let conn = fx.db.conn().expect("conn");
        let file = fx.audio("A - B.opus");
        let id = add_track(&conn, Some(&file), 1000);
        let playlist_cover = fx.singles.join("cover.jpg");
        std::fs::write(&playlist_cover, JPEG).expect("write");
        tracks::set_cover_path(&conn, id, &playlist_cover.to_string_lossy()).expect("cover");
        delete_track(&conn, &fx.music, id, true).expect("delete");
        assert!(playlist_cover.is_file());
    }

    #[test]
    fn backfill_fixes_only_zero_durations_of_existing_files() {
        let fx = Fx::new();
        let conn = fx.db.conn().expect("conn");
        let zero = add_track(&conn, Some(&fx.audio("zero.opus")), 0);
        let known = add_track(&conn, Some(&fx.audio("known.opus")), 5000);
        let missing = add_track(&conn, Some(&fx.singles.join("gone.opus")), 0);
        let no_file = add_track(&conn, None, 0);

        assert_eq!(backfill_durations(&conn, &fx.music).expect("backfill"), 1);
        assert!((900..=1100).contains(&row(&conn, zero).duration_ms));
        assert_eq!(row(&conn, known).duration_ms, 5000);
        assert_eq!(row(&conn, missing).duration_ms, 0);
        assert_eq!(row(&conn, no_file).duration_ms, 0);
        assert_eq!(backfill_durations(&conn, &fx.music).expect("again"), 0);
    }

    #[test]
    fn locate_returns_only_existing_files_inside_the_music_folder() {
        let fx = Fx::new();
        let conn = fx.db.conn().expect("conn");
        let file = fx.audio("A - B.opus");
        let ok = add_track(&conn, Some(&file), 1000);
        assert_eq!(locate(&conn, &fx.music, ok).expect("locate"), file);

        let outside = fx.audio_in(&fx.root.join("elsewhere"), "x.opus");
        let bad = add_track(&conn, Some(&outside), 1000);
        assert!(matches!(
            locate(&conn, &fx.music, bad),
            Err(EditError::OutsideMusicDir)
        ));

        let missing = add_track(&conn, Some(&fx.singles.join("gone.opus")), 1000);
        assert!(matches!(
            locate(&conn, &fx.music, missing),
            Err(EditError::NoFile)
        ));
        let none = add_track(&conn, None, 1000);
        assert!(matches!(
            locate(&conn, &fx.music, none),
            Err(EditError::NoFile)
        ));
    }

    #[test]
    fn a_staged_cover_changes_nothing_until_it_is_committed() {
        let fx = Fx::new();
        let conn = fx.db.conn().expect("conn");
        let file = fx.audio("A - B.opus");
        let id = add_track(&conn, Some(&file), 1000);
        let jpg = fx.root.join("pic.jpg");
        std::fs::write(&jpg, JPEG).expect("write");

        let staged = stage_cover_from_path(&conn, &fx.music, id, &jpg).expect("stage");
        assert!(staged.is_file());
        assert!(staged.to_string_lossy().contains(PENDING_PREFIX));
        assert_eq!(row(&conn, id).cover_path, None);
        let final_path = fx.singles.join(covers::COVERS_DIR).join("A - B.jpg");
        assert!(!final_path.exists());

        let t = commit_staged_cover(&conn, &fx.music, id).expect("commit");
        assert_eq!(
            t.cover_path.as_deref(),
            Some(final_path.to_string_lossy().as_ref())
        );
        assert!(final_path.is_file());
        assert!(!staged.exists(), "the staged copy is gone");
    }

    #[test]
    fn discarding_a_staged_cover_keeps_the_previous_one() {
        let fx = Fx::new();
        let conn = fx.db.conn().expect("conn");
        let file = fx.audio("A - B.opus");
        let id = add_track(&conn, Some(&file), 1000);
        let jpg = fx.root.join("pic.jpg");
        std::fs::write(&jpg, JPEG).expect("write");
        let first = set_cover_from_path(&conn, &fx.music, id, &jpg).expect("first cover");

        let png = fx.root.join("pic.png");
        std::fs::write(&png, PNG).expect("write");
        let staged = stage_cover_from_path(&conn, &fx.music, id, &png).expect("stage");
        discard_staged_cover(&conn, &fx.music, id).expect("discard");

        assert!(!staged.exists());
        assert_eq!(row(&conn, id).cover_path, first.cover_path);
        let old = PathBuf::from(first.cover_path.expect("cover path"));
        assert_eq!(std::fs::read(old).expect("read"), JPEG);
        assert!(matches!(
            commit_staged_cover(&conn, &fx.music, id),
            Err(EditError::NoStagedCover)
        ));
    }

    #[test]
    fn staging_twice_keeps_only_the_latest_image() {
        let fx = Fx::new();
        let conn = fx.db.conn().expect("conn");
        let file = fx.audio("A - B.opus");
        let id = add_track(&conn, Some(&file), 1000);
        let jpg = fx.root.join("pic.jpg");
        std::fs::write(&jpg, JPEG).expect("write");
        let png = fx.root.join("pic.png");
        std::fs::write(&png, PNG).expect("write");

        let first = stage_cover_from_path(&conn, &fx.music, id, &jpg).expect("first");
        let second = stage_cover_from_path(&conn, &fx.music, id, &png).expect("second");
        assert!(!first.exists());
        assert!(second.is_file());
    }

    #[test]
    fn clean_tag_collapses_whitespace_and_drops_invisible_characters() {
        assert_eq!(clean_tag("  a \t b\n c  "), "a b c");
        assert_eq!(clean_tag("a\u{202E}b\u{0007}c\u{200B}d"), "abcd");
        assert_eq!(clean_tag("   "), "");
        assert_eq!(clean_tag("Car, the garden"), "Car, the garden");
    }
}
