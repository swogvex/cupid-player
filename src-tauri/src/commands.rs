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
    library::edit::{self, EditError, TagsInput},
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

/// For the importer and library commands the error string that reaches the
/// frontend is a stable code ("embed.not_found", "import.busy",
/// "library.outside_music"...) that the UI translates.
fn coded(code: &str) -> AppError {
    AppError::Msg(code.to_string())
}

fn import_err(e: ImportError) -> AppError {
    eprintln!("[import] {e}");
    coded(e.code())
}

fn edit_err(e: EditError) -> AppError {
    eprintln!("[library] {e}");
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

/// Edits title, artist and album in the database and in the file's tags.
/// Returns the updated track.
#[tauri::command]
pub async fn update_tags(
    db: State<'_, Database>,
    paths: State<'_, AppPaths>,
    track_id: i64,
    tags: TagsInput,
) -> AppResult<Track> {
    let conn = db.conn()?;
    edit::update_tags(&conn, &paths.music_dir, track_id, &tags).map_err(edit_err)
}

/// Removes a track from the library; with `delete_file` also its audio file.
#[tauri::command]
pub async fn delete_track(
    db: State<'_, Database>,
    paths: State<'_, AppPaths>,
    track_id: i64,
    delete_file: bool,
) -> AppResult<()> {
    let conn = db.conn()?;
    edit::delete_track(&conn, &paths.music_dir, track_id, delete_file).map_err(edit_err)
}
