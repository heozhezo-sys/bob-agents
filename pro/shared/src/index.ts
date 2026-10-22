import { z } from "zod";

export type MediaKind = "video" | "audio" | "image" | "subtitle";

export interface User {
  id: string;
  displayName: string;
  role: "owner" | "editor" | "viewer";
}

export interface SessionInfo {
  user: User;
  csrfToken: string;
}

export interface Project {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  createdAt: string;
  updatedAt: string;
  assetCount: number;
  durationMs: number;
  coverUrl: string | null;
}

export interface MediaAsset {
  id: string;
  projectId: string;
  kind: MediaKind;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  sampleRate: number | null;
  channels: number | null;
  bitrate: number | null;
  thumbnailUrl: string | null;
  streamUrl: string;
  createdAt: string;
}

export type TrackKind = "video" | "audio" | "text" | "subtitle" | "overlay";
export type ClipKind = "video" | "audio" | "image" | "text" | "subtitle" | "overlay";

export interface Clip {
  id: string;
  trackId: string;
  assetId: string | null;
  kind: ClipKind;
  startMs: number;
  durationMs: number;
  inMs: number;
  outMs: number | null;
  x: number | null;
  y: number | null;
  scale: number | null;
  rotation: number | null;
  opacity: number | null;
  text: string | null;
  createdAt: string;
}

export interface Track {
  id: string;
  projectId: string;
  kind: TrackKind;
  name: string;
  position: number;
  locked: boolean;
  hidden: boolean;
  muted: boolean;
  clips: Clip[];
}

export interface ProjectDetail extends Project {
  assets: MediaAsset[];
  tracks: Track[];
  durationMs: number;
}

export type RenderStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface RenderJob {
  id: string;
  projectId: string;
  projectName?: string;
  status: RenderStatus;
  progress: number;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  fileUrl: string | null;
  downloadUrl: string | null;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export const createProjectSchema = z.object({
  name: z.string().trim().min(1, "Project name is required").max(120),
  width: z.number().int().min(16).max(7680).default(1920),
  height: z.number().int().min(16).max(4320).default(1080),
  fps: z.number().int().min(1).max(120).default(30),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  width: z.number().int().min(16).max(7680).optional(),
  height: z.number().int().min(16).max(4320).optional(),
  fps: z.number().int().min(1).max(120).optional(),
});

export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const updateClipSchema = z
  .object({
    startMs: z.number().int().min(0).max(6 * 60 * 60 * 1000).optional(),
    durationMs: z.number().int().min(100).max(6 * 60 * 60 * 1000).optional(),
    inMs: z.number().int().min(0).max(6 * 60 * 60 * 1000).optional(),
    trackId: z.string().uuid().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one clip field to update",
  });

export type UpdateClipInput = z.infer<typeof updateClipSchema>;

export const splitClipSchema = z.object({
  atMs: z.number().int().min(0).max(6 * 60 * 60 * 1000),
});

export type SplitClipInput = z.infer<typeof splitClipSchema>;

export const createClipSchema = z.object({
  assetId: z.string().uuid(),
  trackId: z.string().uuid().optional(),
  startMs: z.number().int().min(0).max(6 * 60 * 60 * 1000).optional(),
});

export type CreateClipInput = z.infer<typeof createClipSchema>;

export const CLIP_MIN_DURATION_MS = 100;

export const loginSchema = z.object({
  password: z.string().min(1).max(500),
});

export type LoginInput = z.infer<typeof loginSchema>;

export interface WaveformData {
  peaks: number[];
  durationMs: number;
}

export const RESOLUTION_PRESETS = [
  { label: "1080p · 16:9", width: 1920, height: 1080, fps: 30 },
  { label: "1080p · 9:16", width: 1080, height: 1920, fps: 30 },
  { label: "1080p · 1:1", width: 1080, height: 1080, fps: 30 },
  { label: "720p · 16:9", width: 1280, height: 720, fps: 30 },
  { label: "4K · 16:9", width: 3840, height: 2160, fps: 30 },
] as const;

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;

export const ACCEPTED_UPLOAD_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-matroska",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/aac",
  "audio/ogg",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain",
  "application/x-subrip",
] as const;

export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return "--:--";
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function formatTimecode(ms: number, fps: number): string {
  const safe = Math.max(0, ms);
  const totalSeconds = Math.floor(safe / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const frames = Math.floor(((safe % 1000) / 1000) * fps);
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(frames)}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}
