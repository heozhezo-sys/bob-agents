import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { paths } from "../config.js";
import { mutate, nowIso } from "../db/index.js";
import { AppError } from "../lib/errors.js";
import { probeMedia, generateThumbnail, extractWaveform } from "../lib/ffmpeg.js";
import {
  extensionFor,
  moveIntoPlace,
  projectUploadDir,
  readHead,
  removeIfExists,
  safeOriginalName,
  sniffMedia,
} from "../lib/media.js";

export interface MediaRow {
  id: string;
  project_id: string;
  kind: string;
  original_name: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  video_codec: string | null;
  audio_codec: string | null;
  sample_rate: number | null;
  channels: number | null;
  bitrate: number | null;
  thumbnail_path: string | null;
  waveform_path: string | null;
  created_at: string;
}

interface IngestOptions {
  tempPath: string;
  originalName: string;
  projectId: string;
  assetId?: string;
  declaredMime?: string;
}

export async function ingestUpload(options: IngestOptions): Promise<MediaRow> {
  const assetId = options.assetId ?? crypto.randomUUID();
  const originalName = safeOriginalName(options.originalName);
  const thumbPath = path.join(paths.thumbnails, `${assetId}.jpg`);
  const waveformPath = path.join(paths.waveforms, `${assetId}.json`);
  let finalPath: string | null = null;

  try {
    const head = await readHead(options.tempPath, 64);
    const sniff = sniffMedia(head);
    if (sniff.kind === "unknown") {
      throw new AppError(
        415,
        "unsupported_media",
        "Unsupported file type. Upload MP4, MOV, WebM, MP3, WAV, M4A, JPG, PNG, SRT or VTT.",
      );
    }

    let probe = null;
    if (sniff.kind !== "subtitle") {
      try {
        probe = await probeMedia(options.tempPath);
      } catch {
        throw new AppError(
          422,
          "unreadable_media",
          "The file looks like media but could not be read. It may be corrupted.",
        );
      }
    }

    let kind: "video" | "audio" | "image" | "subtitle";
    if (sniff.kind === "subtitle") {
      kind = "subtitle";
    } else if (sniff.kind === "image") {
      // ffprobe exposes a still image as a single-frame video stream, so the
      // sniffed container type wins here. Otherwise PNG/JPG become 0ms videos.
      kind = "image";
    } else if (probe?.hasVideo) {
      kind = "video";
    } else if (probe?.hasAudio) {
      kind = "audio";
    } else {
      throw new AppError(415, "unsupported_media", "No usable video or audio stream found.");
    }

    let extension = extensionFor(originalName, sniff);
    const originalExt = path.extname(originalName).toLowerCase();
    if (kind === "audio" && originalExt === ".m4a") extension = ".m4a";

    const dir = projectUploadDir(options.projectId);
    await fs.mkdir(dir, { recursive: true });
    finalPath = path.join(dir, `${assetId}${extension}`);
    await moveIntoPlace(options.tempPath, finalPath);
    const stat = await fs.stat(finalPath);

    let thumbnailPath: string | null = null;
    if (kind === "video" || kind === "image") {
      const ok = await generateThumbnail(finalPath, thumbPath, {
        durationMs: probe?.durationMs ?? null,
        isVideo: kind === "video",
      }).catch(() => false);
      if (ok) thumbnailPath = thumbPath;
    }

    let waveformStored: string | null = null;
    if (probe?.hasAudio) {
      const waveform = await extractWaveform(
        finalPath,
        waveformPath,
        probe.durationMs,
      ).catch(() => null);
      if (waveform) waveformStored = waveformPath;
    }

    const now = nowIso();
    mutate(
      `INSERT INTO media_assets (
        id, project_id, kind, original_name, storage_path, mime_type, size_bytes,
        duration_ms, width, height, fps, video_codec, audio_codec, sample_rate,
        channels, bitrate, thumbnail_path, waveform_path, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      assetId,
      options.projectId,
      kind,
      originalName,
      finalPath,
      probe ? (kind === "audio" ? "audio/mpeg" : "video/mp4") : "application/x-subrip",
      stat.size,
      probe?.durationMs ?? null,
      probe?.width ?? null,
      probe?.height ?? null,
      probe?.fps ?? null,
      probe?.videoCodec ?? null,
      probe?.audioCodec ?? null,
      probe?.sampleRate ?? null,
      probe?.channels ?? null,
      probe?.bitrate ?? null,
      thumbnailPath,
      waveformStored,
      now,
    );

    const row: MediaRow = {
      id: assetId,
      project_id: options.projectId,
      kind,
      original_name: originalName,
      storage_path: finalPath,
      mime_type: probe ? (kind === "audio" ? "audio/mpeg" : "video/mp4") : "application/x-subrip",
      size_bytes: stat.size,
      duration_ms: probe?.durationMs ?? null,
      width: probe?.width ?? null,
      height: probe?.height ?? null,
      fps: probe?.fps ?? null,
      video_codec: probe?.videoCodec ?? null,
      audio_codec: probe?.audioCodec ?? null,
      sample_rate: probe?.sampleRate ?? null,
      channels: probe?.channels ?? null,
      bitrate: probe?.bitrate ?? null,
      thumbnail_path: thumbnailPath,
      waveform_path: waveformStored,
      created_at: now,
    };
    return row;
  } catch (error) {
    await removeIfExists(options.tempPath);
    await removeIfExists(finalPath);
    await removeIfExists(thumbPath);
    await removeIfExists(waveformPath);
    throw error;
  }
}

export async function deleteAssetFiles(row: MediaRow): Promise<void> {
  await removeIfExists(row.storage_path);
  await removeIfExists(row.thumbnail_path);
  await removeIfExists(row.waveform_path);
}
