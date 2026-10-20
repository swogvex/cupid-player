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