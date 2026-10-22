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