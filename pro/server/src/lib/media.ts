import fs from "node:fs/promises";
import path from "node:path";
import { paths } from "../config.js";
import { AppError } from "./errors.js";

export type DetectedKind = "video" | "audio" | "image" | "subtitle" | "unknown";

export interface SniffResult {
  kind: DetectedKind;
  mimeType: string;
  extension: string;
}

const EXTENSION_BY_MIME: Record<string, string> = {
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
  "video/x-matroska": ".mkv",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
  "audio/mp4": ".m4a",
  "audio/aac": ".aac",
  "audio/ogg": ".ogg",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "text/plain": ".txt",
};

const ALLOWED_EXTENSIONS = new Set([
  ".mp4",
  ".mov",
  ".webm",
  ".mkv",
  ".mp3",
  ".wav",
  ".m4a",
  ".aac",
  ".ogg",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".srt",
  ".vtt",
]);

function startsWith(buffer: Buffer, bytes: number[]): boolean {
  if (buffer.length < bytes.length) return false;
  return bytes.every((byte, index) => buffer[index] === byte);
}

function ascii(buffer: Buffer, start: number, length: number): string {
  return buffer.subarray(start, start + length).toString("ascii");
}

export function sniffMedia(buffer: Buffer): SniffResult {
  if (buffer.length >= 12 && ascii(buffer, 4, 4) === "ftyp") {
    const brand = ascii(buffer, 8, 4);
    if (brand.startsWith("qt")) {
      return { kind: "video", mimeType: "video/quicktime", extension: ".mov" };
    }
    return { kind: "video", mimeType: "video/mp4", extension: ".mp4" };
  }
  if (startsWith(buffer, [0x1a, 0x45, 0xdf, 0xa3])) {
    return { kind: "video", mimeType: "video/webm", extension: ".webm" };
  }
  if (startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) && ascii(buffer, 8, 4) === "WAVE") {
    return { kind: "audio", mimeType: "audio/wav", extension: ".wav" };
  }
  if (startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) && ascii(buffer, 8, 4) === "WEBP") {
    return { kind: "image", mimeType: "image/webp", extension: ".webp" };
  }
  if (startsWith(buffer, [0x49, 0x44, 0x33]) || startsWith(buffer, [0xff, 0xfb])) {
    return { kind: "audio", mimeType: "audio/mpeg", extension: ".mp3" };
  }
  if (startsWith(buffer, [0x4f, 0x67, 0x67, 0x53])) {
    return { kind: "audio", mimeType: "audio/ogg", extension: ".ogg" };
  }
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) {
    return { kind: "image", mimeType: "image/jpeg", extension: ".jpg" };
  }
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47])) {
    return { kind: "image", mimeType: "image/png", extension: ".png" };
  }

  const text = buffer.toString("utf8");
  if (!text.includes("\u0000")) {
    const trimmed = text.trimStart();
    if (trimmed.startsWith("WEBVTT")) {
      return { kind: "subtitle", mimeType: "text/vtt", extension: ".vtt" };
    }
    if (/^\d+\r?\n\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->/.test(trimmed)) {
      return { kind: "subtitle", mimeType: "application/x-subrip", extension: ".srt" };
    }
    if (trimmed.length > 0 && /^[\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]+$/.test(trimmed)) {
      return { kind: "subtitle", mimeType: "text/plain", extension: ".txt" };
    }
  }

  return { kind: "unknown", mimeType: "application/octet-stream", extension: "" };
}

export function safeOriginalName(name: string): string {
  const base = path.basename(name.replace(/\\/g, "/"));
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[<>:"/\\|?*]/g, "_")
    .trim();
  return (cleaned || "upload").slice(0, 200);
}

export function extensionFor(originalName: string, detected: SniffResult): string {
  const ext = path.extname(originalName).toLowerCase();
  if (detected.kind === "subtitle") {
    if (ext === ".srt" || ext === ".vtt") return ext;
    return detected.extension;
  }
  if (ALLOWED_EXTENSIONS.has(ext) && detected.kind !== "unknown") {
    if (detected.mimeType === "video/mp4" && (ext === ".mov" || ext === ".mp4")) return ext;
    if (detected.mimeType === "video/webm" && ext === ".mkv") return ".mkv";
  }
  return EXTENSION_BY_MIME[detected.mimeType] ?? detected.extension;
}

export function projectUploadDir(projectId: string): string {
  if (!/^[a-f0-9-]{36}$/i.test(projectId)) {
    throw new AppError(400, "invalid_project_id", "Invalid project id");
  }
  return path.join(paths.uploads, projectId);
}

export async function moveIntoPlace(from: string, to: string): Promise<void> {
  await fs.mkdir(path.dirname(to), { recursive: true });
  try {
    await fs.rename(from, to);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EXDEV") {
      await fs.copyFile(from, to);
      await fs.unlink(from);
      return;
    }
    throw error;
  }
}

export async function removeIfExists(file: string | null | undefined): Promise<void> {
  if (!file) return;
  try {
    await fs.unlink(file);
  } catch {
    /* best effort */
  }
}

export function resolveInside(base: string, child: string): string {
  const resolvedBase = path.resolve(base);
  const resolved = path.resolve(child);
  const relative = path.relative(resolvedBase, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new AppError(400, "path_traversal", "Invalid file path");
  }
  return resolved;
}

export async function readHead(file: string, bytes = 64): Promise<Buffer> {
  const handle = await fs.open(file, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}
