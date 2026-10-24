import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type {
  CacheCleared,
  CacheInfo,
  ImportStarted,
  ParsedLink,
  Playlist,
  PlaylistMember,
  ScanReport,
  Track,
  TrackFilter,
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

/** Resizes the window to 352*n x 208*n. Resolves with the scale actually applied. */
export function setWindowScale(n: number): Promise<number> {
  return invoke<number>("set_window_scale", { n });
}

export const minimizeWindow = (): Promise<void> =>
  getCurrentWindow().minimize();
export const toggleMaximizeWindow = (): Promise<void> =>
  getCurrentWindow().toggleMaximize();
export const closeWindow = (): Promise<void> => getCurrentWindow().close();
export const isWindowMaximized = (): Promise<boolean> =>
  getCurrentWindow().isMaximized();
export const setAlwaysOnTop = (value: boolean): Promise<void> =>
  getCurrentWindow().setAlwaysOnTop(value);