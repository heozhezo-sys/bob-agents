import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { config, paths } from "../config.js";
import { all, audit, mutate, nowIso, one } from "../db/index.js";
import { ffmpegPath, probeMedia } from "../lib/ffmpeg.js";
import { AppError } from "../lib/errors.js";
import type { RenderJob } from "@ai-video-agent-studio/shared";

export interface RenderJobRow {
  id: string;
  project_id: string;
  status: string;
  progress: number;
  output_path: string | null;
  error: string | null;
  log: string | null;
  plan_json: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

interface RenderProjectRow {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
}

interface PlanClipRow {
  id: string;
  track_id: string;
  asset_id: string | null;
  kind: string;
  start_ms: number;
  duration_ms: number;
  in_ms: number;
  track_kind: string;
  track_position: number;
  track_muted: number;
  asset_kind: string | null;
  storage_path: string | null;
  asset_duration_ms: number | null;
  audio_codec: string | null;
}

export interface RenderPlan {
  project: RenderProjectRow;
  durationMs: number;
  clips: PlanClipRow[];
  visual: PlanClipRow[];
  audio: PlanClipRow[];
}

export function serializeRenderJob(row: RenderJobRow, projectName?: string): RenderJob {
  const hasOutput = row.status === "succeeded" && Boolean(row.output_path);
  return {
    id: row.id,
    projectId: row.project_id,
    ...(projectName ? { projectName } : {}),
    status: row.status as RenderJob["status"],
    progress: Math.round(row.progress),
    error: row.error,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    fileUrl: hasOutput ? `/api/renders/${row.id}/file` : null,
    downloadUrl: hasOutput ? `/api/renders/${row.id}/file?download=1` : null,
  };
}

export function buildRenderPlan(projectId: string): RenderPlan {
  const project = one<RenderProjectRow>(
    "SELECT id, name, width, height, fps FROM projects WHERE id = ?",
    projectId,
  );
  if (!project) throw new AppError(404, "not_found", "Project not found");

  const rows = all<PlanClipRow>(
    `SELECT c.id, c.track_id, c.asset_id, c.kind, c.start_ms, c.duration_ms, c.in_ms,
            t.kind AS track_kind, t.position AS track_position, t.muted AS track_muted,
            a.kind AS asset_kind, a.storage_path, a.duration_ms AS asset_duration_ms,
            a.audio_codec
       FROM clips c
       JOIN tracks t ON t.id = c.track_id
       LEFT JOIN media_assets a ON a.id = c.asset_id
      WHERE t.project_id = ?
      ORDER BY t.position ASC, c.start_ms ASC`,
    projectId,
  );

  const uploadRoot = `${path.resolve(paths.uploads)}${path.sep}`;
  for (const clip of rows) {
    if (!clip.storage_path) continue;
    const resolved = path.resolve(clip.storage_path);
    if (!resolved.startsWith(uploadRoot)) {
      throw new AppError(400, "invalid_media_path", "A source points outside the upload directory");
    }
  }

  const visual = rows.filter(
    (clip) =>
      clip.storage_path &&
      (clip.asset_kind === "video" || clip.asset_kind === "image") &&
      (clip.track_kind === "video" || clip.track_kind === "overlay"),
  );
  const audio = rows.filter(
    (clip) =>
      clip.storage_path &&
      clip.asset_kind === "audio" &&
      clip.track_kind === "audio" &&
      clip.track_muted === 0,
  );

  if (visual.length + audio.length === 0) {
    throw new AppError(
      400,
      "empty_timeline",
      "The timeline has no renderable clips. Upload a source and add it to the timeline.",
    );
  }
  if (rows.length > 200) {
    throw new AppError(400, "timeline_too_complex", "This timeline has more than 200 clips");
  }

  const visualTrackIds = new Set(visual.map((clip) => clip.track_id));
  if (visualTrackIds.size > 1) {
    throw new AppError(
      400,
      "multiple_video_tracks",
      "Rendering more than one visual track is not supported yet. Move all visual clips onto one track.",
    );
  }

  const durationMs = Math.max(
    ...rows.map((clip) => clip.start_ms + clip.duration_ms),
    0,
  );
  if (durationMs <= 0) {
    throw new AppError(400, "empty_timeline", "The timeline has no duration to render");
  }
  if (durationMs > config.maxRenderSeconds * 1000) {
    throw new AppError(
      400,
      "render_too_long",
      `Renders are limited to ${config.maxRenderSeconds} seconds`,
    );
  }

  return { project, durationMs, clips: rows, visual, audio };
}

interface JobUpdate {
  status?: string;
  progress?: number;
  output_path?: string | null;
  error?: string | null;
  log?: string | null;
  plan_json?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
}

function updateJob(id: string, patch: JobUpdate): void {
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return;
  const sql = `UPDATE render_jobs SET ${entries.map(([key]) => `${key} = ?`).join(", ")} WHERE id = ?`;
  mutate(sql, ...entries.map(([, value]) => value as string | number | null), id);
}

interface SpawnResult {
  code: number | null;
  stderr: string;
}

function runFfmpeg(args: string[], timeoutMs: number): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`FFmpeg exceeded ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 32_000) stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });
}

function even(value: number): number {
  return Math.max(2, value - (value % 2));
}

function seconds(ms: number): string {
  return (ms / 1000).toFixed(3);
}

const SEGMENT_ENCODING = [
  "-c:v",
  "libx264",
  "-preset",
  "veryfast",
  "-crf",
  "20",
  "-pix_fmt",
  "yuv420p",
  "-c:a",
  "aac",
  "-b:a",
  "160k",
  "-ar",
  "48000",
  "-ac",
  "2",
  "-movflags",
  "+faststart",
];

function videoFilter(width: number, height: number, fps: number): string {
  return [
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`,
    "setsar=1",
    `fps=${fps}`,
    "format=yuv420p",
  ].join(",");
}

function audioFilter(durationMs: number): string {
  return [
    "aresample=48000",
    "aformat=sample_fmts=fltp:channel_layouts=stereo",
    "apad",
    `atrim=0:${seconds(durationMs)}`,
    "asetpts=PTS-STARTPTS",
  ].join(",");
}

async function renderSegment(
  plan: RenderPlan,
  clip: PlanClipRow | null,
  durationMs: number,
  output: string,
): Promise<void> {
  const width = even(plan.project.width);
  const height = even(plan.project.height);
  const fps = plan.project.fps;
  const dur = seconds(durationMs);
  const args = ["-y", "-nostdin", "-hide_banner", "-loglevel", "warning"];

  if (!clip) {
    args.push(
      "-f",
      "lavfi",
      "-i",
      `color=c=black:s=${width}x${height}:r=${fps}:d=${dur}`,
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=48000:cl=stereo",
      "-t",
      dur,
      "-vf",
      `fps=${fps},format=yuv420p`,
      "-af",
      `atrim=0:${dur},asetpts=PTS-STARTPTS`,
      ...SEGMENT_ENCODING,
      output,
    );
  } else {
    const source = clip.storage_path as string;
    const isImage = clip.asset_kind === "image";
    const clipDuration = Math.max(
      100,
      Math.min(
        clip.duration_ms,
        clip.asset_duration_ms && !isImage
          ? Math.max(0, clip.asset_duration_ms - clip.in_ms)
          : clip.duration_ms,
      ),
    );
    const segmentDur = seconds(clipDuration);

    if (isImage) {
      args.push("-loop", "1", "-t", segmentDur, "-i", source);
    } else {
      args.push("-ss", seconds(clip.in_ms), "-t", segmentDur, "-i", source);
    }
    args.push("-f", "lavfi", "-t", segmentDur, "-i", "anullsrc=r=48000:cl=stereo");

    const hasAudio =
      clip.asset_kind === "video" &&
      Boolean(clip.audio_codec) &&
      clip.track_muted === 0;
    const audioLabel = hasAudio ? "0:a" : "1:a";
    const filter = [
      `[0:v]${videoFilter(width, height, fps)}[v]`,
      `[${audioLabel}]${audioFilter(clipDuration)}[a]`,
    ].join(";");

    args.push(
      "-filter_complex",
      filter,
      "-map",
      "[v]",
      "-map",
      "[a]",
      "-t",
      segmentDur,
      ...SEGMENT_ENCODING,
      output,
    );
  }

  const result = await runFfmpeg(args, Math.max(120_000, durationMs * 20));
  if (result.code !== 0) {
    throw new Error(`FFmpeg segment failed: ${result.stderr.trim().slice(-1800)}`);
  }
}

function concatEntry(file: string): string {
  return `file '${file.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`;
}

async function mixAudio(
  plan: RenderPlan,
  baseVideo: string,
  output: string,
): Promise<void> {
  const duration = seconds(plan.durationMs);
  const args = ["-y", "-nostdin", "-hide_banner", "-loglevel", "warning", "-i", baseVideo];

  const filters = [
    `[0:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=0:${duration},asetpts=PTS-STARTPTS[base]`,
  ];
  const mixLabels = ["[base]"];
  plan.audio.forEach((clip, index) => {
    const inputIndex = index + 1;
    args.push("-ss", seconds(clip.in_ms), "-t", seconds(clip.duration_ms), "-i", clip.storage_path as string);
    filters.push(
      `[${inputIndex}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,` +
        `atrim=0:${seconds(clip.duration_ms)},asetpts=PTS-STARTPTS,` +
        `adelay=${clip.start_ms}|${clip.start_ms}[a${index}]`,
    );
    mixLabels.push(`[a${index}]`);
  });

  filters.push(
    `${mixLabels.join("")}amix=inputs=${mixLabels.length}:normalize=0:dropout_transition=0,` +
      `alimiter=limit=0.95,atrim=0:${duration},asetpts=PTS-STARTPTS[aout]`,
  );

  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    "0:v",
    "-map",
    "[aout]",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-t",
    duration,
    "-movflags",
    "+faststart",
    output,
  );

  const result = await runFfmpeg(args, Math.max(120_000, plan.durationMs * 10));
  if (result.code !== 0) {
    throw new Error(`FFmpeg audio mix failed: ${result.stderr.trim().slice(-1800)}`);
  }
}

async function runRenderJob(jobId: string, userId: string): Promise<void> {
  const job = one<RenderJobRow>("SELECT * FROM render_jobs WHERE id = ?", jobId);
  if (!job) return;

  const tempDir = path.join(paths.renders, job.project_id, job.id);
  const finalPath = path.join(paths.renders, job.project_id, `${job.id}.mp4`);
  await fs.mkdir(tempDir, { recursive: true });
  await fs.mkdir(path.dirname(finalPath), { recursive: true });

  updateJob(jobId, {
    status: "running",
    progress: 2,
    started_at: nowIso(),
    error: null,
  });

  try {
    const plan = buildRenderPlan(job.project_id);
    updateJob(jobId, {
      plan_json: JSON.stringify({
        durationMs: plan.durationMs,
        width: plan.project.width,
        height: plan.project.height,
        fps: plan.project.fps,
        clips: plan.clips.map((clip) => ({
          id: clip.id,
          assetId: clip.asset_id,
          kind: clip.asset_kind,
          startMs: clip.start_ms,
          durationMs: clip.duration_ms,
          inMs: clip.in_ms,
          trackId: clip.track_id,
          trackKind: clip.track_kind,
        })),
      }),
    });

    const visual = [...plan.visual].sort((a, b) => a.start_ms - b.start_ms);
    const jobs: Array<{ kind: "clip"; clip: PlanClipRow } | { kind: "gap"; durationMs: number }> = [];
    let cursor = 0;
    for (const clip of visual) {
      if (clip.start_ms > cursor) {
        jobs.push({ kind: "gap", durationMs: clip.start_ms - cursor });
      }
      jobs.push({ kind: "clip", clip });
      cursor = Math.max(cursor, clip.start_ms + clip.duration_ms);
    }
    if (cursor < plan.durationMs) {
      jobs.push({ kind: "gap", durationMs: plan.durationMs - cursor });
    }

    const listLines: string[] = [];
    let lastPercent = 2;
    const report = (percent: number) => {
      const rounded = Math.max(2, Math.min(96, Math.round(percent)));
      if (rounded > lastPercent) {
        lastPercent = rounded;
        updateJob(jobId, { progress: rounded });
      }
    };

    for (let index = 0; index < jobs.length; index += 1) {
      const jobItem = jobs[index];
      const segmentPath = path.join(tempDir, `seg-${String(index).padStart(3, "0")}.mp4`);
      if (jobItem.kind === "gap") {
        await renderSegment(plan, null, jobItem.durationMs, segmentPath);
      } else {
        await renderSegment(plan, jobItem.clip, jobItem.clip.duration_ms, segmentPath);
      }
      listLines.push(concatEntry(segmentPath));
      report(4 + ((index + 1) / Math.max(1, jobs.length)) * 72);
    }

    const listPath = path.join(tempDir, "concat.txt");
    await fs.writeFile(listPath, `${listLines.join("\n")}\n`, "utf8");
    const basePath = path.join(tempDir, "base.mp4");
    const concatResult = await runFfmpeg(
      [
        "-y",
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listPath,
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        basePath,
      ],
      Math.max(120_000, plan.durationMs * 10),
    );
    if (concatResult.code !== 0) {
      throw new Error(`FFmpeg concat failed: ${concatResult.stderr.trim().slice(-1800)}`);
    }
    report(82);

    if (plan.audio.length > 0) {
      await mixAudio(plan, basePath, finalPath);
    } else {
      await fs.copyFile(basePath, finalPath);
    }
    report(96);

    const probe = await probeMedia(finalPath);
    if (!probe.durationMs || probe.durationMs < 100) {
      throw new Error("The rendered file has no usable duration");
    }

    updateJob(jobId, {
      status: "succeeded",
      progress: 100,
      output_path: finalPath,
      log: `Rendered ${seconds(plan.durationMs)}s at ${plan.project.width}x${plan.project.height} ${plan.project.fps}fps`,
      finished_at: nowIso(),
    });
    audit(userId, "render.complete", "render_job", jobId, {
      durationMs: plan.durationMs,
      output: path.basename(finalPath),
      clips: jobs.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Render failed";
    updateJob(jobId, {
      status: "failed",
      error: message.slice(0, 2000),
      log: message.slice(0, 20_000),
      finished_at: nowIso(),
    });
    audit(userId, "render.fail", "render_job", jobId, {
      error: message.slice(0, 500),
    });
    await fs.rm(finalPath, { force: true }).catch(() => undefined);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

let activeJobId: string | null = null;
const queue: string[] = [];

function pump(): void {
  if (activeJobId) return;
  const next = queue.shift();
  if (!next) return;
  activeJobId = next;
  const row = one<{ owner_id: string; status: string }>(
    `SELECT p.owner_id, r.status FROM render_jobs r
       JOIN projects p ON p.id = r.project_id
      WHERE r.id = ?`,
    next,
  );
  if (!row || row.status !== "queued") {
    activeJobId = null;
    pump();
    return;
  }
  void runRenderJob(next, row.owner_id)
    .catch(() => undefined)
    .finally(() => {
      activeJobId = null;
      pump();
    });
}

export function enqueueRender(jobId: string): void {
  queue.push(jobId);
  pump();
}

export function createRenderJob(
  projectId: string,
  userId: string,
): { job: RenderJobRow; plan: RenderPlan } {
  const plan = buildRenderPlan(projectId);
  const queueDepth = one<{ count: number }>(
    "SELECT COUNT(*) AS count FROM render_jobs WHERE status IN ('queued', 'running')",
  );
  if ((queueDepth?.count ?? 0) >= 20) {
    throw new AppError(429, "render_queue_full", "The render queue is full. Try again shortly.");
  }

  const jobId = crypto.randomUUID();
  const planJson = JSON.stringify({
    durationMs: plan.durationMs,
    width: plan.project.width,
    height: plan.project.height,
    fps: plan.project.fps,
    clips: plan.clips.map((clip) => ({
      id: clip.id,
      assetId: clip.asset_id,
      kind: clip.asset_kind,
      startMs: clip.start_ms,
      durationMs: clip.duration_ms,
      inMs: clip.in_ms,
      trackId: clip.track_id,
      trackKind: clip.track_kind,
    })),
  });

  mutate(
    `INSERT INTO render_jobs (id, project_id, status, progress, plan_json, created_at)
     VALUES (?, ?, 'queued', 0, ?, ?)`,
    jobId,
    projectId,
    planJson,
    nowIso(),
  );
  audit(userId, "render.start", "render_job", jobId, {
    projectId,
    durationMs: plan.durationMs,
    clips: plan.clips.length,
  });

  const row = one<RenderJobRow>("SELECT * FROM render_jobs WHERE id = ?", jobId);
  if (!row) throw new AppError(500, "internal_error", "Could not create the render job");
  enqueueRender(jobId);
  return { job: row, plan };
}

export function recoverRenderJobs(): void {
  mutate(
    `UPDATE render_jobs
        SET status = 'failed',
            error = 'The server restarted before this render finished',
            finished_at = ?
      WHERE status IN ('queued', 'running')`,
    nowIso(),
  );
}
