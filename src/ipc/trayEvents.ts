import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export const onTrayPlayPause = (cb: () => void): Promise<UnlistenFn> =>
  listen("tray://play-pause", cb);

export const onTrayNext = (cb: () => void): Promise<UnlistenFn> => listen("tray://next", cb);