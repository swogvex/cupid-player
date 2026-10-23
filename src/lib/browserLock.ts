/**
 * Makes the webview behave like an app, not a browser page: no browser context
 * menu, no reload/print/save/find shortcuts and no page zoom (zoom would break
 * the integer pixel scale). Dev builds keep reload, DevTools and Ctrl+right click.
 */
export function lockBrowserUi(): void {
  const dev = import.meta.env.DEV;

  document.addEventListener("contextmenu", (e) => {
    const target = e.target instanceof Element ? e.target : null;
    // Text fields keep the native menu (cut / copy / paste).
    if (target?.closest("input, textarea, [contenteditable='true']")) return;
    // While developing, Ctrl+right click opens the native menu ("Inspect").
    if (dev && e.ctrlKey) return;
    e.preventDefault();
  });

  window.addEventListener("keydown", (e) => {
    const key = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    const zoom = mod && ["+", "=", "-", "_", "0"].includes(key);
    const browser =
      key === "f3" ||
      key === "f5" ||
      key === "f7" ||
      (mod && ["r", "p", "s", "f", "g", "u"].includes(key));
    if (zoom || (!dev && browser)) e.preventDefault();
  });

  // Ctrl + wheel (and touchpad pinch) zooms the page.
  window.addEventListener(
    "wheel",
    (e) => {
      if (e.ctrlKey) e.preventDefault();
    },
    { passive: false },
  );
}