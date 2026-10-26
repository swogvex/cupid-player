//! In-app updates (H14.2).
//!
//! Everything happens in Rust: the webview has no network access and no updater permission.
//! The frontend only calls these commands. Errors are stable codes ("updater.*") that the UI
//! translates (D-99).

use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_updater::{Update, UpdaterExt};

/// The update found by the last check, kept until the user confirms the install.
#[derive(Default)]
pub struct PendingUpdate(Mutex<Option<Update>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub current_version: String,
}

/// Error text without any URL (logs never contain links, D-159).
fn short(e: &impl std::fmt::Display) -> String {
    let s = e.to_string();
    match s.find("http") {
        Some(i) => s[..i].trim().to_string(),
        None => s,
    }
}

#[tauri::command]
pub fn get_app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

/// Looks for a newer version. Resolves with its info, or null if this is the latest.
#[tauri::command]
pub async fn check_update(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
) -> Result<Option<UpdateInfo>, String> {
    let updater = app.updater().map_err(|e| {
        log::warn!("[updater] not available: {}", short(&e));
        "updater.unavailable".to_string()
    })?;
    let found = updater.check().await.map_err(|e| {
        log::warn!("[updater] check failed: {}", short(&e));
        "updater.check_failed".to_string()
    })?;

    let info = found.as_ref().map(|u| UpdateInfo {
        version: u.version.clone(),
        current_version: u.current_version.clone(),
    });
    match &info {
        Some(i) => log::info!("[updater] new version available: {}", i.version),
        None => log::info!("[updater] already on the latest version"),
    }
    *pending.0.lock().unwrap_or_else(|p| p.into_inner()) = found;
    Ok(info)
}

/// Downloads, verifies (minisign) and installs the update found by `check_update`.
/// On Windows the installer closes the app itself and starts the new version.
#[tauri::command]
pub async fn install_update(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
) -> Result<(), String> {
    let update = pending
        .0
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .take()
        .ok_or_else(|| "updater.no_pending".to_string())?;

    log::info!("[updater] installing {}", update.version);
    let result = update
        .download_and_install(|_chunk, _total| {}, || {})
        .await;
    match result {
        // Only reached on platforms where the process is still alive after installing.
        Ok(()) => app.restart(),
        Err(e) => {
            log::warn!("[updater] install failed: {}", short(&e));
            // Keep it so the user can try again without checking again.
            *pending.0.lock().unwrap_or_else(|p| p.into_inner()) = Some(update);
            Err("updater.install_failed".to_string())
        }
    }
}
