#!/usr/bin/env node
/**
 * Agent smoke test. Starts a private API on a spare port with the deterministic
 * mock model and a temporary data directory, then drives real edits through
 * /api/agent/chat. No network model call, no data left in the studio.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = Number(process.env.AGENT_SMOKE_PORT ?? 4399);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = process.env.APP_PASSWORD ?? "cutroom-dev";

let failures = 0;

function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${label}${detail ? ` - ${detail}` : ""}`);
  }
}

function cookieHeader(response) {
  const values = response.headers.getSetCookie?.() ?? [];
  if (values.length > 0) {
    return values.map((value) => value.split(";")[0]).join("; ");
  }
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

function clipsOf(project) {
  return project.tracks.flatMap((track) => track.clips);
}

function videoClipsOf(project) {
  return project.tracks.find((track) => track.kind === "video")?.clips ?? [];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(child, readStderr) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited early.\n${readStderr()}`);
    }
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.ok) return;
    } catch {
      // not listening yet
    }
    await sleep(250);
  }
  throw new Error(`Server did not start.\n${readStderr()}`);
}

async function main() {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cutroom-agent-"));
  let stderr = "";
  const child = spawn(
    process.execPath,
    [path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"), "server/src/index.ts"],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(PORT),
        HOST: "127.0.0.1",
        DATA_DIR: dataDir,
        APP_PASSWORD: PASSWORD,
        AGENT_PROVIDER: "mock",
        NODE_ENV: "test",
        LOG_LEVEL: "error",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.on("data", () => {});
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  try {
    await waitForServer(child, () => stderr);

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

    const call = async (method, pathname, body) => {
      const response = await fetch(`${BASE}${pathname}`, {
        method,
        headers:
          body === undefined
            ? authHeaders
            : { ...authHeaders, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return readJson(response);
    };

    const created = await call("POST", "/api/projects", {
      name: `Agent smoke ${new Date().toISOString().slice(0, 19)}`,
      width: 640,
      height: 360,
      fps: 30,
    });
    check("project is created", created.status === 201, JSON.stringify(created.body));
    const projectId = created.body.project.id;

    const bytes = await readFile(path.join(ROOT, "test-fixtures", "fixture-a.mp4"));
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: "video/mp4" }), "fixture-a.mp4");
    const uploadResponse = await fetch(
      `${BASE}/api/projects/${projectId}/assets`,
      { method: "POST", headers: authHeaders, body: form },
    );
    const upload = await readJson(uploadResponse);
    check("fixture uploads", uploadResponse.status === 201, JSON.stringify(upload.body));
    const afterUpload = await call("GET", `/api/projects/${projectId}`);
    check(
      "upload created one video clip",
      videoClipsOf(afterUpload.body.project).length === 1,
      String(videoClipsOf(afterUpload.body.project).length),
    );

    const state = await call("GET", `/api/agent/projects/${projectId}`);
    check("agent state loads", state.status === 200, JSON.stringify(state.body));
    check("mock provider is labelled", state.body.conversation.provider.name === "mock");
    check("mock provider is configured", state.body.conversation.provider.configured === true);
    check("transcript starts empty", state.body.conversation.messages.length === 0);

    const trim = await call("POST", "/api/agent/chat", {
      projectId,
      message: "Trim the first clip by one second",
    });
    check("trim chat returns 200", trim.status === 200, JSON.stringify(trim.body));
    const trimActions = trim.body.conversation.messages.at(-1)?.actions ?? [];
    check(
      "trim is reported as a successful action",
      trimActions[0]?.tool === "update_clip" && trimActions[0]?.ok === true,
      JSON.stringify(trimActions),
    );
    check(
      "clip is one second shorter",
      videoClipsOf(trim.body.project)[0]?.durationMs === 5000,
      String(videoClipsOf(trim.body.project)[0]?.durationMs),
    );
    check("undo is offered after trim", trim.body.conversation.canUndo === true);

    const trimUndo = await call(
      "POST",
      `/api/agent/turns/${trim.body.conversation.turnId}/undo`,
    );
    check("trim undo returns 200", trimUndo.status === 200, JSON.stringify(trimUndo.body));
    check(
      "undo restores the duration",
      videoClipsOf(trimUndo.body.project)[0]?.durationMs === 6000,
      String(videoClipsOf(trimUndo.body.project)[0]?.durationMs),
    );
    check("undo is no longer offered", trimUndo.body.conversation.canUndo === false);
    check("transcript survives undo", trimUndo.body.conversation.messages.length === 2);

    const split = await call("POST", "/api/agent/chat", {
      projectId,
      message: "Split the first clip in half",
    });
    check("split chat returns 200", split.status === 200, JSON.stringify(split.body));
    check("split leaves two video clips", videoClipsOf(split.body.project).length === 2);
    const splitTurnId = split.body.conversation.turnId;
    check("split turn is undoable", split.body.conversation.canUndo === true);

    const manual = await call("PATCH", `/api/projects/${projectId}`, {
      name: "Manual name",
    });
    check("manual rename succeeds", manual.status === 200, JSON.stringify(manual.body));
    const blocked = await call("POST", `/api/agent/turns/${splitTurnId}/undo`);
    check("undo after a manual edit is refused", blocked.status === 409, String(blocked.status));
    check(
      "refusal explains the guard",
      /changed after that turn/i.test(blocked.body?.error?.message ?? ""),
      JSON.stringify(blocked.body),
    );

    const remove = await call("POST", "/api/agent/chat", {
      projectId,
      message: "Delete the last clip",
    });
    check("delete chat returns 200", remove.status === 200, JSON.stringify(remove.body));
    check(
      "delete removes one video clip",
      videoClipsOf(remove.body.project).length === 1,
      String(videoClipsOf(remove.body.project).length),
    );
    const removeUndo = await call(
      "POST",
      `/api/agent/turns/${remove.body.conversation.turnId}/undo`,
    );
    check(
      "undo restores the deleted clip",
      videoClipsOf(removeUndo.body.project).length === 2,
      String(videoClipsOf(removeUndo.body.project).length),
    );

    const renamed = await call("POST", "/api/agent/chat", {
      projectId,
      message: "Rename the project to Agent cut",
    });
    check("rename changes the name", renamed.body.project.name === "Agent cut");
    const renamedUndo = await call(
      "POST",
      `/api/agent/turns/${renamed.body.conversation.turnId}/undo`,
    );
    check("undo restores the name", renamedUndo.body.project.name === "Manual name");

    const added = await call("POST", "/api/agent/chat", {
      projectId,
      message: "Add the first source to the timeline",
    });
    check(
      "add grows the clip count",
      videoClipsOf(added.body.project).length === 3,
      String(videoClipsOf(added.body.project).length),
    );
    const addedUndo = await call(
      "POST",
      `/api/agent/turns/${added.body.conversation.turnId}/undo`,
    );
    check(
      "undo removes the added clip",
      videoClipsOf(addedUndo.body.project).length === 2,
      String(videoClipsOf(addedUndo.body.project).length),
    );

    const card = await call("POST", "/api/agent/chat", {
      projectId,
      message: "Create a bar chart card",
    });
    check("motion chat returns 200", card.status === 200, JSON.stringify(card.body));
    const cardActions = card.body.conversation.messages.at(-1)?.actions ?? [];
    check(
      "motion action is recorded",
      cardActions.some(
        (action) => action.tool === "create_motion_graphic" && action.ok === true,
      ),
      JSON.stringify(cardActions),
    );
    check(
      "motion action carries a thumbnail",
      typeof cardActions[0]?.thumbnailUrl === "string",
      JSON.stringify(cardActions),
    );
    const cardAsset = card.body.project.assets.find((asset) =>
      asset.originalName.startsWith("motion-"),
    );
    check("card is ingested as a source", Boolean(cardAsset), JSON.stringify(card.body.project.assets));
    check(
      "card is appended as a clip",
      videoClipsOf(card.body.project).length === 3,
      String(videoClipsOf(card.body.project).length),
    );

    if (cardAsset) {
      const thumb = await fetch(`${BASE}${cardAsset.thumbnailUrl}`, {
        headers: authHeaders,
      });
      check("card thumbnail is served", thumb.status === 200, String(thumb.status));
      const stream = await fetch(`${BASE}/api/assets/${cardAsset.id}/stream`, {
        headers: { ...authHeaders, range: "bytes=0-1023" },
      });
      check(
        "card streams as an MP4",
        stream.status === 206 &&
          (stream.headers.get("content-type") ?? "").includes("video/mp4"),
        `${stream.status} ${stream.headers.get("content-type")}`,
      );
    }

    const cardUndo = await call(
      "POST",
      `/api/agent/turns/${card.body.conversation.turnId}/undo`,
    );
    check(
      "undo removes the card clip",
      videoClipsOf(cardUndo.body.project).length === 2,
      String(videoClipsOf(cardUndo.body.project).length),
    );
    check(
      "undo removes the generated source",
      cardUndo.body.project.assets.length === 1,
      String(cardUndo.body.project.assets.length),
    );

    const exported = await call("POST", "/api/agent/chat", {
      projectId,
      message: "Start an export",
    });
    const exportActions = exported.body.conversation.messages.at(-1)?.actions ?? [];
    check(
      "export action is recorded",
      exportActions.some((action) => action.tool === "start_export" && action.ok),
      JSON.stringify(exportActions),
    );

    const renders = await call("GET", `/api/projects/${projectId}/renders`);
    check("an agent export job exists", renders.body.jobs.length === 1);
    let job = renders.body.jobs[0];
    for (
      let attempt = 0;
      attempt < 120 && (job.status === "queued" || job.status === "running");
      attempt += 1
    ) {
      await sleep(500);
      job = (await call("GET", `/api/projects/${projectId}/renders`)).body.jobs[0];
    }
    check("the agent export renders", job?.status === "succeeded", job?.error ?? job?.status);

    const persisted = await call("GET", `/api/agent/projects/${projectId}`);
    check(
      "transcript is persisted",
      persisted.body.conversation.messages.length >= 12,
      String(persisted.body.conversation.messages.length),
    );
    check(
      "messages alternate roles",
      persisted.body.conversation.messages.every(
        (message, index, all) => index === 0 || message.role !== all[index - 1].role,
      ),
    );
    check("all project clips are still coherent", clipsOf(persisted.body.project).length >= 2);
  } finally {
    child.kill();
    await new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once("exit", resolve);
      setTimeout(resolve, 5000);
    });
    await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(
      (error) => console.error(`  WARN  could not remove ${dataDir}: ${error.message}`),
    );
  }

  console.log(
    failures === 0
      ? "\nAgent smoke passed."
      : `\n${failures} agent check(s) failed.`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
