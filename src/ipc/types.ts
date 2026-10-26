export type TrackStatus =
  | 'queued'
  | 'searching'
  | 'downloading'
  | 'tagging'
  | 'done'
  | 'needs_review'
  | 'failed';

export interface Track {
  id: number;
  spotifyId: string | null;
  title: string;
  artist: string;
  album: string | null;
  durationMs: number;
  filePath: string | null;
  coverPath: string | null;
  playlistId: number | null;
  position: number | null;
  status: TrackStatus;
  sourceUrl: string | null;
  matchScore: number | null;
  addedAt: string;
}

export interface Playlist {
  id: number;
  spotifyId: string | null;
  name: string;
  folder: string;
  coverPath: string | null;
  createdAt: string;
  trackCount: number;
}

export interface TrackFilter {
  query?: string;
  playlistId?: number;
}

export type SpotifyKind = 'track' | 'playlist';

export interface ParsedLink {
  kind: SpotifyKind;
  id: string;
}

/** Returned by start_import and retry_track. */
export interface ImportStarted {
  importId: string;
  playlistId: number | null;
  name: string;
  /** Tracks in the source list. */
  total: number;
  /** Tracks that will actually be downloaded now. */
  toDownload: number;
  alreadyDone: number;
  skipped: number;
  /** The playlist may have more tracks than Spotify's embed shows (about 100). */
  truncated: boolean;
}

/** Event import://progress */
export interface ImportProgressPayload {
  importId: string;
  fraction: number;
  finished: number;
  total: number;
}

/** Event import://track-state */
export interface TrackStatePayload {
  importId: string;
  trackId: number;
  status: TrackStatus;
}

/** Event import://done */
export interface ImportDonePayload {
  importId: string;
  total: number;
  done: number;
  needsReview: number;
  failed: number;
  cancelled: boolean;
}

/** Returned by scan_folder. */
export interface ScanReport {
  /** Audio files seen. */
  found: number;
  added: number;
  /** Already in the library or repeated inside the folder. */
  duplicates: number;
  /** Unreadable, empty, too large or impossible to copy. */
  failed: number;
  /** Only the first files were read (limit reached). */
  truncated: boolean;
}

/** Returned by get_cache_info. */
export interface CacheInfo {
  /** Everything inside the ".covers" folders. */
  coversBytes: number;
  coversCount: number;
  /** What "clear cache" would delete. */
  reclaimableBytes: number;
  reclaimableCount: number;
}

/** Returned by clear_cache. */
export interface CacheCleared {
  removed: number;
  freedBytes: number;
}

/** One (playlist, track) pair from list_playlist_members. */
export interface PlaylistMember {
  playlistId: number;
  trackId: number;
}

/** One artist in a month's ranking. */
export interface ArtistStat {
  artist: string;
  seconds: number;
}

/** One track in a month's ranking. `plays` counts listening sessions. */
export interface TrackStat {
  title: string;
  artist: string;
  seconds: number;
  plays: number;
}

/** Returned by get_stats. */
export interface MonthStats {
  /** "YYYY-MM", local time. */
  monthKey: string;
  minutes: number;
  topArtists: ArtistStat[];
  topTracks: TrackStat[];
  /** true when the numbers come from the frozen monthly summary. */
  closed: boolean;
}

/** Minutes listened in one month of a Wrapped year. */
export interface MonthTotal {
  /** "YYYY-MM", local time. */
  monthKey: string;
  minutes: number;
}

/** Returned by get_wrapped. `months` empty = nothing was heard that year. */
export interface Wrapped {
  year: number;
  /** Sum of the monthly minutes (each month is rounded, so it can be off by under 1 min per month). */
  minutes: number;
  /** Months with listening, oldest first. */
  months: MonthTotal[];
  /** Month with most minutes (the earliest on a tie). */
  topMonth: MonthTotal | null;
  /** Top 5, by seconds listened. */
  topArtists: ArtistStat[];
  topTracks: TrackStat[];
}

/** One synced lyric line. `ms` is when the line starts. `text` is empty for instrumental breaks. */
export interface LyricsLine {
  ms: number;
  text: string;
}

export type LyricsStatus = 'synced' | 'plain' | 'instrumental' | 'not_found';

/** Returned by get_lyrics. `lines` is filled for "synced", `plain` for "plain". */
export interface Lyrics {
  trackId: number;
  status: LyricsStatus;
  lines: LyricsLine[];
  plain: string | null;
}

/** A newer version found on GitHub Releases. */
export interface UpdateInfo {
  version: string;
  currentVersion: string;
}