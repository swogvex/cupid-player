import { convertFileSrc } from "@tauri-apps/api/core";

/** One <audio> element for the whole app. It has no UI and no store imports (see init.ts). */
const el = new Audio();
el.preload = "auto";

export const fileUrl = (path: string): string => convertFileSrc(path);

export async function play(): Promise<void> {
  try {
    await el.play();
  } catch (e) {
    // A newer load()/pause() interrupts the pending play(): that is not a failure.
    if (e instanceof DOMException && e.name === "AbortError") return;
    throw e;
  }
}

export async function load(path: string, autoplay: boolean): Promise<void> {
  el.src = fileUrl(path);
  if (autoplay) await play();
}

export const pause = (): void => el.pause();

export function seek(seconds: number): void {
  if (Number.isFinite(seconds)) el.currentTime = Math.max(0, seconds);
}

export const setVolume = (v: number): void => {
  el.volume = Math.min(1, Math.max(0, v));
};

export function unload(): void {
  el.pause();
  el.removeAttribute("src");
  el.load();
}

export const position = (): number => el.currentTime;
/** 0 while unknown (some streams report NaN/Infinity). */
export const duration = (): number => (Number.isFinite(el.duration) ? el.duration : 0);

export type EngineHandlers = {
  time: (position: number, duration: number) => void;
  state: (playing: boolean) => void;
  started: () => void;
  ended: () => void;
  error: () => void;
};

export function subscribe(h: EngineHandlers): () => void {
  const onTime = () => h.time(position(), duration());
  const listeners: [string, EventListener][] = [
    ["timeupdate", onTime],
    ["durationchange", onTime],
    ["play", () => h.state(true)],
    ["pause", () => h.state(false)],
    ["playing", () => h.started()],
    ["ended", () => h.ended()],
    ["error", () => h.error()],
  ];
  for (const [name, fn] of listeners) el.addEventListener(name, fn);
  return () => {
    for (const [name, fn] of listeners) el.removeEventListener(name, fn);
  };
}