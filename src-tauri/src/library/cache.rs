//! Cache (H8.5): what the app can throw away without touching any music.
//! - covers in ".covers" that no track uses any more, plus staged covers left by
//!   an edit dialog that never closed,
//! - stale partial files (".part", ".ytdl") left by interrupted copies or downloads.
//!   Covers still in use and audio files are never removed.


use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use rusqlite::Connection;
use serde::Serialize;
use thiserror::Error;

use crate::db::tracks::{self, TrackFilter};
use crate::library::edit::PENDING_PREFIX;
use crate::library::{covers, names};

/// A partial file younger than this may belong to a download in progress.
const STALE_TEMP: Duration = Duration::from_secs(60 * 60);
const MAX_DEPTH: usize = 4;
const MAX_ENTRIES: usize = 200_000;
const TEMP_EXTENSIONS: [&str; 2] = ["part", "ytdl"];

#[derive(Debug, Error)]
pub enum CacheError {
    #[error("database: {0}")]
    Db(String),
}

impl CacheError {
    /// Stable code the UI translates with `errors.<code>` (D-99).
    pub fn code(&self) -> &'static str {
        match self {
            CacheError::Db(_) => "cache.db",
        }
    }
}

#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheInfo {
    /// Everything inside ".covers" folders.
    pub covers_bytes: u64,
    pub covers_count: usize,
    /// What "clear cache" would delete.
    pub reclaimable_bytes: u64,
    pub reclaimable_count: usize,
}

#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheCleared {
    pub removed: usize,
    pub freed_bytes: u64,
}

#[derive(Default)]
struct Walk {
    cover_dirs: Vec<PathBuf>,
    temp_files: Vec<PathBuf>,
}

fn is_temp_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| TEMP_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
}

fn is_stale(meta: &fs::Metadata, after: Duration) -> bool {
    meta.modified()
        .ok()
        .and_then(|m| m.elapsed().ok())
        .is_some_and(|age| age >= after)
}

/// Finds ".covers" folders and partial files under the music folder.
/// Skips symlinks and other hidden folders.
fn walk(music_dir: &Path) -> Walk {
    let mut w = Walk::default();
    let mut seen = 0usize;
    let mut stack = vec![(music_dir.to_path_buf(), 0usize)];
    while let Some((dir, depth)) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            seen += 1;
            if seen > MAX_ENTRIES {
                return w;
            }
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_symlink() {
                continue;
            }
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            if kind.is_dir() {
                if name == covers::COVERS_DIR {
                    w.cover_dirs.push(path);
                } else if !name.starts_with('.') && depth < MAX_DEPTH {
                    stack.push((path, depth + 1));
                }
            } else if kind.is_file() && is_temp_file(&path) {
                w.temp_files.push(path);
            }
        }
    }
    w
}

#[derive(Default)]
struct Analysis {
    covers_bytes: u64,
    covers_count: usize,
    removable: Vec<(PathBuf, u64)>,
}

fn analyze(
    conn: &Connection,
    music_dir: &Path,
    stale_after: Duration,
) -> Result<Analysis, CacheError> {
    // Matched by file name, not by full path: if the stored path ever differs in
    // format, the worst case is keeping an unused cover, never deleting a used one.
    let referenced: HashSet<String> = tracks::list(conn, &TrackFilter::default())
        .map_err(|e| CacheError::Db(e.to_string()))?
        .into_iter()
        .filter_map(|t| t.cover_path)
        .filter_map(|p| {
            Path::new(&p)
                .file_name()
                .map(|n| n.to_string_lossy().to_lowercase())
        })
        .collect();

    let w = walk(music_dir);
    let mut a = Analysis::default();

    for dir in &w.cover_dirs {
        for entry in fs::read_dir(dir).into_iter().flatten().flatten() {
            let Ok(meta) = entry.metadata() else {
                continue;
            };
            if !meta.is_file() {
                continue;
            }
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            a.covers_bytes += meta.len();
            a.covers_count += 1;
            let unused = !referenced.contains(&name.to_lowercase());
            let staged = name.starts_with(PENDING_PREFIX);
            if (unused || staged) && names::is_inside(music_dir, &path) {
                a.removable.push((path, meta.len()));
            }
        }
    }

    for path in &w.temp_files {
        let Ok(meta) = fs::metadata(path) else {
            continue;
        };
        if is_stale(&meta, stale_after) && names::is_inside(music_dir, path) {
            a.removable.push((path.clone(), meta.len()));
        }
    }
    Ok(a)
}

fn info_with(
    conn: &Connection,
    music_dir: &Path,
    stale_after: Duration,
) -> Result<CacheInfo, CacheError> {
    let a = analyze(conn, music_dir, stale_after)?;
    Ok(CacheInfo {
        covers_bytes: a.covers_bytes,
        covers_count: a.covers_count,
        reclaimable_bytes: a.removable.iter().map(|(_, size)| *size).sum(),
        reclaimable_count: a.removable.len(),
    })
}

fn clear_with(
    conn: &Connection,
    music_dir: &Path,
    stale_after: Duration,
) -> Result<CacheCleared, CacheError> {
    let a = analyze(conn, music_dir, stale_after)?;
    let mut out = CacheCleared::default();
    for (path, size) in a.removable {
        if names::is_inside(music_dir, &path) && fs::remove_file(&path).is_ok() {
            out.removed += 1;
            out.freed_bytes += size;
        }
    }
    Ok(out)
}

pub fn cache_info(conn: &Connection, music_dir: &Path) -> Result<CacheInfo, CacheError> {
    info_with(conn, music_dir, STALE_TEMP)
}

pub fn clear_cache(conn: &Connection, music_dir: &Path) -> Result<CacheCleared, CacheError> {
    clear_with(conn, music_dir, STALE_TEMP)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;
    use crate::db::tracks::NewTrack;
    use rusqlite::params;

    struct Fx {
        root: PathBuf,
        music: PathBuf,
        db: Database,
    }

    impl Fx {
        fn new() -> Self {
            let root =
                std::env::temp_dir().join(format!("cupid-cache-test-{}", uuid::Uuid::new_v4()));
            let music = root.join("CupidPlayer");
            fs::create_dir_all(&music).expect("create dirs");
            Self {
                root,
                music,
                db: Database::open_in_memory().expect("db"),
            }
        }

        fn write(&self, parts: &[&str], bytes: usize) -> PathBuf {
            let mut p = self.music.clone();
            for part in parts {
                p.push(part);
            }
            fs::create_dir_all(p.parent().expect("parent")).expect("create parent");
            fs::write(&p, vec![1u8; bytes]).expect("write file");
            p
        }

        /// 4 covers (100 + 10 + 20 + 30 bytes), 1 audio, 2 partial files (40 + 50 bytes).
        /// Only the 100-byte cover is used by a track.
        fn populate(&self, conn: &Connection) -> PathBuf {
            let used = self.write(&["Singles", ".covers", "A - B.jpg"], 100);
            self.write(&["Singles", ".covers", "orphan.jpg"], 10);
            self.write(&["Singles", ".covers", "pending-5.png"], 20);
            self.write(&["Playlists", "Mix", ".covers", "old.jpg"], 30);
            self.write(&["Singles", "A - B.opus"], 1000);
            self.write(&["Singles", "stuck.opus.part"], 40);
            self.write(&["Playlists", "Mix", "x.ytdl"], 50);
            let mut t = NewTrack::basic("B", "A", 1000);
            t.file_path = Some(
                self.music
                    .join("Singles")
                    .join("A - B.opus")
                    .to_string_lossy()
                    .into_owned(),
            );
            t.cover_path = Some(used.to_string_lossy().into_owned());
            t.status = "done".into();
            tracks::insert(conn, &t).expect("insert");
            used
        }
    }

    impl Drop for Fx {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn reports_sizes_and_what_can_be_freed() {
        let fx = Fx::new();
        let conn = fx.db.conn().expect("conn");
        fx.populate(&conn);
        let info = info_with(&conn, &fx.music, Duration::ZERO).expect("info");
        assert_eq!(
            info,
            CacheInfo {
                covers_bytes: 160,
                covers_count: 4,
                reclaimable_bytes: 150,
                reclaimable_count: 5
            }
        );
    }

    #[test]
    fn recent_partial_files_are_left_alone() {
        let fx = Fx::new();
        let conn = fx.db.conn().expect("conn");
        fx.populate(&conn);
        let info = info_with(&conn, &fx.music, Duration::from_secs(3600)).expect("info");
        assert_eq!((info.reclaimable_count, info.reclaimable_bytes), (3, 60));
    }

    #[test]
    fn clearing_removes_only_unused_covers_and_stale_partial_files() {
        let fx = Fx::new();
        let conn = fx.db.conn().expect("conn");
        let used = fx.populate(&conn);
        let audio = fx.music.join("Singles").join("A - B.opus");

        let out = clear_with(&conn, &fx.music, Duration::ZERO).expect("clear");
        assert_eq!(
            out,
            CacheCleared {
                removed: 5,
                freed_bytes: 150
            }
        );
        assert!(used.is_file(), "a cover in use stays");
        assert!(audio.is_file(), "music is never touched");
        assert!(
            !fx.music
                .join("Singles")
                .join(".covers")
                .join("orphan.jpg")
                .exists()
        );
        assert!(
            !fx.music
                .join("Singles")
                .join(".covers")
                .join("pending-5.png")
                .exists()
        );
        assert!(!fx.music.join("Singles").join("stuck.opus.part").exists());

        let again = clear_with(&conn, &fx.music, Duration::ZERO).expect("clear again");
        assert_eq!(again, CacheCleared::default());
    }

    #[test]
    fn covers_are_matched_by_file_name_not_by_path_format() {
        let fx = Fx::new();
        let conn = fx.db.conn().expect("conn");
        let used = fx.populate(&conn);
        let slashes = used.to_string_lossy().replace('\\', "/");
        conn.execute("UPDATE tracks SET cover_path = ?1", params![slashes])
            .expect("update");
        let info = info_with(&conn, &fx.music, Duration::ZERO).expect("info");
        assert_eq!(
            info.reclaimable_count, 5,
            "the used cover is still recognized"
        );
    }

    #[test]
    fn nothing_outside_the_music_folder_is_touched() {
        let fx = Fx::new();
        let conn = fx.db.conn().expect("conn");
        fx.populate(&conn);
        let outside = fx.root.join("outside").join(".covers").join("x.jpg");
        fs::create_dir_all(outside.parent().expect("parent")).expect("dirs");
        fs::write(&outside, b"x").expect("write");
        clear_with(&conn, &fx.music, Duration::ZERO).expect("clear");
        assert!(outside.is_file());
    }
}
