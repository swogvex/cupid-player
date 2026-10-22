use serde::Serialize;
use tauri::{AppHandle, State};

use crate::{
    db::{
        Database,
        playlists::{self, Playlist},
        tracks::{self, Track, TrackFilter},
    },
    error::{AppError, AppResult},
    import::runner::{self, ImportError, ImportManager, ImportStarted},
    paths::AppPaths,
    spotify::url::parse_spotify_url as parse_url,
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

/// For the importer commands the error string that reaches the frontend is a
/// stable code ("embed.not_found", "import.busy"...) that the UI translates.
fn coded(code: &str) -> AppError {
    AppError::Msg(code.to_string())
}

fn import_err(e: ImportError) -> AppError {
    eprintln!("[import] {e}");
    coded(e.code())
}

#[derive(Debug, Serialize)]
pub struct ParsedLink {
    kind: &'static str,
    id: String,
}

/// Validates a pasted link without touching the network.
#[tauri::command]
pub fn parse_spotify_url(url: String) -> AppResult<ParsedLink> {
    let r = parse_url(&url).map_err(|e| coded(e.code()))?;
    Ok(ParsedLink {
        kind: r.kind.as_str(),
        id: r.id,
    })
}

/// Reads the list, creates the rows and starts downloading in the background.
/// Progress arrives through the import:// events.
#[tauri::command]
pub async fn start_import(app: AppHandle, url: String) -> AppResult<ImportStarted> {
    let r = parse_url(&url).map_err(|e| coded(e.code()))?;
    runner::start_import(&app, &r).await.map_err(import_err)
}

#[tauri::command]
pub fn cancel_import(manager: State<'_, ImportManager>, import_id: String) -> bool {
    manager.cancel(&import_id)
}

#[tauri::command]
pub async fn retry_track(app: AppHandle, track_id: i64) -> AppResult<ImportStarted> {
    runner::retry_track(&app, track_id).map_err(import_err)
}
