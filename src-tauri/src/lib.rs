mod commands;
mod db;
mod error;
#[allow(dead_code)] // temporal: se usa desde los comandos en 7.3.7
mod import;
#[allow(dead_code)] // temporal: se usa desde los comandos en 7.3.7
mod library;
mod lyrics;
mod paths;
#[allow(dead_code)] // temporal: se usa desde los comandos en 7.3.7
mod spotify;
mod stats;
mod window;
#[allow(dead_code)] // temporal: se usa desde los comandos en 7.3.7
mod ytdlp;

use std::sync::atomic::Ordering;

use tauri::Manager;
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // single-instance must be registered first.
        // Arguments are ignored on purpose: nothing from a second launch reaches the app.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            window::tray::show_main(app);
        }))
        .plugin(tauri_plugin_shell::init())
        // Remember position and size (the mini size is undone before exiting).
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::POSITION | StateFlags::SIZE)
                .build(),
        )
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() != "main" {
                    return;
                }
                let app = window.app_handle();
                let to_tray = app
                    .try_state::<window::tray::TrayState>()
                    .is_some_and(|s| s.close_to_tray.load(Ordering::Relaxed));
                if to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                    return;
                }
                // Really closing: undo the mini size and store the normal one.
                if window::mini::leave_mini(app) {
                    let _ = app.save_window_state(StateFlags::POSITION | StateFlags::SIZE);
                }
            }
        })
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

            let tray = window::tray::build(app.handle())?;
            app.manage(tray);
            app.manage(window::mini::MiniState::default());
            app.manage(import::runner::ImportManager::default());
            app.manage(paths);
            app.manage(database);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            window::scale::set_window_scale,
            window::mini::set_mini_mode,
            window::tray::set_close_to_tray,
            window::tray::set_tray_labels,
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
            commands::get_lyrics,
            commands::get_lyrics_offset,
            commands::set_lyrics_offset,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}