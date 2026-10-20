use std::{
    fs,
    path::{Path, PathBuf},
};

use tauri::{AppHandle, Manager};

use crate::error::AppResult;

/// Every location the backend reads or writes, resolved once at startup.
#[derive(Debug, Clone)]
pub struct AppPaths {
    pub data_dir: PathBuf,
    pub db_file: PathBuf,
    pub music_dir: PathBuf,
    pub singles_dir: PathBuf,
    pub playlists_dir: PathBuf,
}

impl AppPaths {
    pub fn new(data_dir: &Path, music_dir: &Path) -> Self {
        Self {
            data_dir: data_dir.to_path_buf(),
            db_file: data_dir.join("cupid.db"),
            music_dir: music_dir.to_path_buf(),
            singles_dir: music_dir.join("Singles"),
            playlists_dir: music_dir.join("Playlists"),
        }
    }

    /// %APPDATA%\<identifier>\ for data, <Music>\CupidPlayer\ for songs.
    pub fn resolve(app: &AppHandle) -> AppResult<Self> {
        let resolver = app.path();
        let data_dir = resolver.app_data_dir()?;
        let music_dir = resolver.audio_dir()?.join("CupidPlayer");
        Ok(Self::new(&data_dir, &music_dir))
    }

    pub fn ensure_dirs(&self) -> AppResult<()> {
        for dir in [&self.data_dir, &self.singles_dir, &self.playlists_dir] {
            fs::create_dir_all(dir)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ensure_dirs_creates_expected_layout() {
        let root = std::env::temp_dir().join(format!("cupid-paths-test-{}", std::process::id()));
        let paths = AppPaths::new(&root.join("data"), &root.join("Music").join("CupidPlayer"));
        paths.ensure_dirs().unwrap();
        assert!(paths.singles_dir.is_dir());
        assert!(paths.playlists_dir.is_dir());
        assert!(paths.data_dir.is_dir());
        assert!(
            paths.singles_dir.ends_with("CupidPlayer/Singles")
                || paths.singles_dir.ends_with("CupidPlayer\\Singles")
        );
        let _ = fs::remove_dir_all(&root);
    }
}
