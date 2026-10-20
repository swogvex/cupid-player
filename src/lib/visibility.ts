/** Writes data-paused on <html> while the window is hidden or minimised (CSS pauses the animations). */
export function startVisibilityTracking(): () => void {
  const apply = () => {
    document.documentElement.dataset.paused = document.hidden ? "true" : "false";
  };
  apply();
  document.addEventListener("visibilitychange", apply);
  return () => document.removeEventListener("visibilitychange", apply);
}