//! Reading and writing audio tags (Vorbis comments in .opus) with lofty.
//! Only text tags are written: covers live in ".covers" (see covers.rs).

use std::path::Path;

use lofty::config::WriteOptions;
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::tag::{Accessor, Tag};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum TagError {
    #[error("could not read or write tags: {0}")]
    Lofty(String),
}

fn lofty_err<E: std::fmt::Display>(e: E) -> TagError {
    TagError::Lofty(e.to_string())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileInfo {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub duration_ms: u64,
}

/// Title, artist and album (if present) plus the real duration of the audio.
pub fn read_info(path: &Path) -> Result<FileInfo, TagError> {
    let tagged = lofty::read_from_path(path).map_err(lofty_err)?;
    let duration_ms = u64::try_from(tagged.properties().duration().as_millis()).unwrap_or(0);
    let (title, artist, album) = match tagged.primary_tag() {
        Some(t) => (
            t.title().map(|s| s.into_owned()),
            t.artist().map(|s| s.into_owned()),
            t.album().map(|s| s.into_owned()),
        ),
        None => (None, None, None),
    };
    Ok(FileInfo {
        title,
        artist,
        album,
        duration_ms,
    })
}

/// Writes title and artist (and album, or removes it when `None`), creating the
/// tag if the file has none. The artist text is stored whole (D-78).
pub fn write_basic_tags(
    path: &Path,
    title: &str,
    artist: &str,
    album: Option<&str>,
) -> Result<(), TagError> {
    let mut tagged = lofty::read_from_path(path).map_err(lofty_err)?;
    let tag_type = tagged.primary_tag_type();
    if tagged.tag(tag_type).is_none() {
        tagged.insert_tag(Tag::new(tag_type));
    }
    let tag = tagged
        .tag_mut(tag_type)
        .ok_or_else(|| TagError::Lofty("no tag available for this format".into()))?;
    tag.set_title(title.to_string());
    tag.set_artist(artist.to_string());
    match album {
        Some(a) => tag.set_album(a.to_string()),
        None => tag.remove_album(),
    }
    tagged
        .save_to_path(path, WriteOptions::default())
        .map_err(lofty_err)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// A copy of the 1-second silent opus fixture, so the original is never modified.
    fn temp_copy() -> (PathBuf, PathBuf) {
        let src = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests")
            .join("fixtures")
            .join("silence.opus");
        assert!(
            src.is_file(),
            "missing fixture {}: see the 7.3.6 instructions",
            src.display()
        );
        let dir = std::env::temp_dir().join(format!("cupid-tags-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        let file = dir.join("track.opus");
        std::fs::copy(&src, &file).expect("copy fixture");
        (file, dir)
    }

    #[test]
    fn reads_the_duration_of_a_real_opus() {
        let (file, dir) = temp_copy();
        let info = read_info(&file).expect("read");
        assert!(
            (900..=1100).contains(&info.duration_ms),
            "duration was {}",
            info.duration_ms
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_fresh_file_has_no_title_or_artist() {
        let (file, dir) = temp_copy();
        let info = read_info(&file).expect("read");
        assert_eq!((info.title, info.artist, info.album), (None, None, None));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn writes_and_reads_back_tags_without_touching_the_audio() {
        let (file, dir) = temp_copy();
        let before = read_info(&file).expect("read");
        write_basic_tags(&file, "C’est La Vie", "Amaia", None).expect("write");
        let after = read_info(&file).expect("read again");
        assert_eq!(after.title.as_deref(), Some("C’est La Vie"));
        assert_eq!(after.artist.as_deref(), Some("Amaia"));
        assert_eq!(after.album, None);
        assert_eq!(after.duration_ms, before.duration_ms);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn keeps_unicode_and_commas_in_names() {
        let (file, dir) = temp_copy();
        write_basic_tags(&file, "腹芸 ~ 🎧 100% 50/50", "Car, the garden", None).expect("write");
        let info = read_info(&file).expect("read");
        assert_eq!(info.title.as_deref(), Some("腹芸 ~ 🎧 100% 50/50"));
        assert_eq!(info.artist.as_deref(), Some("Car, the garden"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rewriting_replaces_the_previous_values() {
        let (file, dir) = temp_copy();
        write_basic_tags(&file, "One", "A", Some("Album")).expect("first write");
        assert_eq!(
            read_info(&file).expect("read").album.as_deref(),
            Some("Album")
        );
        write_basic_tags(&file, "Two", "B", None).expect("second write");
        let info = read_info(&file).expect("read");
        assert_eq!(info.title.as_deref(), Some("Two"));
        assert_eq!(info.artist.as_deref(), Some("B"));
        assert_eq!(info.album, None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_and_non_audio_files_return_errors() {
        let dir = std::env::temp_dir().join(format!("cupid-tags-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        assert!(read_info(&dir.join("nope.opus")).is_err());
        let text = dir.join("notes.txt");
        std::fs::write(&text, b"just text").expect("write text");
        assert!(read_info(&text).is_err());
        assert!(write_basic_tags(&text, "T", "A", None).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
