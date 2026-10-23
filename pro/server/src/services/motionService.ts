import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { ProjectDetail } from "@ai-video-agent-studio/shared";
import { config, paths } from "../config.js";
import { mutate } from "../db/index.js";
import { AppError } from "../lib/errors.js";
import { ffmpegPath, runBinary } from "../lib/ffmpeg.js";
import { createClip, ownedProject } from "./clipEdits.js";
import { deleteAssetFiles, ingestUpload, type MediaRow } from "./mediaService.js";

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a #RRGGBB color");

export const motionSpecSchema = z
  .object({
    layout: z.enum(["title", "bullets", "bars"]),
    title: z.string().trim().min(1).max(80),
    subtitle: z.string().trim().max(120).optional(),
    bullets: z.array(z.string().trim().min(1).max(80)).min(1).max(5).optional(),
    bars: z
      .array(
        z.object({
          label: z.string().trim().min(1).max(24),
          value: z.number().finite().min(0).max(1_000_000_000),
        }),
      )
      .min(1)
      .max(5)
      .optional(),
    durationMs: z.number().int().min(2000).max(15000).default(4000),
    background: hexColor.default("#0e1013"),
    accent: hexColor.default("#ff8a3d"),
  })
  .superRefine((spec, ctx) => {
    if (spec.layout === "bullets" && !spec.bullets?.length) {
      ctx.addIssue({
        code: "custom",
        path: ["bullets"],
        message: "A bullet card needs bullets.",
      });
    }
    if (spec.layout === "bars" && !spec.bars?.length) {
      ctx.addIssue({
        code: "custom",
        path: ["bars"],
        message: "A bar card needs bars.",
      });
    }
  });

export type MotionSpec = z.infer<typeof motionSpecSchema>;

export interface MotionResult {
  asset: MediaRow;
  startMs: number;
  durationMs: number;
}

const TEXT = "0xf5f6f8";
const MUTED = "0xa7abb5";

function ffmpegColor(hex: string): string {
  return `0x${hex.slice(1)}`;
}

function resolveFont(): string {
  const candidates = [
    config.motionFont,
    "C:\\Windows\\Fonts\\seguisb.ttf",
    "C:\\Windows\\Fonts\\arialbd.ttf",
    "C:\\Windows\\Fonts\\segoeui.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new AppError(
    500,
    "motion_font_missing",
    "No motion font found. Set MOTION_FONT to a .ttf path and restart the API.",
  );
}

function wrap(text: string, maxChars: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && line.length + 1 + word.length > maxChars) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 4);
}

class TextBank {
  private lines: { name: string; text: string }[] = [];

  add(text: string): string {
    const name = `line-${this.lines.length}.txt`;
    this.lines.push({ name, text });
    return name;
  }

  write(dir: string): Promise<void> {
    return Promise.all(
      this.lines.map((line) => fsp.writeFile(path.join(dir, line.name), line.text, "utf8")),
    ).then(() => undefined);
  }
}

function drawText(
  file: string,
  options: {
    size: number;
    x: number | string;
    y: number;
    color?: string;
    alpha?: string;
    enable?: string;
  },
): string {
  const parts = [
    "drawtext=fontfile=font.ttf",
    `textfile=${file}`,
    "expansion=none",
    `fontcolor=${options.color ?? TEXT}`,
    `fontsize=${options.size}`,
    `x=${options.x}`,
    `y=${options.y}`,
  ];
  if (options.alpha) parts.push(`alpha='${options.alpha}'`);
  if (options.enable) parts.push(`enable='${options.enable}'`);
  return parts.join(":");
}

function titleFilters(
  spec: MotionSpec,
  width: number,
  height: number,
  bank: TextBank,
): string[] {
  const margin = Math.round(width * 0.08);
  const titleSize = Math.max(28, Math.round(width * 0.072));
  const subtitleSize = Math.max(16, Math.round(width * 0.028));
  const titleLines = wrap(spec.title, 22);
  const subtitleLines = spec.subtitle ? wrap(spec.subtitle, 42) : [];
  const titleLine = Math.round(titleSize * 1.18);
  const subtitleLine = Math.round(subtitleSize * 1.3);
  const blockHeight =
    titleLines.length * titleLine +
    (subtitleLines.length
      ? Math.round(titleSize * 0.45) + subtitleLines.length * subtitleLine
      : 0);

  let y = Math.max(margin, Math.round((height - blockHeight) / 2));
  const filters = [
    `drawbox=x=${margin}:y=${Math.max(0, y - Math.round(titleSize * 0.55))}:w=${Math.round(width * 0.055)}:h=${Math.max(4, Math.round(width * 0.004))}:color=${ffmpegColor(spec.accent)}:t=fill`,
  ];
  for (const line of titleLines) {
    filters.push(drawText(bank.add(line), { size: titleSize, x: margin, y }));
    y += titleLine;
  }
  if (subtitleLines.length) {
    y += Math.round(titleSize * 0.45);
    for (const line of subtitleLines) {
      filters.push(
        drawText(bank.add(line), {
          size: subtitleSize,
          x: margin,
          y,
          color: MUTED,
        }),
      );
      y += subtitleLine;
    }
  }
  return filters;
}

function bulletFilters(
  spec: MotionSpec,
  width: number,
  height: number,
  bank: TextBank,
): string[] {
  const margin = Math.round(width * 0.08);
  const titleSize = Math.max(22, Math.round(width * 0.05));
  const bulletSize = Math.max(16, Math.round(width * 0.032));
  const titleLine = Math.round(titleSize * 1.18);
  const bulletLine = Math.round(bulletSize * 1.28);
  const dot = Math.max(6, Math.round(width * 0.006));
  const filters: string[] = [];

  let y = margin;
  for (const line of wrap(spec.title, 28)) {
    filters.push(drawText(bank.add(line), { size: titleSize, x: margin, y }));
    y += titleLine;
  }
  filters.push(
    `drawbox=x=${margin}:y=${y + 8}:w=${Math.round(width * 0.05)}:h=${Math.max(4, Math.round(width * 0.004))}:color=${ffmpegColor(spec.accent)}:t=fill`,
  );

  y = Math.max(y + Math.round(titleSize * 0.9), Math.round(height * 0.3));
  for (const [index, bullet] of (spec.bullets ?? []).entries()) {
    const start = 0.45 + index * 0.18;
    const lines = wrap(bullet, 44);
    filters.push(
      `drawbox=x=${margin}:y=${y + Math.round(bulletSize * 0.3)}:w=${dot}:h=${dot}:color=${ffmpegColor(spec.accent)}:t=fill:enable='gte(t,${start})'`,
    );
    for (const [lineIndex, line] of lines.entries()) {
      filters.push(
        drawText(bank.add(line), {
          size: bulletSize,
          x: margin + dot + Math.round(width * 0.018),
          y: y + lineIndex * bulletLine,
          alpha: `if(lt(t,${start}),0,min(1,(t-${start})/0.3))`,
          enable: `gte(t,${start})`,
        }),
      );
    }
    y += lines.length * bulletLine + Math.round(bulletSize * 0.85);
  }
  return filters;
}

function barFilters(
  spec: MotionSpec,
  width: number,
  height: number,
  bank: TextBank,
): string[] {
  const margin = Math.round(width * 0.08);
  const contentWidth = width - margin * 2;
  const titleSize = Math.max(22, Math.round(width * 0.048));
  const subtitleSize = Math.max(14, Math.round(width * 0.022));
  const labelSize = Math.max(13, Math.round(width * 0.024));
  const titleLine = Math.round(titleSize * 1.18);
  const subtitleLine = Math.round(subtitleSize * 1.3);
  const bars = spec.bars ?? [];
  const max = Math.max(...bars.map((bar) => bar.value), 1);
  const filters: string[] = [];

  let y = margin;
  for (const line of wrap(spec.title, 32)) {
    filters.push(drawText(bank.add(line), { size: titleSize, x: margin, y }));
    y += titleLine;
  }
  filters.push(
    `drawbox=x=${margin}:y=${y + 8}:w=${Math.round(width * 0.05)}:h=${Math.max(4, Math.round(width * 0.004))}:color=${ffmpegColor(spec.accent)}:t=fill`,
  );
  y += Math.round(titleSize * 0.5);
  if (spec.subtitle) {
    for (const line of wrap(spec.subtitle, 54)) {
      filters.push(
        drawText(bank.add(line), {
          size: subtitleSize,
          x: margin,
          y,
          color: MUTED,
        }),
      );
      y += subtitleLine;
    }
  }

  const top = Math.max(y + Math.round(titleSize * 0.5), Math.round(height * 0.34));
  const rowHeight = Math.max(1, Math.floor((height - margin - top) / bars.length));
  const barHeight = Math.max(8, Math.round(rowHeight * 0.28));

  bars.forEach((bar, index) => {
    const rowY = top + index * rowHeight;
    const trackY = rowY + labelSize + Math.round(rowHeight * 0.12);
    const start = 0.4 + index * 0.12;
    const fraction = bar.value / max;
    const fullWidth = Math.max(2, Math.round(contentWidth * fraction));
    const value = String(Math.round(bar.value * 10) / 10);

    filters.push(
      drawText(bank.add(bar.label), {
        size: labelSize,
        x: margin,
        y: rowY,
        color: MUTED,
      }),
    );
    filters.push(
      drawText(bank.add(value), {
        size: labelSize,
        x: `w-text_w-${margin}`,
        y: rowY,
        color: TEXT,
      }),
    );
    filters.push(
      `drawbox=x=${margin}:y=${trackY}:w=${contentWidth}:h=${barHeight}:color=0xffffff@0.08:t=fill`,
    );
    filters.push(
      `drawbox=x=${margin}:y=${trackY}:w='max(2,${fullWidth}*min(1,max(0,(t-${start})/0.6)))':h=${barHeight}:color=${ffmpegColor(spec.accent)}:t=fill:enable='gte(t,${start})'`,
    );
  });
  return filters;
}

export async function createMotionGraphic(
  userId: string,
  projectId: string,
  spec: MotionSpec,
): Promise<MotionResult> {
  const project = ownedProject(userId, projectId);
  const font = resolveFont();
  const workDir = await fsp.mkdtemp(path.join(paths.tmp, "motion-"));
  let asset: MediaRow | null = null;

  try {
    await fsp.copyFile(font, path.join(workDir, "font.ttf"));

    const bank = new TextBank();
    const body =
      spec.layout === "title"
        ? titleFilters(spec, project.width, project.height, bank)
        : spec.layout === "bullets"
          ? bulletFilters(spec, project.width, project.height, bank)
          : barFilters(spec, project.width, project.height, bank);
    await bank.write(workDir);

    const seconds = (spec.durationMs / 1000).toFixed(3);
    const fadeOut = Math.max(0, spec.durationMs / 1000 - 0.3).toFixed(3);
    const filters = [
      ...body,
      "fade=t=in:st=0:d=0.3",
      `fade=t=out:st=${fadeOut}:d=0.3`,
      "format=yuv420p",
    ].join(",");

    const args = [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=c=${ffmpegColor(spec.background)}:s=${project.width}x${project.height}:r=${project.fps}:d=${seconds}`,
      "-f",
      "lavfi",
      "-i",
      "anullsrc=channel_layout=stereo:sample_rate=48000",
      "-filter_complex",
      `[0:v]${filters}[v]`,
      "-map",
      "[v]",
      "-map",
      "1:a",
      "-t",
      seconds,
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
      "128k",
      "-shortest",
      "-movflags",
      "+faststart",
      "card.mp4",
    ];

    const result = await runBinary(ffmpegPath, args, {
      cwd: workDir,
      timeoutMs: 120_000,
    });
    if (result.code !== 0) {
      throw new AppError(
        500,
        "motion_render_failed",
        `The motion renderer failed. ${result.stderr.slice(-400)}`,
      );
    }

    asset = await ingestUpload({
      tempPath: path.join(workDir, "card.mp4"),
      originalName: `motion-${spec.layout}.mp4`,
      projectId,
      declaredMime: "video/mp4",
    });
    const ingested = asset;

    let detail: ProjectDetail;
    try {
      detail = createClip(userId, projectId, { assetId: ingested.id });
    } catch (error) {
      mutate("DELETE FROM media_assets WHERE id = ?", ingested.id);
      await deleteAssetFiles(ingested).catch(() => undefined);
      throw error;
    }

    const clips = detail.tracks.flatMap((track) => track.clips);
    const clip = clips
      .filter((item) => item.assetId === ingested.id)
      .sort((a, b) => b.startMs - a.startMs)[0];

    return {
      asset: ingested,
      startMs: clip?.startMs ?? 0,
      durationMs: clip?.durationMs ?? ingested.duration_ms ?? spec.durationMs,
    };
  } finally {
    await fsp
      .rm(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
      .catch((error: unknown) => {
        console.error("[motion] could not remove the work directory:", error);
      });
  }
}
