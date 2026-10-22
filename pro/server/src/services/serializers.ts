import type {
  Clip,
  MediaAsset,
  MediaKind,
  Project,
  ProjectDetail,
  Track,
  TrackKind,
} from "@ai-video-agent-studio/shared";
import type { MediaRow } from "./mediaService.js";
import { all } from "../db/index.js";

export interface ProjectRow {
  id: string;
  owner_id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  created_at: string;
  updated_at: string;
}

export interface ClipRow {
  id: string;
  track_id: string;
  asset_id: string | null;
  kind: string;
  start_ms: number;
  duration_ms: number;
  in_ms: number;
  out_ms: number | null;
  x: number | null;
  y: number | null;
  scale: number | null;
  rotation: number | null;
  opacity: number | null;
  text: string | null;
  style_json: string | null;
  created_at: string;
}

export interface TrackRow {
  id: string;
  project_id: string;
  kind: string;
  name: string;
  position: number;
  locked: number;
  hidden: number;
  muted: number;
  created_at: string;
}

export function serializeAsset(row: MediaRow): MediaAsset {
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind as MediaKind,
    originalName: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    durationMs: row.duration_ms,
    width: row.width,
    height: row.height,
    fps: row.fps,
    videoCodec: row.video_codec,
    audioCodec: row.audio_codec,
    sampleRate: row.sample_rate,
    channels: row.channels,
    bitrate: row.bitrate,
    thumbnailUrl: row.thumbnail_path ? `/api/assets/${row.id}/thumbnail` : null,
    streamUrl: `/api/assets/${row.id}/stream`,
    createdAt: row.created_at,
  };
}

export function serializeClip(row: ClipRow): Clip {
  return {
    id: row.id,
    trackId: row.track_id,
    assetId: row.asset_id,
    kind: row.kind as TrackKind,
    startMs: row.start_ms,
    durationMs: row.duration_ms,
    inMs: row.in_ms,
    outMs: row.out_ms,
    x: row.x,
    y: row.y,
    scale: row.scale,
    rotation: row.rotation,
    opacity: row.opacity,
    text: row.text,
    createdAt: row.created_at,
  };
}

export function trackRowsForProject(projectId: string): TrackRow[] {
  return all<TrackRow>(
    "SELECT * FROM tracks WHERE project_id = ? ORDER BY position ASC, created_at ASC",
    projectId,
  );
}

export function clipRowsForProject(projectId: string): ClipRow[] {
  return all<ClipRow>(
    `SELECT c.* FROM clips c
     JOIN tracks t ON t.id = c.track_id
     WHERE t.project_id = ?
     ORDER BY c.start_ms ASC, c.created_at ASC`,
    projectId,
  );
}

export function serializeTracks(projectId: string): Track[] {
  const tracks = trackRowsForProject(projectId);
  const clips = clipRowsForProject(projectId);
  const byTrack = new Map<string, Clip[]>();
  for (const clip of clips) {
    const list = byTrack.get(clip.track_id) ?? [];
    list.push(serializeClip(clip));
    byTrack.set(clip.track_id, list);
  }
  return tracks.map((track) => ({
    id: track.id,
    projectId: track.project_id,
    kind: track.kind as TrackKind,
    name: track.name,
    position: track.position,
    locked: track.locked === 1,
    hidden: track.hidden === 1,
    muted: track.muted === 1,
    clips: byTrack.get(track.id) ?? [],
  }));
}

export function projectDurationMs(projectId: string): number {
  const rows = clipRowsForProject(projectId);
  let max = 0;
  for (const row of rows) {
    const end = row.start_ms + row.duration_ms;
    if (end > max) max = end;
  }
  return max;
}

export function serializeProject(row: ProjectRow): Project {
  const assets = all<MediaRow>(
    "SELECT * FROM media_assets WHERE project_id = ? ORDER BY created_at ASC",
    row.id,
  );
  const cover = assets.find((asset) => asset.thumbnail_path);
  return {
    id: row.id,
    name: row.name,
    width: row.width,
    height: row.height,
    fps: row.fps,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    assetCount: assets.length,
    coverUrl: cover ? `/api/assets/${cover.id}/thumbnail` : null,
  };
}

export function serializeProjectDetail(row: ProjectRow): ProjectDetail {
  const assets = all<MediaRow>(
    "SELECT * FROM media_assets WHERE project_id = ? ORDER BY created_at ASC",
    row.id,
  );
  const cover = assets.find((asset) => asset.thumbnail_path);
  const tracks = serializeTracks(row.id);
  return {
    ...serializeProject(row),
    assetCount: assets.length,
    coverUrl: cover ? `/api/assets/${cover.id}/thumbnail` : null,
    assets: assets.map(serializeAsset),
    tracks,
    durationMs: projectDurationMs(row.id),
  };
}
