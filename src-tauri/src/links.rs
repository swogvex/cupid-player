//! Links the app opens in the system browser. URLs are constants: the webview cannot choose them.

const DONATE_URL: &str = "https://ko-fi.com/swogvex";

#[tauri::command]
pub fn open_donate_page() -> Result<(), String> {
    tauri_plugin_opener::open_url(DONATE_URL, None::<&str>).map_err(|e| {
        log::warn!("[links] could not open the donate page: {e}");
        "donate.open_failed".to_string()
    })
}
