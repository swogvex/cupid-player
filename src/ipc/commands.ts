import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type {
  CacheCleared,
  CacheInfo,
  ImportStarted,
  Lyrics,
  MonthStats,
  ParsedLink,
  Playlist,
  PlaylistMember,
  ScanReport,
  Track,
  TrackFilter,
  UpdateInfo,
  Wrapped,
} from "./types";

// Single entry point to Rust: components never call invoke() directly.
export const listTracks = (filter?: TrackFilter) =>
  invoke<Track[]>("list_tracks", { filter });

export const listPlaylists = () => invoke<Playlist[]>("list_playlists");

export const getMusicDir = () => invoke<string>("get_music_dir");

/** Validates a pasted link without touching the network. Rejects with an error code. */
export const parseSpotifyUrl = (url: string) => invoke<ParsedLink>("parse_spotify_url", { url });

/** Rejects with a stable error code such as "embed.not_found" or "import.busy". */
export const startImport = (url: string) => invoke<ImportStarted>("start_import", { url });

export const cancelImport = (importId: string) => invoke<boolean>("cancel_import", { importId });

export const retryTrack = (trackId: number) => invoke<ImportStarted>("retry_track", { trackId });

export interface TagsInput {
  title: string;
  artist: string;
  album: string | null;
}

/** Writes title/artist/album to the database and the file. Rejects with "library.*" codes. */
export const updateTags = (trackId: number, tags: TagsInput) =>
  invoke<Track>("update_tags", { trackId, tags });

/** Removes the track; with deleteFile also the audio file. Rejects with "library.*" codes. */
export const deleteTrack = (trackId: number, deleteFile: boolean) =>
  invoke<void>("delete_track", { trackId, deleteFile });

/**
 * Opens the native image picker (in Rust) and stages the image: the track keeps its
 * cover until commitCover. Resolves with the staged file path, or null if cancelled.
 */
export const pickCover = (trackId: number) => invoke<string | null>("pick_cover", { trackId });

/** Applies the staged cover as the track's real cover. */
export const commitCover = (trackId: number) => invoke<Track>("commit_cover", { trackId });

/** Drops the staged cover. */
export const discardCover = (trackId: number) => invoke<void>("discard_cover", { trackId });

/** Shows the track's file in the file manager. */
export const revealTrack = (trackId: number) => invoke<void>("reveal_track", { trackId });

export const listPlaylistMembers = () => invoke<PlaylistMember[]>("list_playlist_members");

/** A playlist of the user's own. Rejects with "playlist.*" codes (e.g. "playlist.name_taken"). */
export const createPlaylist = (name: string) => invoke<Playlist>("create_playlist", { name });

export const renamePlaylist = (playlistId: number, name: string) =>
  invoke<Playlist>("rename_playlist", { playlistId, name });

/**
 * Deletes the playlist and tidies its folder (imported playlists). With deleteFiles it also
 * deletes the songs imported with it and their files; otherwise every song stays.
 */
export const deletePlaylist = (playlistId: number, deleteFiles: boolean) =>
  invoke<void>("delete_playlist", { playlistId, deleteFiles });

/** Resolves with how many tracks were added (duplicates are skipped). */
export const addToPlaylist = (playlistId: number, trackIds: number[]) =>
  invoke<number>("add_to_playlist", { playlistId, trackIds });

/** Removes the track from this playlist only; it stays in the library. */
export const removeFromPlaylist = (playlistId: number, trackId: number) =>
  invoke<boolean>("remove_from_playlist", { playlistId, trackId });

/** Opens the folder of an imported playlist. */
export const revealPlaylist = (playlistId: number) =>
  invoke<void>("reveal_playlist", { playlistId });

/** Opens the native folder picker (in Rust) and imports its audio files. Resolves with null if cancelled. */
export const scanFolder = () => invoke<ScanReport | null>("scan_folder");

export const getCacheInfo = () => invoke<CacheInfo>("get_cache_info");

/** Deletes unused covers and stale partial files. Never touches music. */
export const clearCache = () => invoke<CacheCleared>("clear_cache");

export const openMusicFolder = () => invoke<void>("open_music_folder");

/**
 * Opens a listening session for a track (call it once the track has been heard for a few
 * seconds). Resolves with the session id. Rejects with a "stats.*" code.
 */
export const startPlay = (trackId: number) => invoke<number>("start_play", { trackId });

/**
 * Raises the listened seconds of a session; Rust never lowers them. `seconds` must be an
 * integer (use Math.floor). Resolves with false if the session no longer exists.
 */
export const updatePlay = (playId: number, seconds: number) =>
  invoke<boolean>("update_play", { playId, seconds });

/** Stats of a month ("YYYY-MM", local time); the current month if omitted. */
export const getStats = (monthKey?: string) => invoke<MonthStats>("get_stats", { monthKey });

/** Months with listening time, newest first ("YYYY-MM"). The current month may be missing. */
export const listStatMonths = () => invoke<string[]>("list_stat_months");

/**
 * Wrapped of a year (local time): monthly summaries added up plus the open month.
 * `months` is empty if nothing was heard that year. Rejects with "stats.*" codes.
 */
export const getWrapped = (year: number) => invoke<Wrapped>("get_wrapped", { year });

/**
 * Lyrics of a track: from the local cache, or from LRCLIB the first time (then cached).
 * Rejects with "lyrics.*" codes ("lyrics.unavailable" = service down, try again later).
 */
export const getLyrics = (trackId: number, refresh = false) =>
  invoke<Lyrics>("get_lyrics", { trackId, refresh });

/** Saved lyrics shift in ms (> 0 shows the lyrics later); 0 if none. */
export const getLyricsOffset = (trackId: number) =>
  invoke<number>("get_lyrics_offset", { trackId });

/** Saves the shift (Rust clamps it to ±10 s). Resolves with the value stored. */
export const setLyricsOffset = (trackId: number, offsetMs: number) =>
  invoke<number>("set_lyrics_offset", { trackId, offsetMs });

/** Mirrors the "close to tray" setting for Rust (it decides on CloseRequested). */
export const setCloseToTray = (value: boolean) => invoke<void>("set_close_to_tray", { value });

export interface TrayLabels {
  show: string;
  playPause: string;
  next: string;
  quit: string;
}

/** Translates the native tray menu. */
export const setTrayLabels = (labels: TrayLabels) => invoke<void>("set_tray_labels", { labels });

/** Resizes the window to the mini player (on) or restores the normal size (off). */
export const setMiniMode = (on: boolean) => invoke<void>("set_mini_mode", { on });

export const minimizeWindow = (): Promise<void> =>
  getCurrentWindow().minimize();
export const toggleMaximizeWindow = (): Promise<void> =>
  getCurrentWindow().toggleMaximize();
export const closeWindow = (): Promise<void> => getCurrentWindow().close();
export const isWindowMaximized = (): Promise<boolean> =>
  getCurrentWindow().isMaximized();
export const setAlwaysOnTop = (value: boolean): Promise<void> =>
  getCurrentWindow().setAlwaysOnTop(value);
/** Paints the native window/webview background (what shows while the webview repaints on resize). */
export const setWindowBackground = (rgb: [number, number, number]): Promise<void> =>
  getCurrentWindow().setBackgroundColor(rgb);
/** Opens the folder with the app's log files. */
export const openLogsFolder = () => invoke<void>("open_logs_folder");
/** Version of the installed app. */
export const getAppVersion = () => invoke<string>("get_app_version");

/** Looks for a newer version on GitHub. Resolves with null if up to date. Rejects with "updater.*" codes. */
export const checkUpdate = () => invoke<UpdateInfo | null>("check_update");

/** Downloads and installs the version found by checkUpdate (the app restarts). */
export const installUpdate = () => invoke<void>("install_update");

/** Opens the Ko-fi page in the system browser. */
export const openDonatePage = () => invoke<void>("open_donate_page");