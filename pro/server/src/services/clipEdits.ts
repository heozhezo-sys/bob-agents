import crypto from "node:crypto";
import {
  CLIP_MIN_DURATION_MS,
  createClipSchema,
  splitClipSchema,
  updateClipSchema,
  type ProjectDetail,
} from "@ai-video-agent-studio/shared";
import { audit, all, getDb, mutate, nowIso, one } from "../db/index.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { parse } from "../lib/validate.js";
import type { MediaRow } from "./mediaService.js";
import {
  serializeProjectDetail,
  type ClipRow,
  type ProjectRow,
} from "./serializers.js";

export interface JoinedClipRow extends ClipRow {
  project_id: string;
  track_kind: string;
  track_locked: number;
  asset_kind: string | null;
  asset_duration_ms: number | null;
}

export interface ProjectSnapshot {
  name: string;
  clips: ClipRow[];
}

const TRACK_ACCEPTS: Record<string, string[]> = {
  video: ["video", "overlay"],
  image: ["video", "overlay"],
  audio: ["audio"],
  text: ["text"],
  subtitle: ["subtitle"],
};

export function ownedProject(userId: string, projectId: string): ProjectRow {
  const row = one<ProjectRow>(
    "SELECT * FROM projects WHERE id = ? AND owner_id = ?",
    projectId,
    userId,
  );
  if (!row) throw notFound("Project not found");
  return row;
}

export function projectDetail(userId: string, projectId: string): ProjectDetail {
  return serializeProjectDetail(ownedProject(userId, projectId));
}

function loadClip(projectId: string, clipId: string): JoinedClipRow {
  const row = one<JoinedClipRow>(
    `SELECT c.*, t.project_id AS project_id, t.kind AS track_kind, t.locked AS track_locked,
            a.kind AS asset_kind, a.duration_ms AS asset_duration_ms
       FROM clips c
       JOIN tracks t ON t.id = c.track_id
       LEFT JOIN media_assets a ON a.id = c.asset_id
      WHERE c.id = ? AND t.project_id = ?`,
    clipId,
    projectId,
  );
  if (!row) throw notFound("Clip not found");
  return row;
}

function assertEditable(clip: JoinedClipRow): void {
  if (clip.track_locked === 1) {
    throw conflict("This track is locked. Unlock it before editing.");
  }
}

function assertCompatible(kind: string, trackKind: string): void {
  const accepted = TRACK_ACCEPTS[kind] ?? [];
  if (!accepted.includes(trackKind)) {
    throw badRequest(`A ${kind} clip cannot live on a ${trackKind} track`);
  }
}

function mediaDurationLimit(clip: JoinedClipRow): number | null {
  if (!clip.asset_id || clip.asset_kind === "image") return null;
  return clip.asset_duration_ms;
}

function assertSourceBounds(
  clip: JoinedClipRow,
  inMs: number,
  durationMs: number,
): void {
  if (durationMs < CLIP_MIN_DURATION_MS) {
    throw badRequest(`A clip must be at least ${CLIP_MIN_DURATION_MS} ms long`);
  }
  const limit = mediaDurationLimit(clip);
  if (limit === null) return;
  if (inMs < 0) throw badRequest("The source in point cannot be negative");
  if (inMs >= limit && limit > 0) {
    throw badRequest("The source in point is past the end of the file");
  }
  if (inMs + durationMs > limit + 2) {
    throw badRequest("The clip extends past the end of the source", {
      maxDurationMs: Math.max(0, limit - inMs),
      assetDurationMs: limit,
    });
  }
}

function assertNoOverlap(
  trackId: string,
  clipId: string | null,
  startMs: number,
  durationMs: number,
): void {
  const endMs = startMs + durationMs;
  const row = one<{ id: string }>(
    `SELECT id FROM clips
      WHERE track_id = ? AND id <> ? AND start_ms < ? AND start_ms + duration_ms > ?
      LIMIT 1`,
    trackId,
    clipId ?? "",
    endMs,
    startMs,
  );
  if (row) {
    throw conflict("That range overlaps another clip on this track");
  }
}

function targetTrack(
  projectId: string,
  trackId: string,
): { id: string; kind: string; locked: number } {
  const row = one<{ id: string; kind: string; locked: number }>(
    "SELECT id, kind, locked FROM tracks WHERE id = ? AND project_id = ?",
    trackId,
    projectId,
  );
  if (!row) throw notFound("Track not found");
  return row;
}

export function updateClip(
  userId: string,
  projectId: string,
  clipId: string,
  rawInput: unknown,
): ProjectDetail {
  const project = ownedProject(userId, projectId);
  const clip = loadClip(project.id, clipId);
  assertEditable(clip);
  const input = parse(updateClipSchema, rawInput);

  const trackId = input.trackId ?? clip.track_id;
  const track = targetTrack(project.id, trackId);
  if (track.locked === 1) throw conflict("This track is locked. Unlock it before editing.");
  assertCompatible(clip.kind, track.kind);

  const startMs = input.startMs ?? clip.start_ms;
  const durationMs = input.durationMs ?? clip.duration_ms;
  const inMs = input.inMs ?? clip.in_ms;
  assertSourceBounds(clip, inMs, durationMs);
  assertNoOverlap(track.id, clip.id, startMs, durationMs);

  const outMs = clip.asset_id ? inMs + durationMs : null;
  mutate(
    `UPDATE clips
        SET track_id = ?, start_ms = ?, duration_ms = ?, in_ms = ?, out_ms = ?
      WHERE id = ?`,
    track.id,
    startMs,
    durationMs,
    inMs,
    outMs,
    clip.id,
  );
  mutate("UPDATE projects SET updated_at = ? WHERE id = ?", nowIso(), project.id);
  audit(userId, "clip.update", "clip", clip.id, {
    before: {
      trackId: clip.track_id,
      startMs: clip.start_ms,
      durationMs: clip.duration_ms,
      inMs: clip.in_ms,
    },
    after: { trackId: track.id, startMs, durationMs, inMs },
  });
  return projectDetail(userId, project.id);
}

export function splitClip(
  userId: string,
  projectId: string,
  clipId: string,
  rawInput: unknown,
): ProjectDetail {
  const project = ownedProject(userId, projectId);
  const clip = loadClip(project.id, clipId);
  assertEditable(clip);
  const input = parse(splitClipSchema, rawInput);

  const offset = input.atMs - clip.start_ms;
  if (offset < CLIP_MIN_DURATION_MS || clip.duration_ms - offset < CLIP_MIN_DURATION_MS) {
    throw badRequest(
      `The playhead must be at least ${CLIP_MIN_DURATION_MS} ms inside the clip to split it`,
    );
  }

  const leftDuration = offset;
  const rightDuration = clip.duration_ms - offset;
  const isMedia = Boolean(clip.asset_id);
  const rightIn = isMedia ? clip.in_ms + offset : 0;
  const leftOut = isMedia ? clip.in_ms + leftDuration : null;
  const newClipId = crypto.randomUUID();

  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    mutate(
      "UPDATE clips SET duration_ms = ?, out_ms = ? WHERE id = ?",
      leftDuration,
      leftOut,
      clip.id,
    );
    mutate(
      `INSERT INTO clips
        (id, track_id, asset_id, kind, start_ms, duration_ms, in_ms, out_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      newClipId,
      clip.track_id,
      clip.asset_id,
      clip.kind,
      input.atMs,
      rightDuration,
      rightIn,
      nowIso(),
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  mutate("UPDATE projects SET updated_at = ? WHERE id = ?", nowIso(), project.id);
  audit(userId, "clip.split", "clip", clip.id, {
    atMs: input.atMs,
    newClipId,
  });
  return projectDetail(userId, project.id);
}

export function deleteClip(
  userId: string,
  projectId: string,
  clipId: string,
): ProjectDetail {
  const project = ownedProject(userId, projectId);
  const clip = loadClip(project.id, clipId);
  assertEditable(clip);
  mutate("DELETE FROM clips WHERE id = ?", clip.id);
  mutate("UPDATE projects SET updated_at = ? WHERE id = ?", nowIso(), project.id);
  audit(userId, "clip.delete", "clip", clip.id, {
    startMs: clip.start_ms,
    durationMs: clip.duration_ms,
    assetId: clip.asset_id,
  });
  return projectDetail(userId, project.id);
}

export function createClip(
  userId: string,
  projectId: string,
  rawInput: unknown,
): ProjectDetail {
  const project = ownedProject(userId, projectId);
  const input = parse(createClipSchema, rawInput);
  const asset = one<MediaRow>(
    "SELECT * FROM media_assets WHERE id = ? AND project_id = ?",
    input.assetId,
    project.id,
  );
  if (!asset) throw notFound("Source not found");
  if (asset.kind === "subtitle") {
    throw badRequest("Subtitle files are imported as a transcript, not a timeline clip");
  }

  const desiredTrackKind = asset.kind === "audio" ? "audio" : "video";
  const track = input.trackId
    ? targetTrack(project.id, input.trackId)
    : one<{ id: string; kind: string; locked: number }>(
        "SELECT id, kind, locked FROM tracks WHERE project_id = ? AND kind = ? ORDER BY position ASC LIMIT 1",
        project.id,
        desiredTrackKind,
      );
  if (!track) throw badRequest("No compatible track exists in this project");
  if (track.locked === 1) throw conflict("This track is locked. Unlock it before editing.");
  assertCompatible(asset.kind, track.kind);

  const durationMs = asset.kind === "image" ? 5000 : (asset.duration_ms ?? 0);
  if (durationMs < CLIP_MIN_DURATION_MS) {
    throw badRequest("The source has no usable duration");
  }
  const startMs =
    input.startMs ??
    (one<{ end: number }>(
      "SELECT COALESCE(MAX(start_ms + duration_ms), 0) AS end FROM clips WHERE track_id = ?",
      track.id,
    )?.end ??
      0);

  assertNoOverlap(track.id, null, startMs, durationMs);

  const clipId = crypto.randomUUID();
  mutate(
    `INSERT INTO clips
      (id, track_id, asset_id, kind, start_ms, duration_ms, in_ms, out_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?)`,
    clipId,
    track.id,
    asset.id,
    asset.kind,
    startMs,
    durationMs,
    nowIso(),
  );
  mutate("UPDATE projects SET updated_at = ? WHERE id = ?", nowIso(), project.id);
  audit(userId, "clip.create", "clip", clipId, {
    assetId: asset.id,
    trackId: track.id,
    startMs,
    durationMs,
  });
  return projectDetail(userId, project.id);
}

export function snapshotProject(projectId: string): ProjectSnapshot {
  const project = one<ProjectRow>("SELECT * FROM projects WHERE id = ?", projectId);
  if (!project) throw notFound("Project not found");
  const clips = all<ClipRow>(
    `SELECT c.* FROM clips c
       JOIN tracks t ON t.id = c.track_id
      WHERE t.project_id = ?
      ORDER BY c.created_at ASC`,
    projectId,
  );
  return { name: project.name, clips };
}
