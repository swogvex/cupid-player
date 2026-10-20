use tauri::State;

use crate::{
    db::{
        Database,
        playlists::{self, Playlist},
        tracks::{self, Track, TrackFilter},
    },
    error::AppResult,
    paths::AppPaths,
};

#[tauri::command]
pub async fn list_tracks(
    db: State<'_, Database>,
    filter: Option<TrackFilter>,
) -> AppResult<Vec<Track>> {
    let conn = db.conn()?;
    tracks::list(&conn, &filter.unwrap_or_default())
}

#[tauri::command]
pub async fn list_playlists(db: State<'_, Database>) -> AppResult<Vec<Playlist>> {
    let conn = db.conn()?;
    playlists::list(&conn)
}

#[tauri::command]
pub fn get_music_dir(paths: State<'_, AppPaths>) -> String {
    paths.music_dir.to_string_lossy().into_owned()
}
