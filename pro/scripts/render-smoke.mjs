#!/usr/bin/env node
/**
 * Real render smoke test: uploads a fixture, requests an export, waits for the
 * FFmpeg worker, downloads the MP4 and probes the actual output.
 *
 * Usage: node scripts/render-smoke.mjs
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, "..");
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:4320";
const PASSWORD = process.env.APP_PASSWORD ?? "cutroom-dev";
const ffprobe = require("ffprobe-static").path;

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function cookieHeader(response) {
  const values = response.headers.getSetCookie?.() ?? [];
  if (values.length > 0) return values.map((value) => value.split(";")[0]).join("; ");
  return response.headers.get("set-cookie") ?? "";
}

async function readJson(response) {
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    return { status: response.status, body: text };
  }
}

async function main() {
  const loginResponse = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: PASSWORD }),
  });
  const login = await readJson(loginResponse);
  if (!loginResponse.ok) throw new Error(`Login failed: ${JSON.stringify(login.body)}`);
  const cookie = cookieHeader(loginResponse);
  const csrf = login.body.csrfToken;
  console.log(`Signed in at ${BASE}`);

  const authHeaders = { cookie, "x-csrf-token": csrf };
  const projectResponse = await fetch(`${BASE}/api/projects`, {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify({ name: "Render smoke", width: 1920, height: 1080, fps: 30 }),
  });
  const projectJson = await readJson(projectResponse);
  if (!projectResponse.ok) throw new Error(`Project failed: ${JSON.stringify(projectJson.body)}`);
  const projectId = projectJson.body.project.id;
  console.log(`Created project ${projectId}`);

  try {
    const bytes = await readFile(path.join(ROOT, "test-fixtures", "fixture-a.mp4"));
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: "video/mp4" }), "fixture-a.mp4");
    const uploadResponse = await fetch(`${BASE}/api/projects/${projectId}/assets`, {
      method: "POST",
      headers: authHeaders,
      body: form,
    });
    const upload = await readJson(uploadResponse);
    check("fixture uploads", uploadResponse.status === 201, JSON.stringify(upload.body.error ?? ""));

    const noCsrf = await fetch(`${BASE}/api/projects/${projectId}/renders`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: "{}",
    });
    check("render requests require CSRF", noCsrf.status === 403, String(noCsrf.status));

    const startResponse = await fetch(`${BASE}/api/projects/${projectId}/renders`, {
      method: "POST",
      headers: { ...authHeaders, "content-type": "application/json" },
      body: "{}",
    });
    const started = await readJson(startResponse);
    check("render job is accepted", startResponse.status === 202 && Boolean(started.body.job?.id), JSON.stringify(started.body.error ?? ""));
    const jobId = started.body.job.id;

    let job = started.body.job;
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 700));
      const response = await fetch(`${BASE}/api/renders/${jobId}`, { headers: authHeaders });
      const payload = await readJson(response);
      job = payload.body.job;
      if (job.status === "succeeded" || job.status === "failed") break;
      process.stdout.write(`\r  render ${job.status} ${job.progress}%   `);
    }
    process.stdout.write("\r");
    check("render succeeds", job.status === "succeeded", job.error ?? job.status);
    check("render reaches 100%", job.progress === 100, String(job.progress));
    check("render exposes a file URL", Boolean(job.fileUrl));

    if (job.status !== "succeeded") {
      const detail = await fetch(`${BASE}/api/renders/${jobId}`, { headers: authHeaders });
      console.error(JSON.stringify((await detail.json()).job, null, 2));
      return;
    }

    const unauth = await fetch(`${BASE}${job.fileUrl}`);
    check("render files require a session", unauth.status === 401, String(unauth.status));

    const rangeResponse = await fetch(`${BASE}${job.fileUrl}`, {
      headers: { ...authHeaders, range: "bytes=0-1023" },
    });
    const rangeBody = new Uint8Array(await rangeResponse.arrayBuffer());
    check("range request returns 206", rangeResponse.status === 206, String(rangeResponse.status));
    check("range body is 1024 bytes", rangeBody.length === 1024, String(rangeBody.length));
    check("range header is correct", rangeResponse.headers.get("content-range")?.startsWith("bytes 0-1023/"), rangeResponse.headers.get("content-range") ?? "");

    const download = await fetch(`${BASE}${job.downloadUrl}`, { headers: authHeaders });
    const downloadBytes = new Uint8Array(await download.arrayBuffer());
    check("download succeeds", download.ok, String(download.status));
    check("download is an MP4", String.fromCharCode(...downloadBytes.slice(4, 8)) === "ftyp");
    check("download is larger than 100 KB", downloadBytes.length > 100_000, String(downloadBytes.length));
    check("download is an attachment", (download.headers.get("content-disposition") ?? "").startsWith("attachment"), download.headers.get("content-disposition") ?? "");

    const db = new DatabaseSync(path.join(ROOT, "data", "app.db"));
    const row = db
      .prepare("SELECT output_path, plan_json, status FROM render_jobs WHERE id = ?")
      .get(jobId);
    db.close();
    check("output lives under data/renders", Boolean(row?.output_path?.includes(path.join("data", "renders", projectId))), row?.output_path ?? "");
    check("render plan was persisted", Boolean(row?.plan_json?.includes('"durationMs"')), String(row?.plan_json?.length));

    const probeRaw = execFileSync(
      ffprobe,
      ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", row.output_path],
      { encoding: "utf8" },
    );
    const probe = JSON.parse(probeRaw);
    const video = probe.streams.find((stream) => stream.codec_type === "video");
    const audio = probe.streams.find((stream) => stream.codec_type === "audio");
    const duration = Number(probe.format.duration);
    check("output is 1920x1080", video?.width === 1920 && video?.height === 1080, `${video?.width}x${video?.height}`);
    check("output is about six seconds", duration > 5.7 && duration < 6.4, String(duration));
    check("output has an audio stream", Boolean(audio), audio?.codec_name ?? "none");
    console.log(`\nRendered ${path.basename(row.output_path)} · ${(downloadBytes.length / 1024 / 1024).toFixed(2)} MB · ${duration.toFixed(2)}s`);
  } finally {
    const cleanup = await fetch(`${BASE}/api/projects/${projectId}`, {
      method: "DELETE",
      headers: authHeaders,
    });
    console.log(`Cleanup: ${cleanup.status}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} render checks failed`);
    process.exitCode = 1;
  } else {
    console.log("All render checks passed.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
