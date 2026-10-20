import { convertFileSrc } from "@tauri-apps/api/core";
import { usePlayerStore, type PlayerTrack } from "../state/playerStore";

/** Metadata + media keys through the webview's MediaSession API. */
export function initMediaSession(): () => void {
  if (!("mediaSession" in navigator)) return () => {};
  const ms = navigator.mediaSession;
  const p = () => usePlayerStore.getState();

  const actions: [MediaSessionAction, MediaSessionActionHandler][] = [
    ["play", () => p().play()],
    ["pause", () => p().pause()],
    ["previoustrack", () => p().prev()],
    ["nexttrack", () => p().next()],
    ["seekbackward", (d) => p().seekBy(-(d.seekOffset ?? 5))],
    ["seekforward", (d) => p().seekBy(d.seekOffset ?? 5)],
    [
      "seekto",
      (d) => {
        const { duration } = p();
        if (d.seekTime !== undefined && duration > 0) p().seekRatio(d.seekTime / duration);
      },
    ],
  ];
  for (const [action, handler] of actions) {
    try {
      ms.setActionHandler(action, handler);
    } catch {
      /* action not supported by this webview */
    }
  }

  let lastTrack: PlayerTrack | null = null;
  let lastPlaying = false;

  const unsubscribe = usePlayerStore.subscribe((s) => {
    const track = s.queue[s.index] ?? null;
    if (track !== lastTrack) {
      lastTrack = track;
      ms.metadata = track
        ? new MediaMetadata({
            title: track.title,
            artist: track.artist,
            album: track.album ?? "",
            artwork: track.coverPath ? [{ src: convertFileSrc(track.coverPath) }] : [],
          })
        : null;
    }
    if (track && (s.playing !== lastPlaying || track !== lastTrack)) {
      try {
        if (s.duration > 0 && s.position <= s.duration) {
          ms.setPositionState({ duration: s.duration, position: s.position, playbackRate: 1 });
        }
      } catch {
        /* invalid state: ignore */
      }
    }
    lastPlaying = s.playing;
    ms.playbackState = track ? (s.playing ? "playing" : "paused") : "none";
  });

  return () => {
    unsubscribe();
    for (const [action] of actions) {
      try {
        ms.setActionHandler(action, null);
      } catch {
        /* ignore */
      }
    }
    ms.metadata = null;
  };
}