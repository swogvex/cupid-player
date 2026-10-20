use tauri::{LogicalSize, WebviewWindow};

use crate::error::AppError;

const BASE_W: f64 = 352.0;
const BASE_H: f64 = 208.0;
const MIN_SCALE: u32 = 2;
const MAX_SCALE: u32 = 4;
/// Logical pixels reserved for the taskbar and window chrome.
const SCREEN_MARGIN: f64 = 64.0;

/// Largest scale <= `wanted` whose window fits on the current monitor.
fn fit_to_screen(window: &WebviewWindow, wanted: u32) -> Result<u32, AppError> {
    let Some(monitor) = window.current_monitor()? else {
        return Ok(wanted);
    };
    let factor = monitor.scale_factor();
    let max_w = monitor.size().width as f64 / factor;
    let max_h = monitor.size().height as f64 / factor - SCREEN_MARGIN;

    let mut s = wanted;
    while s > MIN_SCALE && (BASE_W * s as f64 > max_w || BASE_H * s as f64 > max_h) {
        s -= 1;
    }
    Ok(s)
}

/// Sets the window inner size to (352*n) x (208*n), limited to the screen.
/// Returns the scale actually applied.
#[tauri::command]
pub fn set_window_scale(window: WebviewWindow, n: u32) -> Result<u32, AppError> {
    if !(MIN_SCALE..=MAX_SCALE).contains(&n) {
        return Err(AppError::InvalidScale(n));
    }
    let applied = fit_to_screen(&window, n)?;
    if window.is_maximized()? {
        window.unmaximize()?;
    }
    window.set_size(LogicalSize::new(
        BASE_W * applied as f64,
        BASE_H * applied as f64,
    ))?;
    Ok(applied)
}
