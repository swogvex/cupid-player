export type TrackStatus = "done" | "queued" | "needs_review";

export interface MockTrack {
  id: number;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  playlistId: number | null;
  status: TrackStatus;
}

export interface MockPlaylist {
  id: number;
  name: string;
  trackCount: number;
}

export const mockTracks: MockTrack[] = [
  { id: 1, title: "Corazón de neón", artist: "Luna Pixel", album: "Y2K Dreams", durationMs: 215000, playlistId: 1, status: "done" },
  { id: 2, title: "Lazo rosa", artist: "Luna Pixel", album: "Y2K Dreams", durationMs: 187000, playlistId: 1, status: "done" },
  { id: 3, title: "Estrella fugaz", artist: "Mochi Club", album: "Dulce", durationMs: 203000, playlistId: 1, status: "needs_review" },
  { id: 4, title: "Petals", artist: "Soft Arcade", album: "Overworld", durationMs: 242000, playlistId: 2, status: "done" },
  { id: 5, title: "Late Bus Home", artist: "Soft Arcade", album: "Overworld", durationMs: 198000, playlistId: 2, status: "done" },
  { id: 6, title: "Cherry Static", artist: "Mochi Club", album: "Dulce", durationMs: 176000, playlistId: 2, status: "queued" },
  { id: 7, title: "Pastel", artist: "Kiri", album: "Singles", durationMs: 221000, playlistId: null, status: "done" },
];

export const mockPlaylists: MockPlaylist[] = [
  { id: 1, name: "Rosa", trackCount: 3 },
  { id: 2, name: "Chill", trackCount: 3 },
];

export const mockStats = {
  minutes: 742,
  topArtist: "Luna Pixel",
  topSong: "Corazón de neón",
  topSongs: [
    { title: "Corazón de neón", artist: "Luna Pixel", plays: 31 },
    { title: "Petals", artist: "Soft Arcade", plays: 24 },
    { title: "Pastel", artist: "Kiri", plays: 19 },
    { title: "Lazo rosa", artist: "Luna Pixel", plays: 15 },
    { title: "Late Bus Home", artist: "Soft Arcade", plays: 11 },
  ],
} as const;

export const mockNowPlaying = mockTracks[0];