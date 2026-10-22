#!/usr/bin/env node
/**
 * Generates deterministic, real media fixtures with the bundled FFmpeg.
 * Files are written to ./test-fixtures (gitignored) and reused by
 * `npm run smoke` plus the server integration tests.
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "test-fixtures");
const FORCE = process.env.FORCE === "1";
const ffmpeg = process.env.FFMPEG_PATH ?? require("ffmpeg-static");

const jobs = [
  {
    file: "fixture-a.mp4",
    args: [
      "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
      "-t", "6",
      "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k",
    ],
  },
  {
    file: "fixture-b.mp4",
    args: [
      "-f", "lavfi", "-i", "smptebars=size=1280x720:rate=30",
      "-f", "lavfi", "-i", "sine=frequency=660:sample_rate=48000",
      "-t", "4",
      "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k",
    ],
  },
  {
    file: "tone.wav",
    args: [
      "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=48000",
      "-t", "3", "-c:a", "pcm_s16le",
    ],
  },
  {
    file: "frame.png",
    args: [
      "-f", "lavfi", "-i", "color=c=#ff8a3d:s=960x540",
      "-frames:v", "1",
    ],
  },
];

const SRT = `1
00:00:00,000 --> 00:00:03,000
A real subtitle line from a real file.

2
00:00:03,100 --> 00:00:05,800
Nothing here is fabricated.
`;

async function main() {
  await mkdir(OUT, { recursive: true });
  for (const job of jobs) {
    const target = path.join(OUT, job.file);
    if (!FORCE && existsSync(target)) {
      console.log(`skip  ${job.file} (exists, FORCE=1 to rebuild)`);
      continue;
    }
    console.log(`build ${job.file}`);
    execFileSync(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", ...job.args, target], {
      stdio: "inherit",
    });
  }
  const srt = path.join(OUT, "sample.srt");
  if (FORCE || !existsSync(srt)) {
    await writeFile(srt, SRT, "utf8");
    console.log("build sample.srt");
  } else {
    console.log("skip  sample.srt (exists)");
  }
  console.log(`\nFixtures ready in ${OUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
