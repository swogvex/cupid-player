mod commands;
mod db;
mod error;
mod paths;
#[allow(dead_code)] // temporal: se usa desde los comandos en 7.3.7
mod spotify;
mod window;

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
        .setup(|app| {
            let paths = paths::AppPaths::resolve(app.handle())?;
            paths.ensure_dirs()?;
            let database = db::Database::open(&paths.db_file)?;

            #[cfg(debug_assertions)]
            if std::env::var("CUPID_SEED").is_ok() {
                database.seed_dev_data()?;
                database.seed_dev_audio(&paths.singles_dir)?;
            }

            app.manage(paths);
            app.manage(database);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            window::scale::set_window_scale,
            commands::list_tracks,
            commands::list_playlists,
            commands::get_music_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
