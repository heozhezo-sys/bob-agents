import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// src/config.ts -> server/src ; dist/config.js -> server/dist
export const PROJECT_ROOT = path.resolve(here, "..", "..");

const envFile = path.join(PROJECT_ROOT, ".env");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === "1" || value.toLowerCase() === "true";
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number.parseInt(process.env.PORT ?? "4320", 10),
  host: process.env.HOST ?? "127.0.0.1",
  projectRoot: PROJECT_ROOT,
  dataDir: path.resolve(process.env.DATA_DIR ?? path.join(PROJECT_ROOT, "data")),
  appPassword: process.env.APP_PASSWORD ?? "",
  resetPassword: bool(process.env.APP_PASSWORD_RESET, false),
  sessionTtlDays: Number.parseInt(process.env.SESSION_TTL_DAYS ?? "30", 10),
  maxUploadBytes: Number.parseInt(
    process.env.MAX_UPLOAD_BYTES ?? String(2 * 1024 * 1024 * 1024),
    10,
  ),
  ffmpegPath: process.env.FFMPEG_PATH ?? "",
  ffprobePath: process.env.FFPROBE_PATH ?? "",
  openCodeApiKey: process.env.OPENCODE_API_KEY ?? "",
  openCodeBaseUrl:
    process.env.OPENCODE_BASE_URL ?? "https://opencode.ai/inference/openai/v1",
  openCodeModel: process.env.OPENCODE_MODEL ?? "deepseek-v4.1-flash-free",
  agentProvider: process.env.AGENT_PROVIDER === "mock" ? "mock" : "opencode",
  targetProxyHeight: Number.parseInt(process.env.PROXY_HEIGHT ?? "540", 10),
  maxRenderSeconds: Number.parseInt(process.env.MAX_RENDER_SECONDS ?? "1800", 10),
  logLevel: process.env.LOG_LEVEL ?? "info",
} as const;

export const paths = {
  db: path.join(config.dataDir, "app.db"),
  uploads: path.join(config.dataDir, "uploads"),
  thumbnails: path.join(config.dataDir, "thumbnails"),
  waveforms: path.join(config.dataDir, "waveforms"),
  proxies: path.join(config.dataDir, "proxies"),
  renders: path.join(config.dataDir, "renders"),
  tmp: path.join(config.dataDir, "tmp"),
  transcripts: path.join(config.dataDir, "transcripts"),
};

export function ensureDataDirs(): void {
  for (const dir of Object.values(paths)) {
    if (dir === paths.db) continue;
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function isProduction(): boolean {
  return config.nodeEnv === "production";
}
