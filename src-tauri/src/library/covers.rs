//! Cover images: downloaded from Spotify's CDN with strict limits and stored
//! next to the music (".covers\<name>.jpg" for tracks, "cover.jpg" for playlists).

use std::path::{Path, PathBuf};
use std::time::Duration;

use thiserror::Error;

use crate::library::names::{MAX_FILE_STEM_CHARS, is_inside, is_safe_component};
use crate::spotify::embed::safe_cover_url;

pub const COVERS_DIR: &str = ".covers";
const MAX_IMAGE_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImageKind {
    Jpeg,
    Png,
}

impl ImageKind {
    pub fn extension(self) -> &'static str {
        match self {
            ImageKind::Jpeg => "jpg",
            ImageKind::Png => "png",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Image {
    pub kind: ImageKind,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Error)]
pub enum CoverError {
    #[error("cover URL is not allowed")]
    UrlNotAllowed,
    #[error("not a JPEG or PNG image")]
    NotAnImage,
    #[error("image too large")]
    TooLarge,
    #[error("unsafe file name")]
    UnsafeName,
    #[error("network error: {0}")]
    Network(String),
    #[error("unexpected HTTP status {0}")]
    Status(u16),
    #[error("i/o error: {0}")]
    Io(#[from] std::io::Error),
}

/// Identifies the image by its first bytes, never by file name or content type.
pub fn sniff_image(bytes: &[u8]) -> Option<ImageKind> {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some(ImageKind::Jpeg)
    } else if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        Some(ImageKind::Png)
    } else {
        None
    }
}

pub fn accept_image(bytes: Vec<u8>) -> Result<Image, CoverError> {
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(CoverError::TooLarge);
    }
    let kind = sniff_image(&bytes).ok_or(CoverError::NotAnImage)?;
    Ok(Image { kind, bytes })
}

fn net_err(e: reqwest::Error) -> CoverError {
    CoverError::Network(e.without_url().to_string())
}

/// Downloads an image from Spotify's CDN (https only, no redirects, size cap).
pub async fn fetch_image(url: &str) -> Result<Image, CoverError> {
    let url = safe_cover_url(url).ok_or(CoverError::UrlNotAllowed)?;
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0")
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(net_err)?;
    let mut resp = client.get(&url).send().await.map_err(net_err)?;
    if !resp.status().is_success() {
        return Err(CoverError::Status(resp.status().as_u16()));
    }
    if resp
        .content_length()
        .is_some_and(|l| l > MAX_IMAGE_BYTES as u64)
    {
        return Err(CoverError::TooLarge);
    }
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(net_err)? {
        if buf.len() + chunk.len() > MAX_IMAGE_BYTES {
            return Err(CoverError::TooLarge);
        }
        buf.extend_from_slice(&chunk);
    }
    accept_image(buf)
}

/// `<dest_dir>\.covers\<stem>.<ext>`; `stem` must already be a safe file name.
pub fn track_cover_path(
    dest_dir: &Path,
    stem: &str,
    kind: ImageKind,
) -> Result<PathBuf, CoverError> {
    if !is_safe_component(stem, MAX_FILE_STEM_CHARS) {
        return Err(CoverError::UnsafeName);
    }
    let path = dest_dir
        .join(COVERS_DIR)
        .join(format!("{stem}.{}", kind.extension()));
    if is_inside(dest_dir, &path) {
        Ok(path)
    } else {
        Err(CoverError::UnsafeName)
    }
}

/// `<playlist folder>\cover.<ext>`.
pub fn playlist_cover_path(folder_dir: &Path, kind: ImageKind) -> PathBuf {
    folder_dir.join(format!("cover.{}", kind.extension()))
}

/// Writes to a temporary file first, then renames, so a crash never leaves a
/// half-written cover under its final name.
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), CoverError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("part");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

pub fn store_track_cover(
    dest_dir: &Path,
    stem: &str,
    image: &Image,
) -> Result<PathBuf, CoverError> {
    let path = track_cover_path(dest_dir, stem, image.kind)?;
    write_atomic(&path, &image.bytes)?;
    Ok(path)
}

pub fn store_playlist_cover(folder_dir: &Path, image: &Image) -> Result<PathBuf, CoverError> {
    let path = playlist_cover_path(folder_dir, image.kind);
    write_atomic(&path, &image.bytes)?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    const JPEG: [u8; 6] = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10];
    const PNG: [u8; 10] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0];

    fn temp_dir() -> PathBuf {
        let d = std::env::temp_dir().join(format!("cupid-covers-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).expect("create temp dir");
        d
    }

    #[test]
    fn recognizes_jpeg_and_png_only() {
        assert_eq!(sniff_image(&JPEG), Some(ImageKind::Jpeg));
        assert_eq!(sniff_image(&PNG), Some(ImageKind::Png));
        assert_eq!(sniff_image(b"GIF89a"), None);
        assert_eq!(sniff_image(b"<html>"), None);
        assert_eq!(sniff_image(&[]), None);
    }

    #[test]
    fn rejects_oversized_and_non_images() {
        assert!(matches!(
            accept_image(b"hello".to_vec()),
            Err(CoverError::NotAnImage)
        ));
        let mut big = JPEG.to_vec();
        big.resize(MAX_IMAGE_BYTES + 1, 0);
        assert!(matches!(accept_image(big), Err(CoverError::TooLarge)));
        let mut limit = JPEG.to_vec();
        limit.resize(MAX_IMAGE_BYTES, 0);
        assert!(accept_image(limit).is_ok());
    }

    #[test]
    fn track_cover_paths_are_safe() {
        let dir = Path::new("dest");
        let p = track_cover_path(dir, "Amaia - C’est La Vie", ImageKind::Jpeg).expect("path");
        assert!(p.ends_with(Path::new(COVERS_DIR).join("Amaia - C’est La Vie.jpg")));
        for bad in ["a/b", "..", "CON", "", "name."] {
            assert!(
                matches!(
                    track_cover_path(dir, bad, ImageKind::Jpeg),
                    Err(CoverError::UnsafeName)
                ),
                "{bad:?}"
            );
        }
        let long = "a".repeat(MAX_FILE_STEM_CHARS + 1);
        assert!(matches!(
            track_cover_path(dir, &long, ImageKind::Png),
            Err(CoverError::UnsafeName)
        ));
        assert_eq!(
            playlist_cover_path(Path::new("Mix"), ImageKind::Png),
            Path::new("Mix").join("cover.png")
        );
    }

    #[test]
    fn stores_covers_atomically_and_overwrites() {
        let dir = temp_dir();
        let image = accept_image(JPEG.to_vec()).expect("jpeg");
        let path = store_track_cover(&dir, "A - B", &image).expect("store");
        assert_eq!(path, dir.join(COVERS_DIR).join("A - B.jpg"));
        assert_eq!(std::fs::read(&path).expect("read"), JPEG);

        let mut other = JPEG.to_vec();
        other.push(1);
        let newer = accept_image(other.clone()).expect("jpeg 2");
        store_track_cover(&dir, "A - B", &newer).expect("overwrite");
        assert_eq!(std::fs::read(&path).expect("read"), other);

        let leftovers = std::fs::read_dir(dir.join(COVERS_DIR))
            .expect("read dir")
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().ends_with(".part"))
            .count();
        assert_eq!(leftovers, 0);

        let playlist = store_playlist_cover(&dir, &image).expect("playlist cover");
        assert_eq!(playlist, dir.join("cover.jpg"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn fetch_rejects_untrusted_urls_without_any_request() {
        for url in [
            "http://i.scdn.co/image/x",
            "https://evil.com/x.jpg",
            "not a url",
        ] {
            assert!(
                matches!(fetch_image(url).await, Err(CoverError::UrlNotAllowed)),
                "{url}"
            );
        }
    }
}
