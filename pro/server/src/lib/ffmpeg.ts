import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { config } from "../config.js";
import { AppError } from "./errors.js";

const require = createRequire(import.meta.url);

function resolveFfmpeg(): string {
  if (config.ffmpegPath) return config.ffmpegPath;
  const bundled = require("ffmpeg-static") as string | null;
  if (!bundled) throw new Error("ffmpeg binary not found");
  return bundled;
}

function resolveFfprobe(): string {
  if (config.ffprobePath) return config.ffprobePath;
  const bundled = require("ffprobe-static") as { path: string };
  return bundled.path;
}

export const ffmpegPath = resolveFfmpeg();
export const ffprobePath = resolveFfprobe();

interface RunOptions {
  timeoutMs?: number;
  maxOutputBytes?: number;
  cwd?: string;
}

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export function runBinary(
  bin: string,
  args: string[],
  options: RunOptions = {},
): Promise<RunResult> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const maxOutput = options.maxOutputBytes ?? 8 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      windowsHide: true,
      cwd: options.cwd,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new AppError(504, "ffmpeg_timeout", "Media operation timed out"));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < maxOutput) stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < maxOutput) stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

export interface ProbeResult {
  durationMs: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  sampleRate: number | null;
  channels: number | null;
  bitrate: number | null;
  formatName: string | null;
  hasVideo: boolean;
  hasAudio: boolean;
  rotation: number | null;
}

interface RawStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  sample_rate?: string;
  channels?: number;
  bit_rate?: string;
  duration?: string;
  disposition?: { attached_pic?: number };
  side_data_list?: Array<{ rotation?: number }>;
  tags?: { rotate?: string };
}

interface RawProbe {
  streams?: RawStream[];
  format?: {
    duration?: string;
    bit_rate?: string;
    format_name?: string;
    tags?: { rotate?: string };
  };
}

function ratioToNumber(ratio: string | undefined): number | null {
  if (!ratio) return null;
  const [num, den] = ratio.split("/").map(Number);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
  return num / den;
}

export async function probeMedia(file: string): Promise<ProbeResult> {
  const result = await runBinary(
    ffprobePath,
    [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      file,
    ],
    { timeoutMs: 60_000 },
  );
  if (result.code !== 0) {
    throw new AppError(422, "unreadable_media", "The file could not be read as media");
  }
  let parsed: RawProbe;
  try {
    parsed = JSON.parse(result.stdout) as RawProbe;
  } catch {
    throw new AppError(422, "unreadable_media", "Invalid media metadata");
  }
  const streams = parsed.streams ?? [];
  const video = streams.find(
    (s) => s.codec_type === "video" && s.disposition?.attached_pic !== 1,
  );
  const audio = streams.find((s) => s.codec_type === "audio");
  const durationSeconds = Number(parsed.format?.duration ?? video?.duration ?? audio?.duration);
  const rotationRaw =
    video?.side_data_list?.find((d) => typeof d.rotation === "number")?.rotation ??
    Number(video?.tags?.rotate ?? parsed.format?.tags?.rotate ?? NaN);
  return {
    durationMs: Number.isFinite(durationSeconds) && durationSeconds > 0
      ? Math.round(durationSeconds * 1000)
      : null,
    width: video?.width ?? null,
    height: video?.height ?? null,
    fps: ratioToNumber(video?.avg_frame_rate) ?? ratioToNumber(video?.r_frame_rate),
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    sampleRate: audio?.sample_rate ? Number(audio.sample_rate) : null,
    channels: audio?.channels ?? null,
    bitrate: parsed.format?.bit_rate ? Number(parsed.format.bit_rate) : null,
    formatName: parsed.format?.format_name ?? null,
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
    rotation: Number.isFinite(rotationRaw) ? Math.abs(rotationRaw) : null,
  };
}

export async function generateThumbnail(
  input: string,
  output: string,
  opts: { durationMs: number | null; isVideo: boolean },
): Promise<boolean> {
  await fs.mkdir(path.dirname(output), { recursive: true });
  const args: string[] = [];
  if (opts.isVideo) {
    const seekSeconds = Math.min(
      1,
      Math.max(0, ((opts.durationMs ?? 2000) / 1000) * 0.1),
    );
    args.push("-ss", seekSeconds.toFixed(3));
  }
  args.push(
    "-i",
    input,
    "-frames:v",
    "1",
    "-vf",
    "scale='min(720,iw)':-2",
    "-q:v",
    "3",
    "-y",
    output,
  );
  const result = await runBinary(ffmpegPath, args, { timeoutMs: 60_000 });
  if (result.code !== 0) {
    await fs.rm(output, { force: true });
    return false;
  }
  try {
    const stat = await fs.stat(output);
    return stat.size > 0;
  } catch {
    return false;
  }
}

export async function extractWaveform(
  input: string,
  output: string,
  durationMs: number | null,
): Promise<{ peaks: number[]; durationMs: number } | null> {
  const args = [
    "-v",
    "error",
    "-i",
    input,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "4000",
    "-f",
    "s16le",
    "pipe:1",
  ];
  const samples = await new Promise<Buffer>((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const limit = 64 * 1024 * 1024;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error("waveform timeout"));
    }, 120_000);
    child.stdout.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total <= limit) chunks.push(chunk);
    });
    child.stderr.on("data", () => {
      /* ignore ffmpeg diagnostics */
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(Buffer.concat(chunks));
    });
  });

  if (samples.length < 2) return null;
  const sampleCount = Math.floor(samples.length / 2);
  const bucketCount = Math.max(200, Math.min(1400, Math.floor(sampleCount / 64)));
  const bucketSize = Math.max(1, Math.floor(sampleCount / bucketCount));
  const peaks: number[] = [];
  let globalMax = 1;
  for (let b = 0; b < bucketCount; b += 1) {
    const start = b * bucketSize;
    const end = Math.min(sampleCount, start + bucketSize);
    let peak = 0;
    for (let i = start; i < end; i += 1) {
      const value = Math.abs(samples.readInt16LE(i * 2));
      if (value > peak) peak = value;
    }
    if (peak > globalMax) globalMax = peak;
    peaks.push(peak);
  }
  const normalized = peaks.map((p) => Number((p / globalMax).toFixed(4)));
  const payload = { peaks: normalized, durationMs: durationMs ?? 0 };
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(payload), "utf8");
  return payload;
}

export async function verifyMediaFile(file: string): Promise<ProbeResult> {
  return probeMedia(file);
}

export async function extractAudioWav(
  input: string,
  output: string,
  opts: { sampleRate?: number; channels?: number } = {},
): Promise<void> {
  const sampleRate = opts.sampleRate ?? 16000;
  const channels = opts.channels ?? 1;
  const result = await runBinary(
    ffmpegPath,
    [
      "-v",
      "error",
      "-i",
      input,
      "-vn",
      "-ac",
      String(channels),
      "-ar",
      String(sampleRate),
      "-acodec",
      "pcm_s16le",
      "-y",
      output,
    ],
    { timeoutMs: 300_000 },
  );
  if (result.code !== 0) {
    throw new AppError(422, "audio_extract_failed", "Could not extract audio from the media");
  }
}

export async function hasAudioStream(file: string): Promise<boolean> {
  const probe = await probeMedia(file);
  return probe.hasAudio;
}
