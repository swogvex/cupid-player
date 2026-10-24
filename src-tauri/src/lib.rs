mod commands;
mod db;
mod error;
#[allow(dead_code)] // temporal: se usa desde los comandos en 7.3.7
mod import;
#[allow(dead_code)] // temporal: se usa desde los comandos en 7.3.7
mod library;
mod paths;
#[allow(dead_code)] // temporal: se usa desde los comandos en 7.3.7
mod spotify;
mod stats;
mod window;
#[allow(dead_code)] // temporal: se usa desde los comandos en 7.3.7
mod ytdlp;

use tauri::Manager;
use tauri_plugin_window_state::StateFlags;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // single-instance must be registered first.
        // Arguments are ignored on purpose: nothing from a second launch reaches the app.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        // Only remember position; size is governed by the integer scale.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::POSITION | StateFlags::SIZE)
                .build(),
        )
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let paths = paths::AppPaths::resolve(app.handle())?;
            paths.ensure_dirs()?;
            let database = db::Database::open(&paths.db_file)?;
            {
                let conn = database.conn()?;
                // A closed app can leave tracks "in progress": make them retryable.
                db::tracks::fail_all_unfinished(&conn)?;
                // Tracks stored with duration 0 get the real length of their file (H8).
                match library::edit::backfill_durations(&conn, &paths.music_dir) {
                    Ok(0) => {}
                    Ok(n) => eprintln!("[library] fixed {n} missing durations"),
                    Err(e) => eprintln!("[library] duration backfill failed: {e}"),
                }
                // Freeze the summary of every finished month (also covers an app that stayed
                // closed for months). A failure here must never stop the app from opening.
                match stats::rollup::close_pending_months(&conn, chrono::Local::now()) {
                    Ok(months) if months.is_empty() => {}
                    Ok(months) => eprintln!("[stats] closed months: {}", months.join(", ")),
                    Err(e) => eprintln!("[stats] monthly close failed: {e}"),
                }
            }

            #[cfg(debug_assertions)]
            if std::env::var("CUPID_SEED").is_ok() {
                database.seed_dev_data()?;
                database.seed_dev_audio(&paths.singles_dir)?;
            }

            app.manage(import::runner::ImportManager::default());
            app.manage(paths);
            app.manage(database);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            window::scale::set_window_scale,
            commands::list_tracks,
            commands::list_playlists,
            commands::list_playlist_members,
            commands::create_playlist,
            commands::rename_playlist,
            commands::delete_playlist,
            commands::add_to_playlist,
            commands::remove_from_playlist,
            commands::reveal_playlist,
            commands::get_music_dir,
            commands::parse_spotify_url,
            commands::start_import,
            commands::cancel_import,
            commands::retry_track,
            commands::update_tags,
            commands::delete_track,
            commands::pick_cover,
            commands::commit_cover,
            commands::discard_cover,
            commands::reveal_track,
            commands::scan_folder,
            commands::get_cache_info,
            commands::clear_cache,
            commands::open_music_folder,
            commands::start_play,
            commands::update_play,
            commands::get_stats,
            commands::list_stat_months,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
