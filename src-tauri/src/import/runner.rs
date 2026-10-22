//! Glue between the queue, the database, the file system and Tauri: prepares
//! imports, runs them in the background, persists every update and emits
//! events to the frontend:
//!   import://progress, import://track-state, import://done, library://changed.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

use rusqlite::Connection;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use thiserror::Error;
use tokio::sync::watch;

use super::queue::{
    BoxFuture, ItemCtx, ItemOutcome, Processor, QueueConfig, Update, UpdateSink, WorkItem,
    run_queue,
};
use super::state::{DonePayload, ProgressPayload, ProgressTracker, TrackStatePayload, TrackStatus};
use crate::db::{
    Database,
    playlists::{self, NewPlaylist},
    tracks::{self, NewTrack, Track},
};
use crate::error::{AppError, AppResult};
use crate::library::covers::{fetch_image, store_playlist_cover, store_track_cover};
use crate::library::names::{
    MAX_FOLDER_CHARS, is_safe_component, sanitize_component, track_file_stem, unique_name,
};
use crate::library::tags::write_basic_tags;
use crate::paths::AppPaths;
use crate::spotify::{
    embed::{EmbedError, fetch_playlist, fetch_track},
    model::{PlaylistMeta, TrackDetail, TrackMeta},
    url::{SpotifyKind, SpotifyRef, parse_spotify_url},
};
use crate::ytdlp::{
    download::{DownloadError, DownloadRequest, Phase, Progress, download_audio},
    matcher::{MatchOutcome, choose_best},
    search::{QueryVariant, search_candidates},
};

#[derive(Debug, Error)]
pub enum ImportError {
    #[error("another import is already running")]
    Busy,
    #[error(transparent)]
    Embed(#[from] EmbedError),
    #[error("database error: {0}")]
    Db(#[from] AppError),
    #[error("i/o error: {0}")]
    Io(#[from] std::io::Error),
    #[error("unsafe name in stored data")]
    UnsafeName,
    #[error("track not found")]
    NotFound,
    #[error("track cannot be retried")]
    NotRetryable,
}

impl ImportError {
    /// Stable code for the frontend to map to an i18n message.
    pub fn code(&self) -> &'static str {
        match self {
            ImportError::Busy => "import.busy",
            ImportError::Embed(e) => e.code(),
            ImportError::Db(_) => "import.db",
            ImportError::Io(_) => "import.io",
            ImportError::UnsafeName => "import.unsafe_name",
            ImportError::NotFound => "import.not_found",
            ImportError::NotRetryable => "import.not_retryable",
        }
    }
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

// ---------------------------------------------------------------- manager

struct ActiveImport {
    id: String,
    cancel: watch::Sender<bool>,
}

/// Only one import runs at a time. Registered as Tauri state.
#[derive(Clone, Default)]
pub struct ImportManager {
    active: Arc<Mutex<Option<ActiveImport>>>,
}

/// Holds the "an import is running" flag; releases it when dropped.
pub struct ImportSlot {
    active: Arc<Mutex<Option<ActiveImport>>>,
    id: String,
    cancel_rx: watch::Receiver<bool>,
}

impl ImportSlot {
    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn cancel_receiver(&self) -> watch::Receiver<bool> {
        self.cancel_rx.clone()
    }
}

impl Drop for ImportSlot {
    fn drop(&mut self) {
        let mut guard = lock(&self.active);
        if guard.as_ref().is_some_and(|a| a.id == self.id) {
            *guard = None;
        }
    }
}

impl ImportManager {
    pub fn begin(&self) -> Result<ImportSlot, ImportError> {
        let mut guard = lock(&self.active);
        if guard.is_some() {
            return Err(ImportError::Busy);
        }
        let id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = watch::channel(false);
        *guard = Some(ActiveImport {
            id: id.clone(),
            cancel: tx,
        });
        Ok(ImportSlot {
            active: self.active.clone(),
            id,
            cancel_rx: rx,
        })
    }

    /// Asks the running import to stop. Returns false if `import_id` is not the active one.
    pub fn cancel(&self, import_id: &str) -> bool {
        let guard = lock(&self.active);
        match guard.as_ref() {
            Some(a) if a.id == import_id => {
                let _ = a.cancel.send(true);
                true
            }
            _ => false,
        }
    }
}

// ---------------------------------------------------------------- preparing

/// What `start_import` found out and queued, before any download starts.
#[derive(Debug)]
pub struct Prepared {
    pub name: String,
    pub playlist_id: Option<i64>,
    pub items: Vec<WorkItem>,
    /// Tracks of the list that were already imported and still exist.
    pub already_done: usize,
    /// Tracks in the source list.
    pub total: usize,
    /// Duplicates and non-track entries that were ignored.
    pub skipped: usize,
    /// The playlist may have more tracks than Spotify's embed shows (A-05).
    pub truncated: bool,
}

/// Returned to the frontend when an import starts.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportStarted {
    pub import_id: String,
    pub playlist_id: Option<i64>,
    pub name: String,
    pub total: usize,
    pub to_download: usize,
    pub already_done: usize,
    pub skipped: usize,
    pub truncated: bool,
}

fn is_complete(row: &Track) -> bool {
    row.status == TrackStatus::Done.as_str()
        && row
            .file_path
            .as_deref()
            .is_some_and(|p| Path::new(p).is_file())
}

fn number_items(items: &mut [WorkItem]) {
    for (i, item) in items.iter_mut().enumerate() {
        item.index = i;
    }
}

pub fn prepare_playlist(
    db: &Database,
    paths: &AppPaths,
    meta: &PlaylistMeta,
) -> Result<Prepared, ImportError> {
    let conn = db.conn()?;
    let (playlist_id, folder) = match playlists::find_by_spotify_id(&conn, &meta.spotify_id)? {
        Some(p) => (p.id, p.folder),
        None => {
            let taken: HashSet<String> = playlists::list(&conn)?
                .into_iter()
                .map(|p| p.folder.to_lowercase())
                .collect();
            let base = sanitize_component(&meta.name, MAX_FOLDER_CHARS);
            let folder = unique_name(
                &base,
                |n| taken.contains(&n.to_lowercase()),
                MAX_FOLDER_CHARS,
            );
            let mut new = NewPlaylist::basic(&meta.name, &folder);
            new.spotify_id = Some(meta.spotify_id.clone());
            (playlists::insert(&conn, &new)?, folder)
        }
    };
    if !is_safe_component(&folder, MAX_FOLDER_CHARS) {
        return Err(ImportError::UnsafeName);
    }
    let dest_dir = paths.playlists_dir.join(&folder);
    std::fs::create_dir_all(&dest_dir)?;

    let mut items = Vec::new();
    let mut seen = HashSet::new();
    let (mut already_done, mut duplicates) = (0usize, 0usize);
    for (i, t) in meta.tracks.iter().enumerate() {
        // The same song twice in one playlist is imported once.
        if !seen.insert(t.spotify_id.clone()) {
            duplicates += 1;
            continue;
        }
        let track_id = match tracks::find_by_spotify(&conn, &t.spotify_id, Some(playlist_id))? {
            Some(row) if is_complete(&row) => {
                already_done += 1;
                continue;
            }
            Some(row) => {
                tracks::set_status(&conn, row.id, TrackStatus::Queued.as_str())?;
                row.id
            }
            None => {
                let mut new = NewTrack::basic(&t.title, &t.artist, i64::from(t.duration_ms));
                new.spotify_id = Some(t.spotify_id.clone());
                new.playlist_id = Some(playlist_id);
                new.position = Some(i as i64 + 1);
                tracks::insert(&conn, &new)?
            }
        };
        items.push(WorkItem {
            index: 0,
            track_id,
            stem: track_file_stem(Some((i + 1) as u32), &t.artist, &t.title),
            meta: t.clone(),
            dest_dir: dest_dir.clone(),
            cover_url: None,
            fallback_cover_url: meta.cover_url.clone(),
            retry: false,
        });
    }
    number_items(&mut items);

    Ok(Prepared {
        name: meta.name.clone(),
        playlist_id: Some(playlist_id),
        items,
        already_done,
        total: meta.tracks.len(),
        skipped: meta.skipped + duplicates,
        truncated: meta.may_be_truncated(),
    })
}

pub fn prepare_single(
    db: &Database,
    paths: &AppPaths,
    detail: &TrackDetail,
) -> Result<Prepared, ImportError> {
    let conn = db.conn()?;
    std::fs::create_dir_all(&paths.singles_dir)?;
    let t = &detail.track;

    let mut items = Vec::new();
    let mut already_done = 0usize;
    let existing = tracks::find_by_spotify(&conn, &t.spotify_id, None)?;
    if existing.as_ref().is_some_and(is_complete) {
        already_done = 1;
    } else {
        let track_id = match existing {
            Some(row) => {
                tracks::set_status(&conn, row.id, TrackStatus::Queued.as_str())?;
                row.id
            }
            None => {
                let mut new = NewTrack::basic(&t.title, &t.artist, i64::from(t.duration_ms));
                new.spotify_id = Some(t.spotify_id.clone());
                tracks::insert(&conn, &new)?
            }
        };
        items.push(WorkItem {
            index: 0,
            track_id,
            stem: track_file_stem(None, &t.artist, &t.title),
            meta: t.clone(),
            dest_dir: paths.singles_dir.clone(),
            cover_url: detail.cover_url.clone(),
            fallback_cover_url: None,
            retry: false,
        });
    }
    number_items(&mut items);

    Ok(Prepared {
        name: t.title.clone(),
        playlist_id: None,
        items,
        already_done,
        total: 1,
        skipped: 0,
        truncated: false,
    })
}

/// A single stored track, queued again with the plain search query.
pub fn prepare_retry(
    db: &Database,
    paths: &AppPaths,
    track_id: i64,
) -> Result<Prepared, ImportError> {
    let conn = db.conn()?;
    let row = tracks::get(&conn, track_id)?.ok_or(ImportError::NotFound)?;
    if is_complete(&row) {
        return Err(ImportError::NotRetryable);
    }
    let (dest_dir, position) = match row.playlist_id {
        Some(pid) => {
            let folder = playlists::list(&conn)?
                .into_iter()
                .find(|p| p.id == pid)
                .map(|p| p.folder)
                .ok_or(ImportError::NotFound)?;
            if !is_safe_component(&folder, MAX_FOLDER_CHARS) {
                return Err(ImportError::UnsafeName);
            }
            (
                paths.playlists_dir.join(folder),
                row.position.and_then(|p| u32::try_from(p).ok()),
            )
        }
        None => (paths.singles_dir.clone(), None),
    };
    std::fs::create_dir_all(&dest_dir)?;

    let meta = TrackMeta {
        spotify_id: row.spotify_id.clone().unwrap_or_default(),
        title: row.title.clone(),
        artist: row.artist.clone(),
        duration_ms: u32::try_from(row.duration_ms).unwrap_or(0),
    };
    tracks::set_status(&conn, row.id, TrackStatus::Queued.as_str())?;
    let item = WorkItem {
        index: 0,
        track_id: row.id,
        stem: track_file_stem(position, &meta.artist, &meta.title),
        meta,
        dest_dir,
        cover_url: None,
        fallback_cover_url: None,
        retry: true,
    };

    Ok(Prepared {
        name: row.title,
        playlist_id: row.playlist_id,
        items: vec![item],
        already_done: 0,
        total: 1,
        skipped: 0,
        truncated: false,
    })
}

/// A playlist cover that still has to be downloaded to `<folder>\cover.jpg`.
#[derive(Debug, Clone)]
pub struct PendingCover {
    pub playlist_id: i64,
    pub url: String,
    pub dest_dir: PathBuf,
}

/// Some only when the playlist has a cover URL and no usable cover file yet.
pub fn pending_playlist_cover(
    db: &Database,
    paths: &AppPaths,
    playlist_id: i64,
    cover_url: Option<&str>,
) -> Result<Option<PendingCover>, ImportError> {
    let Some(url) = cover_url else {
        return Ok(None);
    };
    let conn = db.conn()?;
    let Some(playlist) = playlists::list(&conn)?
        .into_iter()
        .find(|p| p.id == playlist_id)
    else {
        return Ok(None);
    };
    if playlist
        .cover_path
        .as_deref()
        .is_some_and(|p| Path::new(p).is_file())
    {
        return Ok(None);
    }
    if !is_safe_component(&playlist.folder, MAX_FOLDER_CHARS) {
        return Err(ImportError::UnsafeName);
    }
    Ok(Some(PendingCover {
        playlist_id,
        url: url.to_string(),
        dest_dir: paths.playlists_dir.join(&playlist.folder),
    }))
}

/// Best effort, in the background: a missing playlist cover never fails an import.
async fn store_pending_playlist_cover(app: &AppHandle, pending: PendingCover) {
    let image = match fetch_image(&pending.url).await {
        Ok(image) => image,
        Err(e) => {
            eprintln!("[import] playlist cover download failed: {e}");
            return;
        }
    };
    let path = match store_playlist_cover(&pending.dest_dir, &image) {
        Ok(path) => path,
        Err(e) => {
            eprintln!("[import] playlist cover could not be saved: {e}");
            return;
        }
    };
    let stored = path.to_string_lossy().into_owned();
    persist(&app.state::<Database>(), |c| {
        playlists::set_cover_path(c, pending.playlist_id, &stored)
    });
    let _ = app.emit("library://changed", ());
}

// ---------------------------------------------------------------- running

/// Maps a download progress report to the 0..1 share of the track's work.
/// Searching (5 %) and tagging (97 %) are covered by `TrackStatus::baseline`.
fn map_progress(p: Progress) -> f32 {
    match p.phase {
        Phase::Converting => 0.92,
        Phase::Downloading => 0.10 + 0.80 * p.fraction().unwrap_or(0.0),
    }
}

/// The real processor: search on YouTube, pick the best match, download it,
/// then tag it and fetch its cover.
struct AppProcessor {
    app: AppHandle,
    music_root: PathBuf,
}

impl AppProcessor {
    async fn run(&self, item: WorkItem, ctx: ItemCtx) -> ItemOutcome {
        if ctx.is_cancelled() {
            return ItemOutcome::Cancelled;
        }
        ctx.stage(TrackStatus::Searching);
        let variant = if item.retry {
            QueryVariant::Plain
        } else {
            QueryVariant::Audio
        };
        let candidates = match search_candidates(&self.app, &item.meta, variant).await {
            Ok(c) => c,
            Err(e) => {
                return ItemOutcome::Failed {
                    code: e.code().to_string(),
                };
            }
        };
        if ctx.is_cancelled() {
            return ItemOutcome::Cancelled;
        }
        let best = match choose_best(&item.meta, &candidates) {
            MatchOutcome::Accepted(s) => s,
            MatchOutcome::NeedsReview(_) => return ItemOutcome::NeedsReview,
        };
        ctx.matched(best.candidate.url(), best.score);
        ctx.stage(TrackStatus::Downloading);

        let req = DownloadRequest {
            video_id: &best.candidate.video_id,
            music_root: &self.music_root,
            dest_dir: &item.dest_dir,
            file_stem: &item.stem,
        };
        let mut cancel = ctx.cancel.clone();
        let result = download_audio(&self.app, &req, &mut cancel, |p| {
            ctx.fraction(map_progress(p));
        })
        .await;
        match result {
            Ok(outcome) => {
                self.finish_track(&item, &ctx, &outcome.path).await;
                ItemOutcome::Done { path: outcome.path }
            }
            Err(DownloadError::Cancelled) => ItemOutcome::Cancelled,
            Err(e) => ItemOutcome::Failed {
                code: e.code().to_string(),
            },
        }
    }

    /// Tags and cover are best effort (D-96): the audio is already usable, so a
    /// failure here is logged and never turns the track into a failed one.
    async fn finish_track(&self, item: &WorkItem, ctx: &ItemCtx, audio: &Path) {
        ctx.stage(TrackStatus::Tagging);
        ctx.fraction(0.97);

        let path = audio.to_path_buf();
        let title = item.meta.title.clone();
        let artist = item.meta.artist.clone();
        match tauri::async_runtime::spawn_blocking(move || {
            write_basic_tags(&path, &title, &artist, None)
        })
        .await
        {
            Ok(Ok(())) => {}
            Ok(Err(e)) => eprintln!("[import] could not write tags: {e}"),
            Err(e) => eprintln!("[import] tagging task failed: {e}"),
        }
        if ctx.is_cancelled() {
            return;
        }

        let Some(url) = self.resolve_cover_url(item).await else {
            return;
        };
        match fetch_image(&url).await {
            Ok(image) => match store_track_cover(&item.dest_dir, &item.stem, &image) {
                Ok(path) => ctx.cover(path),
                Err(e) => eprintln!("[import] cover could not be saved: {e}"),
            },
            Err(e) => eprintln!("[import] cover download failed: {e}"),
        }
    }

    /// The track's own cover (known for singles, else from its own embed), or the
    /// playlist's cover as a fallback (D-79 / D-97).
    async fn resolve_cover_url(&self, item: &WorkItem) -> Option<String> {
        if let Some(url) = &item.cover_url {
            return Some(url.clone());
        }
        let own = if item.meta.spotify_id.is_empty() {
            None
        } else {
            let link = format!("https://open.spotify.com/track/{}", item.meta.spotify_id);
            match parse_spotify_url(&link) {
                Ok(r) => fetch_track(&r).await.ok().and_then(|d| d.cover_url),
                Err(_) => None,
            }
        };
        own.or_else(|| item.fallback_cover_url.clone())
    }
}

impl Processor for AppProcessor {
    fn process<'a>(&'a self, item: WorkItem, ctx: ItemCtx) -> BoxFuture<'a, ItemOutcome> {
        Box::pin(self.run(item, ctx))
    }
}

fn persist(db: &Database, write: impl FnOnce(&Connection) -> AppResult<()>) {
    match db.conn() {
        Ok(conn) => {
            if let Err(e) = write(&conn) {
                eprintln!("[import] database write failed: {e}");
            }
        }
        Err(e) => eprintln!("[import] database unavailable: {e}"),
    }
}

fn emit_track_state(app: &AppHandle, import_id: &str, track_id: i64, status: TrackStatus) {
    let _ = app.emit(
        "import://track-state",
        TrackStatePayload {
            import_id: import_id.to_string(),
            track_id,
            status: status.as_str().to_string(),
        },
    );
}

fn push_progress(app: &AppHandle, import_id: &str, tracker: &Mutex<ProgressTracker>, force: bool) {
    let payload = {
        let mut t = lock(tracker);
        let changed = t.changed_enough();
        if !changed && !force {
            return;
        }
        ProgressPayload {
            import_id: import_id.to_string(),
            fraction: t.fraction(),
            finished: t.finished(),
            total: t.total(),
        }
    };
    let _ = app.emit("import://progress", payload);
}

/// The single place where updates become database writes and UI events.
fn make_sink(
    app: AppHandle,
    import_id: String,
    track_ids: Vec<i64>,
    tracker: Arc<Mutex<ProgressTracker>>,
) -> UpdateSink {
    Arc::new(move |update: Update| {
        let db = app.state::<Database>();
        match update {
            Update::Stage { index, status } => {
                let Some(&id) = track_ids.get(index) else {
                    return;
                };
                persist(&db, |c| tracks::set_status(c, id, status.as_str()));
                lock(&tracker).set_status(index, status);
                emit_track_state(&app, &import_id, id, status);
                push_progress(&app, &import_id, &tracker, false);
            }
            Update::Fraction { index, fraction } => {
                lock(&tracker).set_fraction(index, fraction);
                push_progress(&app, &import_id, &tracker, false);
            }
            Update::Matched {
                index,
                source_url,
                score,
            } => {
                let Some(&id) = track_ids.get(index) else {
                    return;
                };
                persist(&db, |c| {
                    tracks::set_match(c, id, &source_url, f64::from(score))
                });
            }
            Update::Cover { index, path } => {
                let Some(&id) = track_ids.get(index) else {
                    return;
                };
                let path = path.to_string_lossy().into_owned();
                persist(&db, |c| tracks::set_cover_path(c, id, &path));
            }
            Update::Finished { index, outcome } => {
                let Some(&id) = track_ids.get(index) else {
                    return;
                };
                let status = match &outcome {
                    ItemOutcome::Done { .. } => TrackStatus::Done,
                    ItemOutcome::NeedsReview => TrackStatus::NeedsReview,
                    ItemOutcome::Failed { .. } | ItemOutcome::Cancelled => TrackStatus::Failed,
                };
                if let ItemOutcome::Failed { code } = &outcome {
                    eprintln!("[import] track {id} failed: {code}");
                }
                match &outcome {
                    ItemOutcome::Done { path } => {
                        let path = path.to_string_lossy().into_owned();
                        persist(&db, |c| tracks::set_done(c, id, &path));
                    }
                    _ => persist(&db, |c| tracks::set_status(c, id, status.as_str())),
                }
                lock(&tracker).set_status(index, status);
                emit_track_state(&app, &import_id, id, status);
                push_progress(&app, &import_id, &tracker, true);
                let _ = app.emit("library://changed", ());
            }
        }
    })
}

/// Runs the queue in the background; the slot is released when everything ends.
fn spawn_run(app: AppHandle, slot: ImportSlot, items: Vec<WorkItem>) {
    let import_id = slot.id().to_string();
    let cancel = slot.cancel_receiver();
    let track_ids: Vec<i64> = items.iter().map(|i| i.track_id).collect();
    let tracker = Arc::new(Mutex::new(ProgressTracker::new(items.len())));
    let sink = make_sink(
        app.clone(),
        import_id.clone(),
        track_ids.clone(),
        tracker.clone(),
    );
    let processor = Arc::new(AppProcessor {
        music_root: app.state::<AppPaths>().music_dir.clone(),
        app: app.clone(),
    });

    tauri::async_runtime::spawn(async move {
        let cancelled = run_queue(items, processor, QueueConfig::default(), cancel, sink).await;

        // Safety net: nothing may stay "in progress" after the import ends.
        persist(&app.state::<Database>(), |c| {
            tracks::fail_unfinished(c, &track_ids)
        });
        let summary = lock(&tracker).summary(cancelled);
        let _ = app.emit("import://done", DonePayload { import_id, summary });
        let _ = app.emit("library://changed", ());
        drop(slot);
    });
}

fn launch(app: &AppHandle, slot: ImportSlot, prepared: Prepared) -> ImportStarted {
    let started = ImportStarted {
        import_id: slot.id().to_string(),
        playlist_id: prepared.playlist_id,
        name: prepared.name.clone(),
        total: prepared.total,
        to_download: prepared.items.len(),
        already_done: prepared.already_done,
        skipped: prepared.skipped,
        truncated: prepared.truncated,
    };
    if !prepared.items.is_empty() {
        spawn_run(app.clone(), slot, prepared.items);
    }
    started
}

/// Reads the list from Spotify, creates the rows and starts downloading in the
/// background. Errors here (network, private playlist...) are returned directly.
pub async fn start_import(app: &AppHandle, r: &SpotifyRef) -> Result<ImportStarted, ImportError> {
    let slot = app.state::<ImportManager>().begin()?;
    let prepared = match r.kind {
        SpotifyKind::Playlist => {
            let meta = fetch_playlist(r).await?;
            let prepared =
                prepare_playlist(&app.state::<Database>(), &app.state::<AppPaths>(), &meta)?;
            if let Some(id) = prepared.playlist_id {
                let pending = pending_playlist_cover(
                    &app.state::<Database>(),
                    &app.state::<AppPaths>(),
                    id,
                    meta.cover_url.as_deref(),
                )?;
                if let Some(pending) = pending {
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        store_pending_playlist_cover(&app, pending).await;
                    });
                }
            }
            prepared
        }
        SpotifyKind::Track => {
            let detail = fetch_track(r).await?;
            prepare_single(&app.state::<Database>(), &app.state::<AppPaths>(), &detail)?
        }
    };
    Ok(launch(app, slot, prepared))
}

pub fn retry_track(app: &AppHandle, track_id: i64) -> Result<ImportStarted, ImportError> {
    let slot = app.state::<ImportManager>().begin()?;
    let prepared = prepare_retry(&app.state::<Database>(), &app.state::<AppPaths>(), track_id)?;
    Ok(launch(app, slot, prepared))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::tracks::TrackFilter;
    use crate::ytdlp::download::Progress;
    use std::path::PathBuf;

    fn temp_paths() -> (AppPaths, PathBuf) {
        let root = std::env::temp_dir().join(format!("cupid-import-test-{}", uuid::Uuid::new_v4()));
        let paths = AppPaths::new(&root.join("data"), &root.join("Music").join("CupidPlayer"));
        paths.ensure_dirs().expect("create dirs");
        (paths, root)
    }

    fn tm(id: &str, artist: &str, title: &str) -> TrackMeta {
        TrackMeta {
            spotify_id: id.into(),
            title: title.into(),
            artist: artist.into(),
            duration_ms: 200_000,
        }
    }

    fn pl(name: &str, id: &str, tracks: Vec<TrackMeta>) -> PlaylistMeta {
        PlaylistMeta {
            spotify_id: id.into(),
            name: name.into(),
            owner: None,
            cover_url: Some("https://i.scdn.co/image/pl".into()),
            tracks,
            skipped: 0,
        }
    }

    fn list_tracks(db: &Database, playlist_id: Option<i64>) -> Vec<Track> {
        let conn = db.conn().expect("conn");
        tracks::list(
            &conn,
            &TrackFilter {
                query: None,
                playlist_id,
            },
        )
        .expect("list")
    }

    #[test]
    fn playlist_import_creates_rows_and_work_items() {
        let db = Database::open_in_memory().expect("db");
        let (paths, root) = temp_paths();
        let meta = pl(
            "B~腹芸",
            "pl1",
            vec![
                tm("t1", "Amaia", "C’est La Vie"),
                tm("t2", "Yves", "Loveeeeeee"),
            ],
        );
        let p = prepare_playlist(&db, &paths, &meta).expect("prepare");

        assert_eq!(
            (p.total, p.already_done, p.skipped, p.truncated),
            (2, 0, 0, false)
        );
        assert_eq!(p.items.len(), 2);
        assert_eq!(p.items[0].stem, "01 - Amaia - C’est La Vie");
        assert_eq!(p.items[1].index, 1);
        assert!(p.items[0].dest_dir.ends_with("B~腹芸"));
        assert!(p.items[0].dest_dir.is_dir());
        assert_eq!(
            p.items[0].fallback_cover_url.as_deref(),
            Some("https://i.scdn.co/image/pl")
        );
        assert!(!p.items[0].retry);

        let conn = db.conn().expect("conn");
        let pls = playlists::list(&conn).expect("playlists");
        assert_eq!(pls.len(), 1);
        assert_eq!(pls[0].folder, "B~腹芸");
        assert_eq!(pls[0].track_count, 2);
        drop(conn);
        let rows = list_tracks(&db, Some(pls_id(&db)));
        let positions: Vec<_> = rows.iter().map(|t| t.position).collect();
        assert_eq!(positions, [Some(1), Some(2)]);
        assert!(rows.iter().all(|t| t.status == "queued"));
        let _ = std::fs::remove_dir_all(&root);
    }

    fn pls_id(db: &Database) -> i64 {
        let conn = db.conn().expect("conn");
        playlists::list(&conn).expect("playlists")[0].id
    }

    #[test]
    fn reimport_skips_finished_tracks_and_requeues_the_rest() {
        let db = Database::open_in_memory().expect("db");
        let (paths, root) = temp_paths();
        let meta = pl(
            "Mix",
            "pl1",
            vec![tm("t1", "A", "One"), tm("t2", "B", "Two")],
        );
        let first = prepare_playlist(&db, &paths, &meta).expect("prepare");

        let file = first.items[0].dest_dir.join("01 - A - One.opus");
        std::fs::write(&file, b"x").expect("write file");
        {
            let conn = db.conn().expect("conn");
            tracks::set_done(&conn, first.items[0].track_id, &file.to_string_lossy())
                .expect("done");
            tracks::set_status(&conn, first.items[1].track_id, "failed").expect("failed");
        }

        let again = prepare_playlist(&db, &paths, &meta).expect("prepare again");
        assert_eq!(again.already_done, 1);
        assert_eq!(again.items.len(), 1);
        assert_eq!(again.items[0].track_id, first.items[1].track_id);
        assert_eq!(again.playlist_id, first.playlist_id);
        let rows = list_tracks(&db, first.playlist_id);
        assert_eq!(rows.len(), 2, "no duplicate rows");
        assert!(rows.iter().any(|t| t.status == "queued"));

        // A finished track whose file disappeared is downloaded again.
        std::fs::remove_file(&file).expect("remove file");
        let third = prepare_playlist(&db, &paths, &meta).expect("prepare third");
        assert_eq!((third.already_done, third.items.len()), (0, 2));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn duplicates_are_skipped_and_same_named_playlists_get_their_own_folder() {
        let db = Database::open_in_memory().expect("db");
        let (paths, root) = temp_paths();
        let dup = pl(
            "Mix",
            "pl1",
            vec![tm("t1", "A", "T"), tm("t1", "A", "T"), tm("t2", "B", "U")],
        );
        let p = prepare_playlist(&db, &paths, &dup).expect("prepare");
        assert_eq!((p.items.len(), p.skipped, p.total), (2, 1, 3));

        let other = pl("Mix", "pl2", vec![tm("t3", "C", "V")]);
        prepare_playlist(&db, &paths, &other).expect("prepare other");
        let conn = db.conn().expect("conn");
        let mut folders: Vec<String> = playlists::list(&conn)
            .expect("playlists")
            .into_iter()
            .map(|p| p.folder)
            .collect();
        folders.sort();
        assert_eq!(folders, ["Mix", "Mix (2)"]);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn truncated_playlists_are_flagged() {
        let db = Database::open_in_memory().expect("db");
        let (paths, root) = temp_paths();
        let tracks_100: Vec<TrackMeta> = (0..100)
            .map(|i| tm(&format!("id{i}"), "A", &format!("T{i}")))
            .collect();
        let p = prepare_playlist(&db, &paths, &pl("Big", "pl1", tracks_100)).expect("prepare");
        assert!(p.truncated);
        assert_eq!(p.items[99].stem, "100 - A - T99");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn single_track_import_and_reimport() {
        let db = Database::open_in_memory().expect("db");
        let (paths, root) = temp_paths();
        let detail = TrackDetail {
            track: tm("s1", "Car, the garden", "Scars leave beautiful trace"),
            cover_url: Some("https://i.scdn.co/image/x".into()),
        };
        let p = prepare_single(&db, &paths, &detail).expect("prepare");
        assert_eq!((p.items.len(), p.already_done, p.playlist_id), (1, 0, None));
        assert_eq!(
            p.items[0].stem,
            "Car, the garden - Scars leave beautiful trace"
        );
        assert_eq!(p.items[0].dest_dir, paths.singles_dir);
        assert_eq!(
            p.items[0].cover_url.as_deref(),
            Some("https://i.scdn.co/image/x")
        );

        let file = paths.singles_dir.join("done.opus");
        std::fs::write(&file, b"x").expect("write file");
        {
            let conn = db.conn().expect("conn");
            tracks::set_done(&conn, p.items[0].track_id, &file.to_string_lossy()).expect("done");
        }
        let again = prepare_single(&db, &paths, &detail).expect("prepare again");
        assert_eq!((again.items.len(), again.already_done), (0, 1));
        assert_eq!(list_tracks(&db, None).len(), 1);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn retry_uses_the_plain_query_and_the_stored_location() {
        let db = Database::open_in_memory().expect("db");
        let (paths, root) = temp_paths();
        let p = prepare_playlist(&db, &paths, &pl("Mix", "pl1", vec![tm("t1", "A", "One")]))
            .expect("prepare");
        let id = p.items[0].track_id;
        {
            let conn = db.conn().expect("conn");
            tracks::set_status(&conn, id, "needs_review").expect("status");
        }

        let r = prepare_retry(&db, &paths, id).expect("retry");
        assert_eq!(r.items.len(), 1);
        assert!(r.items[0].retry);
        assert_eq!(r.items[0].stem, "01 - A - One");
        assert_eq!(r.items[0].dest_dir, p.items[0].dest_dir);

        assert!(matches!(
            prepare_retry(&db, &paths, 9999),
            Err(ImportError::NotFound)
        ));

        let file = r.items[0].dest_dir.join("01 - A - One.opus");
        std::fs::write(&file, b"x").expect("write file");
        {
            let conn = db.conn().expect("conn");
            tracks::set_done(&conn, id, &file.to_string_lossy()).expect("done");
        }
        assert!(matches!(
            prepare_retry(&db, &paths, id),
            Err(ImportError::NotRetryable)
        ));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn only_one_import_at_a_time_and_it_can_be_cancelled() {
        let manager = ImportManager::default();
        let slot = manager.begin().expect("first import");
        assert!(matches!(manager.begin(), Err(ImportError::Busy)));

        let rx = slot.cancel_receiver();
        assert!(!*rx.borrow());
        assert!(!manager.cancel("wrong-id"));
        assert!(!*rx.borrow());
        assert!(manager.cancel(slot.id()));
        assert!(*rx.borrow());

        drop(slot);
        let again = manager.begin().expect("slot is free again");
        assert!(!manager.cancel("stale-id"));
        drop(again);
    }

    #[test]
    fn progress_maps_to_the_share_of_the_track() {
        use crate::ytdlp::download::Phase;
        let p = |phase, downloaded, total| Progress {
            phase,
            downloaded,
            total,
        };
        assert!((map_progress(p(Phase::Downloading, 50, Some(100))) - 0.5).abs() < 1e-6);
        assert!((map_progress(p(Phase::Downloading, 50, None)) - 0.10).abs() < 1e-6);
        assert!((map_progress(p(Phase::Converting, 0, None)) - 0.92).abs() < 1e-6);
    }

    #[test]
    fn error_codes_are_stable() {
        assert_eq!(ImportError::Busy.code(), "import.busy");
        assert_eq!(ImportError::NotRetryable.code(), "import.not_retryable");
        assert_eq!(
            ImportError::Embed(EmbedError::NoTracks).code(),
            "embed.no_tracks"
        );
    }

    #[test]
    fn playlist_cover_is_only_pending_when_missing() {
        let db = Database::open_in_memory().expect("db");
        let (paths, root) = temp_paths();
        let p = prepare_playlist(&db, &paths, &pl("Mix", "pl1", vec![tm("t1", "A", "One")]))
            .expect("prepare");
        let pid = p.playlist_id.expect("playlist id");
        let url = Some("https://i.scdn.co/image/pl");

        let pending = pending_playlist_cover(&db, &paths, pid, url)
            .expect("pending")
            .expect("cover is missing");
        assert_eq!(pending.url, "https://i.scdn.co/image/pl");
        assert!(pending.dest_dir.ends_with("Mix"));
        assert!(
            pending_playlist_cover(&db, &paths, pid, None)
                .expect("pending")
                .is_none()
        );

        let cover = pending.dest_dir.join("cover.jpg");
        std::fs::write(&cover, b"x").expect("write cover");
        {
            let conn = db.conn().expect("conn");
            playlists::set_cover_path(&conn, pid, &cover.to_string_lossy()).expect("set cover");
        }
        assert!(
            pending_playlist_cover(&db, &paths, pid, url)
                .expect("pending")
                .is_none()
        );

        std::fs::remove_file(&cover).expect("remove cover");
        assert!(
            pending_playlist_cover(&db, &paths, pid, url)
                .expect("pending")
                .is_some()
        );
        let _ = std::fs::remove_dir_all(&root);
    }
}
