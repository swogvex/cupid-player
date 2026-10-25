use std::sync::atomic::{AtomicBool, Ordering};

use serde::Deserialize;
use tauri::{
    AppHandle, Emitter, Manager, State, Wry,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

use crate::error::AppError;
use crate::window::mini;

pub const EVT_PLAY_PAUSE: &str = "tray://play-pause";
pub const EVT_NEXT: &str = "tray://next";

pub struct TrayState {
    show: MenuItem<Wry>,
    play_pause: MenuItem<Wry>,
    next: MenuItem<Wry>,
    quit: MenuItem<Wry>,
    /// Mirrors the "close to tray" setting (the frontend owns the real value).
    pub close_to_tray: AtomicBool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayLabels {
    show: String,
    play_pause: String,
    next: String,
    quit: String,
}

/// Brings the main window back (also from the minimized or hidden state).
pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

pub fn build(app: &AppHandle) -> tauri::Result<TrayState> {
    let show = MenuItem::with_id(app, "tray_show", "Show", true, None::<&str>)?;
    let play_pause = MenuItem::with_id(app, "tray_play", "Play / Pause", true, None::<&str>)?;
    let next = MenuItem::with_id(app, "tray_next", "Next", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "tray_quit", "Quit", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&show, &play_pause, &next, &separator, &quit])?;

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("cupid player")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray_show" => show_main(app),
            "tray_play" => {
                let _ = app.emit(EVT_PLAY_PAUSE, ());
            }
            "tray_next" => {
                let _ = app.emit(EVT_NEXT, ());
            }
            "tray_quit" => {
                // Restore the normal size first so window-state saves it, not the mini one.
                mini::leave_mini(app);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;

    Ok(TrayState {
        show,
        play_pause,
        next,
        quit,
        close_to_tray: AtomicBool::new(false),
    })
}

#[tauri::command]
pub fn set_close_to_tray(state: State<'_, TrayState>, value: bool) {
    state.close_to_tray.store(value, Ordering::Relaxed);
}

#[tauri::command]
pub fn set_tray_labels(state: State<'_, TrayState>, labels: TrayLabels) -> Result<(), AppError> {
    state.show.set_text(labels.show)?;
    state.play_pause.set_text(labels.play_pause)?;
    state.next.set_text(labels.next)?;
    state.quit.set_text(labels.quit)?;
    Ok(())
}