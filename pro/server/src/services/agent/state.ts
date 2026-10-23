import { all, one } from "../../db/index.js";
import { notFound } from "../../lib/errors.js";
import type { ProjectRow, TrackRow } from "../serializers.js";

export interface AgentProjectState {
  project: {
    id: string;
    name: string;
    width: number;
    height: number;
    fps: number;
    durationMs: number;
  };
  tracks: { id: string; kind: string; name: string; locked: boolean }[];
  clips: {
    id: string;
    trackId: string;
    kind: string;
    assetId: string | null;
    assetName: string | null;
    startMs: number;
    durationMs: number;
    inMs: number;
  }[];
  assets: {
    id: string;
    name: string;
    kind: string;
    durationMs: number | null;
  }[];
}

export function buildAgentState(projectId: string): AgentProjectState {
  const project = one<ProjectRow>("SELECT * FROM projects WHERE id = ?", projectId);
  if (!project) throw notFound("Project not found");

  const tracks = all<TrackRow>(
    "SELECT * FROM tracks WHERE project_id = ? ORDER BY position ASC",
    projectId,
  );
  const clips = all<{
    id: string;
    track_id: string;
    kind: string;
    asset_id: string | null;
    start_ms: number;
    duration_ms: number;
    in_ms: number;
    asset_name: string | null;
  }>(
    `SELECT c.id, c.track_id, c.kind, c.asset_id, c.start_ms, c.duration_ms, c.in_ms,
            a.original_name AS asset_name
       FROM clips c
       JOIN tracks t ON t.id = c.track_id
       LEFT JOIN media_assets a ON a.id = c.asset_id
      WHERE t.project_id = ?
      ORDER BY t.position ASC, c.start_ms ASC`,
    projectId,
  );
  const assets = all<{
    id: string;
    original_name: string;
    kind: string;
    duration_ms: number | null;
  }>(
    "SELECT id, original_name, kind, duration_ms FROM media_assets WHERE project_id = ? ORDER BY created_at ASC",
    projectId,
  );

  return {
    project: {
      id: project.id,
      name: project.name,
      width: project.width,
      height: project.height,
      fps: project.fps,
      durationMs: clips.reduce(
        (max, clip) => Math.max(max, clip.start_ms + clip.duration_ms),
        0,
      ),
    },
    tracks: tracks.map((track) => ({
      id: track.id,
      kind: track.kind,
      name: track.name,
      locked: track.locked === 1,
    })),
    clips: clips.map((clip) => ({
      id: clip.id,
      trackId: clip.track_id,
      kind: clip.kind,
      assetId: clip.asset_id,
      assetName: clip.asset_name,
      startMs: clip.start_ms,
      durationMs: clip.duration_ms,
      inMs: clip.in_ms,
    })),
    assets: assets.map((asset) => ({
      id: asset.id,
      name: asset.original_name,
      kind: asset.kind,
      durationMs: asset.duration_ms,
    })),
  };
}
