#!/usr/bin/env node
/**
 * Wire-level provider smoke. Starts a local OpenAI-compatible stub and a private
 * CUTROOM API configured with AGENT_PROVIDER=opencode, then proves the real
 * `completeWithProvider` path: bearer auth, model, tool definitions, assistant
 * tool_calls, tool results, the final message, undo, and a persisted 502.
 * No external network, no real key, no data left behind.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const APP_PORT = Number(process.env.AGENT_WIRE_PORT ?? 4398);
const STUB_PORT = Number(process.env.AGENT_STUB_PORT ?? 4400);
const BASE = `http://127.0.0.1:${APP_PORT}`;
const STUB_BASE = `http://127.0.0.1:${STUB_PORT}`;
const PASSWORD = process.env.APP_PASSWORD ?? "cutroom-dev";
const KEY = "wire-test-key";
const MODEL = "wire-test-model";

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
  return (response.headers.getSetCookie?.() ?? [])
    .map((value) => value.split(";")[0])
    .join("; ");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const seen = [];

function startStub() {
  const server = http.createServer((request, response) => {
    if (request.method !== "POST" || !request.url?.endsWith("/chat/completions")) {
      response.writeHead(404);
      response.end();
      return;
    }
    let raw = "";
    request.on("data", (chunk) => {
      raw += String(chunk);
    });
    request.on("end", () => {
      const body = JSON.parse(raw);
      const lastUser = [...body.messages].reverse().find((message) => message.role === "user");
      const toolMessages = body.messages.filter((message) => message.role === "tool");
      seen.push({
        authorization: request.headers.authorization,
        model: body.model,
        tools: (body.tools ?? []).map((tool) => tool.function?.name),
        systemHasState:
          typeof body.messages[0]?.content === "string" &&
          body.messages[0].content.includes("Current project state:"),
        toolMessages: toolMessages.length,
        assistantHasToolCall: body.messages.some(
          (message) =>
            message.role === "assistant" &&
            Array.isArray(message.tool_calls) &&
            message.tool_calls.length > 0,
        ),
      });

      if (lastUser?.content?.toLowerCase().includes("fail")) {
        response.writeHead(502, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: "upstream exploded" } }));
        return;
      }

      const send = (message) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ choices: [{ message }] }));
      };

      if (toolMessages.length === 0) {
        send({
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call-project",
              type: "function",
              function: { name: "get_project", arguments: "{}" },
            },
          ],
        });
        return;
      }

      if (toolMessages.length === 1) {
        const state = JSON.parse(toolMessages[0].content).state;
        const clipId = state.clips[0].id;
        send({
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call-trim",
              type: "function",
              function: {
                name: "update_clip",
                arguments: JSON.stringify({ clipId, durationMs: 5000 }),
              },
            },
          ],
        });
        return;
      }

      send({ role: "assistant", content: "Trimmed the clip over the real wire path." });
    });
  });
  return new Promise((resolve) => {
    server.listen(STUB_PORT, "127.0.0.1", () => resolve(server));
  });
}

async function main() {
  const stub = await startStub();
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cutroom-wire-"));
  let stderr = "";
  const child = spawn(
    process.execPath,
    [path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"), "server/src/index.ts"],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(APP_PORT),
        HOST: "127.0.0.1",
        DATA_DIR: dataDir,
        APP_PASSWORD: PASSWORD,
        AGENT_PROVIDER: "opencode",
        OPENCODE_API_KEY: KEY,
        OPENCODE_BASE_URL: `${STUB_BASE}/v1`,
        OPENCODE_MODEL: MODEL,
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
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (child.exitCode !== null) {
        throw new Error(`Server exited early.\n${stderr}`);
      }
      try {
        const response = await fetch(`${BASE}/api/health`);
        if (response.ok) break;
      } catch {
        // not listening yet
      }
      if (attempt === 119) throw new Error(`Server did not start.\n${stderr}`);
      await sleep(250);
    }

    const loginResponse = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: PASSWORD }),
    });
    const login = await loginResponse.json();
    if (!loginResponse.ok) {
      throw new Error(`Login failed: ${JSON.stringify(login)}`);
    }
    const authHeaders = {
      cookie: cookieHeader(loginResponse),
      "x-csrf-token": login.csrfToken,
    };
    const call = async (method, pathname, body) => {
      const response = await fetch(`${BASE}${pathname}`, {
        method,
        headers:
          body === undefined
            ? authHeaders
            : { ...authHeaders, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    };

    const created = await call("POST", "/api/projects", {
      name: "Wire smoke",
      width: 640,
      height: 360,
      fps: 30,
    });
    const projectId = created.body.project.id;
    const bytes = await readFile(path.join(ROOT, "test-fixtures", "fixture-a.mp4"));
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: "video/mp4" }), "fixture-a.mp4");
    const upload = await fetch(`${BASE}/api/projects/${projectId}/assets`, {
      method: "POST",
      headers: authHeaders,
      body: form,
    });
    check("fixture uploads", upload.status === 201, String(upload.status));

    const state = await call("GET", `/api/agent/projects/${projectId}`);
    check("provider is opencode", state.body.conversation.provider.name === "opencode");
    check("configured key is reported", state.body.conversation.provider.configured === true);
    check("configured model is reported", state.body.conversation.provider.model === MODEL);

    const trim = await call("POST", "/api/agent/chat", {
      projectId,
      message: "Trim the first clip by one second",
    });
    check("wire chat returns 200", trim.status === 200, JSON.stringify(trim.body));
    const assistant = trim.body.conversation.messages.at(-1);
    check(
      "final assistant text comes from the provider",
      assistant?.content === "Trimmed the clip over the real wire path.",
      JSON.stringify(assistant),
    );
    check(
      "both tool rounds are reported",
      JSON.stringify(assistant?.actions?.map((action) => action.tool)) ===
        JSON.stringify(["get_project", "update_clip"]),
      JSON.stringify(assistant?.actions),
    );
    check(
      "clip is trimmed through the wire path",
      trim.body.project.tracks
        .flatMap((track) => track.clips)
        .some((clip) => clip.durationMs === 5000),
    );
    check("undo is offered", trim.body.conversation.canUndo === true);

    check("provider was called three times", seen.length === 3, String(seen.length));
    check(
      "every call carries the bearer key",
      seen.every((entry) => entry.authorization === `Bearer ${KEY}`),
    );
    check(
      "every call carries the model",
      seen.every((entry) => entry.model === MODEL),
    );
    check(
      "tool definitions reach the provider",
      seen.every(
        (entry) =>
          entry.tools.includes("update_clip") &&
          entry.tools.includes("create_motion_graphic") &&
          entry.tools.includes("get_project"),
      ),
    );
    check("system prompt carries the project state", seen.every((entry) => entry.systemHasState));
    check("second call carries one tool result", seen[1]?.toolMessages === 1);
    check("second call carries the assistant tool call", seen[1]?.assistantHasToolCall === true);
    check("third call carries two tool results", seen[2]?.toolMessages === 2);

    const undo = await call(
      "POST",
      `/api/agent/turns/${trim.body.conversation.turnId}/undo`,
    );
    check(
      "undo restores the duration",
      undo.body.project.tracks
        .flatMap((track) => track.clips)
        .every((clip) => clip.durationMs === 6000),
    );

    const failed = await call("POST", "/api/agent/chat", {
      projectId,
      message: "Please fail now",
    });
    check("provider failure still returns 200", failed.status === 200);
    const failedAssistant = failed.body.conversation.messages.at(-1);
    check(
      "provider failure is persisted, not invented",
      failedAssistant?.content.includes("model provider returned 502") &&
        failedAssistant?.content.includes("upstream exploded"),
      JSON.stringify(failedAssistant),
    );
    check("a failed turn has no actions", failedAssistant?.actions.length === 0);
    check("a failed turn offers no undo", failed.body.conversation.canUndo === false);
    check("the failure call reached the stub", seen.length === 4, String(seen.length));
    check(
      "the failure turn is in the transcript",
      failed.body.conversation.messages.length === 4,
      String(failed.body.conversation.messages.length),
    );

    const cleanup = await call("DELETE", `/api/projects/${projectId}`);
    check("project is deleted", cleanup.status === 200, String(cleanup.status));
  } finally {
    child.kill();
    stub.close();
    stub.closeAllConnections?.();
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
    failures === 0 ? "\nWire smoke passed." : `\n${failures} wire check(s) failed.`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
