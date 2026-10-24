use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::{
    db::{
        Database,
        tracks::{self, Track, TrackFilter},
    },
    error::{AppError, AppResult},
    import::runner::{self, ImportError, ImportManager, ImportStarted},
    library::{
        cache::{self, CacheCleared, CacheError, CacheInfo},
        collections::{self, ListError, Member, PlaylistRow},
        edit::{self, EditError, TagsInput},
        scan::{self, ScanError, ScanReport},
    },
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
pub async fn list_playlists(db: State<'_, Database>) -> AppResult<Vec<PlaylistRow>> {
    let conn = db.conn()?;
    collections::list(&conn).map_err(list_err)
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

fn scan_err(e: ScanError) -> AppError {
    eprintln!("[scan] {e}");
    coded(e.code())
}

fn cache_err(e: CacheError) -> AppError {
    eprintln!("[cache] {e}");
    coded(e.code())
}

fn list_err(e: ListError) -> AppError {
    eprintln!("[playlist] {e}");
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

/// Opens the native picker from Rust (the webview has no dialog permission and
/// never sees the chosen path) and *stages* the image: the track keeps its
/// current cover until `commit_cover`. Returns the staged file (inside the
/// music folder, so it can be previewed) or `None` if the user cancels.
#[tauri::command]
pub async fn pick_cover(
    app: AppHandle,
    window: tauri::WebviewWindow,
    db: State<'_, Database>,
    paths: State<'_, AppPaths>,
    track_id: i64,
) -> AppResult<Option<String>> {
    use tauri_plugin_dialog::DialogExt;
    let picked = app
        .dialog()
        .file()
        .set_parent(&window)
        .add_filter("Images", &["jpg", "jpeg", "png"])
        .blocking_pick_file();
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked
        .into_path()
        .map_err(|_| coded("library.cover_failed"))?;
    let conn = db.conn()?;
    let staged =
        edit::stage_cover_from_path(&conn, &paths.music_dir, track_id, &path).map_err(edit_err)?;
    Ok(Some(staged.to_string_lossy().into_owned()))
}

/// Applies the staged cover as the track's real cover.
#[tauri::command]
pub async fn commit_cover(
    db: State<'_, Database>,
    paths: State<'_, AppPaths>,
    track_id: i64,
) -> AppResult<Track> {
    let conn = db.conn()?;
    edit::commit_staged_cover(&conn, &paths.music_dir, track_id).map_err(edit_err)
}

/// Drops the staged cover (the edit dialog was cancelled).
#[tauri::command]
pub async fn discard_cover(
    db: State<'_, Database>,
    paths: State<'_, AppPaths>,
    track_id: i64,
) -> AppResult<()> {
    let conn = db.conn()?;
    edit::discard_staged_cover(&conn, &paths.music_dir, track_id).map_err(edit_err)
}

/// Shows the track's file in Explorer. Only files inside the music folder.
#[tauri::command]
pub async fn reveal_track(
    db: State<'_, Database>,
    paths: State<'_, AppPaths>,
    track_id: i64,
) -> AppResult<()> {
    let file = {
        let conn = db.conn()?;
        edit::locate(&conn, &paths.music_dir, track_id).map_err(edit_err)?
    };
    tauri_plugin_opener::reveal_item_in_dir(&file).map_err(|e| {
        eprintln!("[library] reveal failed: {e}");
        coded("library.io")
    })
}

/// Opens the native folder picker (from Rust) and imports the audio files inside
/// it into the library. Returns `None` if the user cancels.
#[tauri::command]
pub async fn scan_folder(
    app: AppHandle,
    window: tauri::WebviewWindow,
) -> AppResult<Option<ScanReport>> {
    use tauri_plugin_dialog::DialogExt;
    let picked = app
        .dialog()
        .file()
        .set_parent(&window)
        .blocking_pick_folder();
    let Some(picked) = picked else {
        return Ok(None);
    };
    let root = picked.into_path().map_err(|_| coded("scan.io"))?;

    // Reading tags and copying files can take a while: keep it off the async threads.
    let handle = app.clone();
    let report = tauri::async_runtime::spawn_blocking(move || {
        let db = handle.state::<Database>();
        let paths = handle.state::<AppPaths>();
        let conn = db.conn().map_err(|e| ScanError::Db(e.to_string()))?;
        scan::scan_folder(&conn, &paths, &root)
    })
    .await
    .map_err(|_| coded("scan.io"))?
    .map_err(scan_err)?;
    Ok(Some(report))
}

/// Size of the covers and how much "clear cache" would free.
#[tauri::command]
pub async fn get_cache_info(
    db: State<'_, Database>,
    paths: State<'_, AppPaths>,
) -> AppResult<CacheInfo> {
    let conn = db.conn()?;
    cache::cache_info(&conn, &paths.music_dir).map_err(cache_err)
}

/// Deletes unused covers and stale partial files. Never touches music.
#[tauri::command]
pub async fn clear_cache(
    db: State<'_, Database>,
    paths: State<'_, AppPaths>,
) -> AppResult<CacheCleared> {
    let conn = db.conn()?;
    cache::clear_cache(&conn, &paths.music_dir).map_err(cache_err)
}

/// Opens the music folder in Explorer.
#[tauri::command]
pub async fn open_music_folder(paths: State<'_, AppPaths>) -> AppResult<()> {
    tauri_plugin_opener::open_path(&paths.music_dir, None::<&str>).map_err(|e| {
        eprintln!("[library] open folder failed: {e}");
        coded("library.io")
    })
}

/// (playlist, track) pairs in playlist order; the frontend groups them.
#[tauri::command]
pub async fn list_playlist_members(db: State<'_, Database>) -> AppResult<Vec<Member>> {
    let conn = db.conn()?;
    collections::list_members(&conn).map_err(list_err)
}

/// A playlist of the user's own (no Spotify link, no folder on disk).
#[tauri::command]
pub async fn create_playlist(db: State<'_, Database>, name: String) -> AppResult<PlaylistRow> {
    let conn = db.conn()?;
    collections::create(&conn, &name).map_err(list_err)
}

#[tauri::command]
pub async fn rename_playlist(
    db: State<'_, Database>,
    playlist_id: i64,
    name: String,
) -> AppResult<PlaylistRow> {
    let conn = db.conn()?;
    collections::rename(&conn, playlist_id, &name).map_err(list_err)
}

/// Deletes the playlist and tidies its folder. With `delete_files` it also deletes the
/// tracks imported with it and their files; without it every song stays in the library.
#[tauri::command]
pub async fn delete_playlist(
    db: State<'_, Database>,
    paths: State<'_, AppPaths>,
    playlist_id: i64,
    delete_files: bool,
) -> AppResult<()> {
    let conn = db.conn()?;
    collections::delete_playlist(&conn, &paths, playlist_id, delete_files).map_err(list_err)
}

/// Returns how many tracks were actually added (duplicates are skipped).
#[tauri::command]
pub async fn add_to_playlist(
    db: State<'_, Database>,
    playlist_id: i64,
    track_ids: Vec<i64>,
) -> AppResult<usize> {
    let conn = db.conn()?;
    collections::add_tracks(&conn, playlist_id, &track_ids).map_err(list_err)
}

/// Removes the track from this playlist only; it stays in the library.
#[tauri::command]
pub async fn remove_from_playlist(
    db: State<'_, Database>,
    playlist_id: i64,
    track_id: i64,
) -> AppResult<bool> {
    let conn = db.conn()?;
    collections::remove_track(&conn, playlist_id, track_id).map_err(list_err)
}

/// Opens the folder of an imported playlist in Explorer.
#[tauri::command]
pub async fn reveal_playlist(
    db: State<'_, Database>,
    paths: State<'_, AppPaths>,
    playlist_id: i64,
) -> AppResult<()> {
    let dir = {
        let conn = db.conn()?;
        collections::playlist_dir(&conn, &paths.playlists_dir, playlist_id).map_err(list_err)?
    };
    tauri_plugin_opener::open_path(&dir, None::<&str>).map_err(|e| {
        eprintln!("[library] open playlist folder failed: {e}");
        coded("library.io")
    })
}
