#!/usr/bin/env node
/**
 * End-to-end smoke test against a running CUTROOM server.
 *
 * It signs in with the owner passphrase, creates a project, uploads real
 * fixtures through the HTTP API, and verifies the persisted rows, generated
 * thumbnail/waveform, range streaming, subtitle reading and auth boundaries.
 *
 * Usage:
 *   node scripts/smoke.mjs            # keeps the project for UI testing
 *   CLEANUP=1 node scripts/smoke.mjs  # deletes the project afterwards
 *
 * Env:
 *   BASE_URL (default http://127.0.0.1:4320)
 *   APP_PASSWORD (default cutroom-dev)
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:4320";
const PASSWORD = process.env.APP_PASSWORD ?? "cutroom-dev";
const ROOT = path.resolve(import.meta.dirname, "..");
const DATA_DIR = path.join(ROOT, "data");

const FIXTURES = [
  { file: "fixture-a.mp4", kind: "video", mime: "video/mp4" },
  { file: "fixture-b.mp4", kind: "video", mime: "video/mp4" },
  { file: "tone.wav", kind: "audio", mime: "audio/wav" },
  { file: "frame.png", kind: "image", mime: "image/png" },
  { file: "sample.srt", kind: "subtitle", mime: "application/x-subrip" },
];

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
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
  if (!loginResponse.ok || !login.body?.csrfToken) {
    throw new Error(`Login failed (${login.status}): ${JSON.stringify(login.body)}`);
  }
  const cookie = cookieHeader(loginResponse);
  const csrf = login.body.csrfToken;
  const authHeaders = { cookie, "x-csrf-token": csrf };
  console.log(`Signed in at ${BASE}`);

  const createResponse = await fetch(`${BASE}/api/projects`, {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify({
      name: `Real footage smoke ${new Date().toISOString().slice(0, 19)}`,
      width: 1920,
      height: 1080,
      fps: 30,
    }),
  });
  const created = await readJson(createResponse);
  if (!createResponse.ok || !created.body?.project?.id) {
    throw new Error(`Create project failed (${created.status}): ${JSON.stringify(created.body)}`);
  }
  const projectId = created.body.project.id;
  console.log(`Created project ${projectId}`);

  for (const fixture of FIXTURES) {
    const bytes = await readFile(path.join(ROOT, "test-fixtures", fixture.file));
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: fixture.mime }), fixture.file);
    const started = Date.now();
    const response = await fetch(`${BASE}/api/projects/${projectId}/assets`, {
      method: "POST",
      headers: { cookie, "x-csrf-token": csrf },
      body: form,
    });
    const result = await readJson(response);
    if (!response.ok) {
      console.error(`  FAIL  upload ${fixture.file} (${result.status})`, result.body);
      failures += 1;
      continue;
    }
    const asset = result.body.asset;
    console.log(
      `Uploaded ${fixture.file} → ${asset.kind} · ${asset.durationMs ?? "—"} ms · ${Date.now() - started} ms`,
    );
    check(`kind of ${fixture.file} is ${fixture.kind}`, asset.kind === fixture.kind, asset.kind);
  }

  const detailResponse = await fetch(`${BASE}/api/projects/${projectId}`, {
    headers: { cookie },
  });
  const detail = await readJson(detailResponse);
  check("project detail loads", detailResponse.ok, String(detail.status));
  const project = detail.body.project;
  check("all five sources are stored", project.assets.length === 5, String(project.assets.length));

  const clips = project.tracks.flatMap((track) => track.clips);
  check("clips were persisted", clips.length === 4, String(clips.length));
  check("video track received the visual sources", project.tracks.find((t) => t.kind === "video")?.clips.length === 3, String(project.tracks.find((t) => t.kind === "video")?.clips.length));
  check("audio track received the wav", project.tracks.find((t) => t.kind === "audio")?.clips.length === 1, String(project.tracks.find((t) => t.kind === "audio")?.clips.length));
  check("timeline duration includes 5s still", project.durationMs === 15000, String(project.durationMs));

  const video = project.assets.find((asset) => asset.kind === "video");
  const subtitle = project.assets.find((asset) => asset.kind === "subtitle");
  check("thumbnail URL present", Boolean(video.thumbnailUrl));

  const thumbnail = await fetch(`${BASE}${video.thumbnailUrl}`, { headers: { cookie } });
  const thumbnailBytes = await thumbnail.arrayBuffer();
  check("thumbnail streams as JPEG", thumbnail.status === 200 && thumbnailBytes.byteLength > 500, `${thumbnail.status} / ${thumbnailBytes.byteLength}`);

  const waveform = await fetch(`${BASE}/api/assets/${video.id}/waveform`, {
    headers: { cookie },
  });
  const waveformBody = await readJson(waveform);
  check("waveform JSON has peaks", waveform.ok && Array.isArray(waveformBody.body?.peaks) && waveformBody.body.peaks.length > 10, String(waveformBody.body?.peaks?.length));

  const range = await fetch(`${BASE}${video.streamUrl}`, {
    headers: { cookie, range: "bytes=0-1023" },
  });
  const rangeBytes = await range.arrayBuffer();
  check("range request returns 206", range.status === 206, String(range.status));
  check("range body is 1024 bytes", rangeBytes.byteLength === 1024, String(rangeBytes.byteLength));
  check("content-range header present", /^bytes 0-1023\//.test(range.headers.get("content-range") ?? ""), range.headers.get("content-range") ?? "missing");

  const subtitleResponse = await fetch(`${BASE}${subtitle.streamUrl}`, { headers: { cookie } });
  const subtitleText = await subtitleResponse.text();
  check("subtitle file is readable", subtitleText.includes("fabricated"), subtitleText.slice(0, 40));

  const anonymous = await fetch(`${BASE}/api/projects/${projectId}`);
  check("project is protected without a session", anonymous.status === 401, String(anonymous.status));

  const db = new DatabaseSync(path.join(DATA_DIR, "app.db"));
  try {
    const rows = db
      .prepare("SELECT storage_path, thumbnail_path, waveform_path FROM media_assets WHERE project_id = ?")
      .all(projectId);
    check("all assets live inside the project upload dir", rows.every((row) => row.storage_path.startsWith(path.join(DATA_DIR, "uploads", projectId))));
    const clipRows = db
      .prepare(
        "SELECT COUNT(*) AS count FROM clips c JOIN tracks t ON t.id = c.track_id WHERE t.project_id = ?",
      )
      .get(projectId);
    check("database clip count matches the API", clipRows.count === clips.length, `${clipRows.count} vs ${clips.length}`);
    const auditRows = db
      .prepare("SELECT COUNT(*) AS count FROM audit_events WHERE entity_id = ?")
      .get(projectId);
    check("audit events were written", auditRows.count > 0, String(auditRows.count));
  } finally {
    db.close();
  }

  console.log("\nTimeline edit API");
  const mutateRequest = (path, method, body, headers = authHeaders) =>
    fetch(`${BASE}${path}`, {
      method,
      headers: { ...headers, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  let state = project;
  const baseClip = state.tracks.flatMap((track) => track.clips).find((clip) => clip.assetId === video.id);
  if (!baseClip) throw new Error("The uploaded video has no timeline clip");

  let response = await mutateRequest(
    `/api/projects/${projectId}/clips/${baseClip.id}`,
    "PATCH",
    { durationMs: 5000 },
  );
  let result = await readJson(response);
  check("trimming a clip persists", response.ok && result.body.project.tracks.flatMap((t) => t.clips).find((c) => c.id === baseClip.id)?.durationMs === 5000, JSON.stringify(result.body.error ?? ""));
  state = result.body.project;

  response = await mutateRequest(
    `/api/projects/${projectId}/clips/${baseClip.id}`,
    "PATCH",
    { startMs: 7000 },
  );
  check("overlapping moves are rejected", response.status === 409, String(response.status));

  response = await mutateRequest(
    `/api/projects/${projectId}/clips/${baseClip.id}`,
    "PATCH",
    { inMs: 2000 },
  );
  check("clips cannot run past the source", response.status === 400, String(response.status));

  response = await mutateRequest(
    `/api/projects/${projectId}/clips/${baseClip.id}/split`,
    "POST",
    { atMs: 2500 },
  );
  result = await readJson(response);
  const splitClip = result.body.project.tracks
    .flatMap((track) => track.clips)
    .find((clip) => clip.startMs === 2500 && clip.assetId === video.id && clip.id !== baseClip.id);
  check("split creates a second persisted clip", response.status === 201 && Boolean(splitClip), String(response.status));
  if (splitClip) {
    check("split keeps both halves at 2.5s", splitClip.durationMs === 2500);
  }
  state = result.body.project;

  if (splitClip) {
    response = await mutateRequest(
      `/api/projects/${projectId}/clips/${splitClip.id}`,
      "PATCH",
      { startMs: 15000 },
    );
    result = await readJson(response);
    check(
      "moving a clip to a free range works",
      response.ok &&
        result.body.project.tracks
          .flatMap((track) => track.clips)
          .some((clip) => clip.id === splitClip.id && clip.startMs === 15000),
      JSON.stringify(result.body.error ?? ""),
    );
    state = result.body.project;

    response = await mutateRequest(
      `/api/projects/${projectId}/clips/${splitClip.id}`,
      "DELETE",
    );
    result = await readJson(response);
    check(
      "deleting a clip removes it",
      response.ok && !result.body.project.tracks.flatMap((track) => track.clips).some((clip) => clip.id === splitClip.id),
      String(response.status),
    );
    state = result.body.project;
  }

  response = await mutateRequest(`/api/projects/${projectId}/clips`, "POST", {
    assetId: video.id,
    startMs: 20000,
  });
  result = await readJson(response);
  const addedClip = result.body.project?.tracks
    .flatMap((track) => track.clips)
    .find((clip) => clip.startMs === 20000 && clip.assetId === video.id);
  check("a source can be added to the timeline again", response.status === 201 && Boolean(addedClip), String(response.status));
  if (addedClip) {
    response = await mutateRequest(`/api/projects/${projectId}/clips/${addedClip.id}`, "DELETE");
    result = await readJson(response);
    state = result.body.project;
  }

  response = await mutateRequest(
    `/api/projects/${projectId}/clips/${baseClip.id}`,
    "PATCH",
    { durationMs: 2000 },
    { cookie },
  );
  check("clip edits require the CSRF token", response.status === 403, String(response.status));

  response = await mutateRequest(
    `/api/projects/${projectId}/clips/${baseClip.id}`,
    "PATCH",
    { durationMs: 2000 },
    { "x-csrf-token": csrf },
  );
  check("clip edits require a session", response.status === 401, String(response.status));
  check("final timeline still has four clips", state.tracks.flatMap((track) => track.clips).length === 4, String(state.tracks.flatMap((track) => track.clips).length));

  if (process.env.CLEANUP === "1") {
    const removed = await fetch(`${BASE}/api/projects/${projectId}`, {
      method: "DELETE",
      headers: authHeaders,
    });
    check("cleanup deleted the project", removed.ok, String(removed.status));
  } else {
    console.log(`\nProject kept for UI testing: ${BASE}/projects/${projectId}`);
    console.log(`Open through Vite: http://localhost:5173/projects/${projectId}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log("\nAll smoke checks passed.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
