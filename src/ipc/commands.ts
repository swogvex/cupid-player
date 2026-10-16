import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** Resizes the window to 352*n x 208*n. Resolves with the scale actually applied. */
export function setWindowScale(n: number): Promise<number> {
  return invoke<number>("set_window_scale", { n });
}

export const minimizeWindow = (): Promise<void> => getCurrentWindow().minimize();
export const toggleMaximizeWindow = (): Promise<void> => getCurrentWindow().toggleMaximize();
export const closeWindow = (): Promise<void> => getCurrentWindow().close();
export const isWindowMaximized = (): Promise<boolean> => getCurrentWindow().isMaximized();
export const setAlwaysOnTop = (value: boolean): Promise<void> =>
  getCurrentWindow().setAlwaysOnTop(value);