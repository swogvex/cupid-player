use std::sync::{Mutex, MutexGuard};

use tauri::{
    AppHandle, LogicalSize, Manager, PhysicalPosition, PhysicalSize, State, WebviewWindow,
};

use crate::error::AppError;

/// 104 x 156 logical design pixels at a fixed x2 scale (keep in sync with BASES.mini in scale.ts).
const MINI_W: f64 = 208.0;
const MINI_H: f64 = 312.0;
/// Must match `minWidth` / `minHeight` in tauri.conf.json.
const FULL_MIN_W: f64 = 736.0;
const FULL_MIN_H: f64 = 432.0;

#[derive(Clone, Copy)]
struct Saved {
    size: PhysicalSize<u32>,
    position: PhysicalPosition<i32>,
}

/// Window geometry saved while the mini player is active (`None` = normal mode).
#[derive(Default)]
pub struct MiniState {
    saved: Mutex<Option<Saved>>,
}

fn lock(state: &MiniState) -> MutexGuard<'_, Option<Saved>> {
    state.saved.lock().unwrap_or_else(|e| e.into_inner())
}

fn enter(window: &WebviewWindow, state: &MiniState) -> Result<(), AppError> {
    let mut slot = lock(state);
    if slot.is_some() {
        return Ok(());
    }
    // A maximized window is restored first; leaving mini returns to the normal size.
    if window.is_maximized()? {
        window.unmaximize()?;
    }
    let saved = Saved {
        size: window.inner_size()?,
        position: window.outer_position()?,
    };
    window.set_maximizable(false)?;
    window.set_min_size(Some(LogicalSize::new(MINI_W, MINI_H)))?;
    window.set_size(LogicalSize::new(MINI_W, MINI_H))?;
    window.set_resizable(false)?;
    *slot = Some(saved);
    Ok(())
}

fn leave(window: &WebviewWindow, state: &MiniState) -> Result<bool, AppError> {
    let mut slot = lock(state);
    let Some(saved) = slot.take() else {
        return Ok(false);
    };
    window.set_resizable(true)?;
    window.set_maximizable(true)?;
    window.set_min_size(Some(LogicalSize::new(FULL_MIN_W, FULL_MIN_H)))?;
    window.set_size(saved.size)?;
    window.set_position(saved.position)?;
    Ok(true)
}

/// Restores the normal size if the mini player is active. Returns true if it changed anything.
/// Called before the app exits so `window-state` never stores the mini size.
pub fn leave_mini(app: &AppHandle) -> bool {
    let (Some(window), Some(state)) = (app.get_webview_window("main"), app.try_state::<MiniState>())
    else {
        return false;
    };
    match leave(&window, &state) {
        Ok(changed) => changed,
        Err(e) => {
            eprintln!("[mini] could not restore the window: {e}");
            false
        }
    }
}

#[tauri::command]
pub fn set_mini_mode(
    window: WebviewWindow,
    state: State<'_, MiniState>,
    on: bool,
) -> Result<(), AppError> {
    if on {
        enter(&window, &state)
    } else {
        leave(&window, &state).map(|_| ())
    }
}