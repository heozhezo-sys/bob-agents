# AI Agent Editor — Phase 1 implementation plan (chat edits the cut)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in user opens `/agent`, picks a project, types an edit, and the server applies it through the same validated clip operations the editor uses — with an honest action list, a persisted transcript, and a guarded one-turn undo.

**Architecture:** The agent is a server-side tool loop over OpenCode Zen's OpenAI-compatible chat completions endpoint (`AGENT_PROVIDER=mock` for deterministic tests). The clip mutations move out of `routes/clips.ts` into `services/clipEdits.ts` so HTTP and the agent share one validation path. Two SQLite tables hold messages and per-turn snapshots; undo restores a snapshot only when the project has not changed since. The client gets a chat page, a read-only clip strip and an Undo control; the manual editor is untouched.

**Tech Stack:** Node 24 (`process.loadEnvFile`, `node:sqlite`, fetch), Express 5, zod 4, React 19 + Vite, TypeScript 7, FFmpeg via existing services, Playwright (walkthrough only).

## Global Constraints

- Run every command from `pro/`. API on `http://127.0.0.1:4320`, client on `http://127.0.0.1:5180`, owner passphrase `cutroom-dev`.
- **No new runtime dependencies.** Everything uses packages already in `pro/package.json`.
- **No surface may claim the agent did something it did not do.** The mock provider is labelled "Mock agent"; provider failures become an assistant message, never a success chip.
- `.env` is already gitignored. Never commit a key, a database file, or `test-results/`.
- No `as`, `any`, or `@ts-ignore` to silence the type checker. (Casts at `JSON.parse` persistence boundaries and the existing serializers are allowed.) `npm run typecheck` must stay clean.
- Every task ends with a commit. Never commit `pro/data/`.

## File structure

| File | Action | Responsibility |
|---|---|---|
| `server/src/config.ts` | modify | Load `pro/.env`, expose `agentProvider`. |
| `server/src/db/migrations.ts` | modify | `002_agent`: messages + turns. |
| `shared/src/index.ts` | modify | Agent types, chat schema, `AgentChatResult`. |
| `server/src/services/clipEdits.ts` | create | Ownership, validation, clip create/update/split/delete, detail, snapshot. |
| `server/src/routes/clips.ts` | modify | Thin HTTP wrappers over `clipEdits`. |
| `server/src/services/agent/state.ts` | create | Compact project state for the prompt and the mock. |
| `server/src/services/agent/prompt.ts` | create | System prompt + state injection. |
| `server/src/services/agent/provider.ts` | create | OpenCode Zen chat-completions client and wire types. |
| `server/src/services/agent/mock.ts` | create | Deterministic provider for tests and demos. |
| `server/src/services/agent/tools.ts` | create | Tool schemas + executor. |
| `server/src/services/agent/conversation.ts` | create | Persist/read messages, compute `canUndo`, provider info. |
| `server/src/services/agent/run.ts` | create | The bounded tool loop, snapshot, failure handling. |
| `server/src/services/agent/undo.ts` | create | Guarded snapshot restore + generated-asset cleanup. |
| `server/src/routes/agent.ts` | create | `GET /api/agent/projects/:id`, `POST /chat`, `POST /turns/:id/undo`. |
| `server/src/app.ts` | modify | Mount the agent router. |
| `server/src/index.ts` | modify | Stop claiming a rule-based agent when none exists. |
| `scripts/agent-smoke.mjs` | create | Self-contained mock-server proof of every tool, undo and persistence. |
| `package.json` | modify | `agent:smoke` script. |
| `client/src/api.ts` | modify | Three agent calls. |
| `client/src/pages/AgentPage.tsx` | create | Chat page: picker, transcript, composer, undo, provider state. |
| `client/src/components/agent/ClipStrip.tsx` | create | Read-only timeline overview. |
| `client/src/App.tsx` | modify | `/agent` → `AgentPage`; drop the placeholder import. |
| `client/src/components/AppShell.tsx` | modify | Remove the AI Agent "soon" dot. |
| `client/src/styles.css` | modify | Agent page styles using existing tokens. |
| `client/src/pages/DashboardPage.tsx` | modify | Milestone copy tells the truth. |

---

### Task 1: Foundations — env, types, schema

**Files:**
- Modify: `server/src/config.ts:1-36`
- Modify: `server/src/index.ts:16-20`
- Modify: `shared/src/index.ts` (types after `ProjectDetail`, schema next to the other schemas)
- Modify: `server/src/db/migrations.ts:174`

**Interfaces:**
- Produces: `config.agentProvider: "opencode" | "mock"`; `AgentAction`, `AgentMessage`, `AgentProviderInfo`, `AgentConversation`, `AgentChatResult`, `agentChatSchema`, `AgentChatInput`; tables `agent_messages` and `agent_turns`.
- Consumes: nothing.

- [ ] **Step 1: Load `pro/.env` and read the provider mode**

In `server/src/config.ts`, immediately after `PROJECT_ROOT`:

```ts
const envFile = path.join(PROJECT_ROOT, ".env");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
```

Add to the `config` object after `openCodeModel`:

```ts
  agentProvider: process.env.AGENT_PROVIDER === "mock" ? "mock" : "opencode",
```

- [ ] **Step 2: Stop the boot log from inventing an agent**

In `server/src/index.ts`, replace the provider log line body:

```ts
      `[cutroom] model provider: ${config.openCodeApiKey ? "configured" : "not configured (agent chat returns 503)"}`,
```

- [ ] **Step 3: Add shared agent types**

In `shared/src/index.ts`, after `ProjectDetail`:

```ts
export interface AgentAction {
  tool: string;
  ok: boolean;
  summary: string;
  thumbnailUrl?: string | null;
}

export interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  actions: AgentAction[];
  turnId: string | null;
  createdAt: string;
}

export interface AgentProviderInfo {
  name: "opencode" | "mock";
  model: string;
  configured: boolean;
}

export interface AgentConversation {
  messages: AgentMessage[];
  canUndo: boolean;
  undoBlockedReason: string | null;
  turnId: string | null;
  provider: AgentProviderInfo;
}

export interface AgentChatResult {
  project: ProjectDetail;
  conversation: AgentConversation;
}
```

Next to `createClipSchema`:

```ts
export const agentChatSchema = z.object({
  projectId: z.string().uuid(),
  message: z.string().trim().min(1).max(4000),
});

export type AgentChatInput = z.infer<typeof agentChatSchema>;
```

- [ ] **Step 4: Add the migration**

Append a second object to `migrations` in `server/src/db/migrations.ts`:

```ts
  {
    id: "002_agent",
    sql: `
      CREATE TABLE IF NOT EXISTS agent_messages (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        actions_json TEXT NOT NULL DEFAULT '[]',
        turn_id TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_agent_messages_project
        ON agent_messages(project_id, created_at);

      CREATE TABLE IF NOT EXISTS agent_turns (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        created_asset_ids_json TEXT NOT NULL DEFAULT '[]',
        project_updated_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        undone_at TEXT,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_agent_turns_project
        ON agent_turns(project_id, created_at DESC);
    `,
  },
```

- [ ] **Step 5: Verify**

Run:

```bash
npm run typecheck
npm run db:migrate
node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('data/app.db');console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'agent_%' ORDER BY name\").all())"
```

Expected: typecheck exits 0; migration reports success; the query prints `[ { name: 'agent_messages' }, { name: 'agent_turns' } ]`.

- [ ] **Step 6: Commit**

```bash
git add server/src/config.ts server/src/index.ts shared/src/index.ts server/src/db/migrations.ts
git commit -m "feat: add agent config, types and storage"
```

---

### Task 2: Move clip edits into a shared service

**Files:**
- Create: `server/src/services/clipEdits.ts`
- Modify: `server/src/routes/clips.ts` (replace the whole file)
- Test: existing `scripts/smoke.mjs` + `scripts/ui-smoke.mjs`

**Interfaces:**
- Produces:
  - `ownedProject(userId: string, projectId: string): ProjectRow`
  - `projectDetail(userId: string, projectId: string): ProjectDetail`
  - `updateClip(userId: string, projectId: string, clipId: string, rawInput: unknown): ProjectDetail`
  - `splitClip(userId: string, projectId: string, clipId: string, rawInput: unknown): ProjectDetail`
  - `deleteClip(userId: string, projectId: string, clipId: string): ProjectDetail`
  - `createClip(userId: string, projectId: string, rawInput: unknown): ProjectDetail`
  - `snapshotProject(projectId: string): ProjectSnapshot`
  - `interface ProjectSnapshot { name: string; clips: ClipRow[] }`
- Consumes: `lib/validate.parse`, `db` helpers, `serializers`, shared schemas.

- [ ] **Step 1: Capture the current response shapes**

The routes return `{ project }` with status 200 for update/delete, 201 for split/create. The service returns `ProjectDetail`; the wrappers wrap it. This must not change any existing route behaviour.

- [ ] **Step 2: Create `server/src/services/clipEdits.ts`**

```ts
import crypto from "node:crypto";
import {
  CLIP_MIN_DURATION_MS,
  createClipSchema,
  splitClipSchema,
  updateClipSchema,
  type ProjectDetail,
} from "@ai-video-agent-studio/shared";
import { audit, all, getDb, mutate, nowIso, one } from "../db/index.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { parse } from "../lib/validate.js";
import type { MediaRow } from "./mediaService.js";
import {
  serializeProjectDetail,
  type ClipRow,
  type ProjectRow,
} from "./serializers.js";

export interface JoinedClipRow extends ClipRow {
  project_id: string;
  track_kind: string;
  track_locked: number;
  asset_kind: string | null;
  asset_duration_ms: number | null;
}

export interface ProjectSnapshot {
  name: string;
  clips: ClipRow[];
}

const TRACK_ACCEPTS: Record<string, string[]> = {
  video: ["video", "overlay"],
  image: ["video", "overlay"],
  audio: ["audio"],
  text: ["text"],
  subtitle: ["subtitle"],
};

export function ownedProject(userId: string, projectId: string): ProjectRow {
  const row = one<ProjectRow>(
    "SELECT * FROM projects WHERE id = ? AND owner_id = ?",
    projectId,
    userId,
  );
  if (!row) throw notFound("Project not found");
  return row;
}

export function projectDetail(userId: string, projectId: string): ProjectDetail {
  return serializeProjectDetail(ownedProject(userId, projectId));
}

function loadClip(projectId: string, clipId: string): JoinedClipRow {
  const row = one<JoinedClipRow>(
    `SELECT c.*, t.project_id AS project_id, t.kind AS track_kind, t.locked AS track_locked,
            a.kind AS asset_kind, a.duration_ms AS asset_duration_ms
       FROM clips c
       JOIN tracks t ON t.id = c.track_id
       LEFT JOIN media_assets a ON a.id = c.asset_id
      WHERE c.id = ? AND t.project_id = ?`,
    clipId,
    projectId,
  );
  if (!row) throw notFound("Clip not found");
  return row;
}

function assertEditable(clip: JoinedClipRow): void {
  if (clip.track_locked === 1) {
    throw conflict("This track is locked. Unlock it before editing.");
  }
}

function assertCompatible(kind: string, trackKind: string): void {
  const accepted = TRACK_ACCEPTS[kind] ?? [];
  if (!accepted.includes(trackKind)) {
    throw badRequest(`A ${kind} clip cannot live on a ${trackKind} track`);
  }
}

function mediaDurationLimit(clip: JoinedClipRow): number | null {
  if (!clip.asset_id || clip.asset_kind === "image") return null;
  return clip.asset_duration_ms;
}

function assertSourceBounds(
  clip: JoinedClipRow,
  inMs: number,
  durationMs: number,
): void {
  if (durationMs < CLIP_MIN_DURATION_MS) {
    throw badRequest(`A clip must be at least ${CLIP_MIN_DURATION_MS} ms long`);
  }
  const limit = mediaDurationLimit(clip);
  if (limit === null) return;
  if (inMs < 0) throw badRequest("The source in point cannot be negative");
  if (inMs >= limit && limit > 0) {
    throw badRequest("The source in point is past the end of the file");
  }
  if (inMs + durationMs > limit + 2) {
    throw badRequest("The clip extends past the end of the source", {
      maxDurationMs: Math.max(0, limit - inMs),
      assetDurationMs: limit,
    });
  }
}

function assertNoOverlap(
  trackId: string,
  clipId: string | null,
  startMs: number,
  durationMs: number,
): void {
  const endMs = startMs + durationMs;
  const row = one<{ id: string }>(
    `SELECT id FROM clips
      WHERE track_id = ? AND id <> ? AND start_ms < ? AND start_ms + duration_ms > ?
      LIMIT 1`,
    trackId,
    clipId ?? "",
    endMs,
    startMs,
  );
  if (row) throw conflict("That range overlaps another clip on this track");
}

function targetTrack(
  projectId: string,
  trackId: string,
): { id: string; kind: string; locked: number } {
  const row = one<{ id: string; kind: string; locked: number }>(
    "SELECT id, kind, locked FROM tracks WHERE id = ? AND project_id = ?",
    trackId,
    projectId,
  );
  if (!row) throw notFound("Track not found");
  return row;
}

export function updateClip(
  userId: string,
  projectId: string,
  clipId: string,
  rawInput: unknown,
): ProjectDetail {
  const project = ownedProject(userId, projectId);
  const clip = loadClip(project.id, clipId);
  assertEditable(clip);
  const input = parse(updateClipSchema, rawInput);

  const trackId = input.trackId ?? clip.track_id;
  const track = targetTrack(project.id, trackId);
  if (track.locked === 1) throw conflict("This track is locked. Unlock it before editing.");
  assertCompatible(clip.kind, track.kind);

  const startMs = input.startMs ?? clip.start_ms;
  const durationMs = input.durationMs ?? clip.duration_ms;
  const inMs = input.inMs ?? clip.in_ms;
  assertSourceBounds(clip, inMs, durationMs);
  assertNoOverlap(track.id, clip.id, startMs, durationMs);

  const outMs = clip.asset_id ? inMs + durationMs : null;
  mutate(
    `UPDATE clips
        SET track_id = ?, start_ms = ?, duration_ms = ?, in_ms = ?, out_ms = ?
      WHERE id = ?`,
    track.id,
    startMs,
    durationMs,
    inMs,
    outMs,
    clip.id,
  );
  mutate("UPDATE projects SET updated_at = ? WHERE id = ?", nowIso(), project.id);
  audit(userId, "clip.update", "clip", clip.id, {
    before: {
      trackId: clip.track_id,
      startMs: clip.start_ms,
      durationMs: clip.duration_ms,
      inMs: clip.in_ms,
    },
    after: { trackId: track.id, startMs, durationMs, inMs },
  });
  return projectDetail(userId, project.id);
}

export function splitClip(
  userId: string,
  projectId: string,
  clipId: string,
  rawInput: unknown,
): ProjectDetail {
  const project = ownedProject(userId, projectId);
  const clip = loadClip(project.id, clipId);
  assertEditable(clip);
  const input = parse(splitClipSchema, rawInput);

  const offset = input.atMs - clip.start_ms;
  if (offset < CLIP_MIN_DURATION_MS || clip.duration_ms - offset < CLIP_MIN_DURATION_MS) {
    throw badRequest(
      `The playhead must be at least ${CLIP_MIN_DURATION_MS} ms inside the clip to split it`,
    );
  }

  const leftDuration = offset;
  const rightDuration = clip.duration_ms - offset;
  const isMedia = Boolean(clip.asset_id);
  const rightIn = isMedia ? clip.in_ms + offset : 0;
  const leftOut = isMedia ? clip.in_ms + leftDuration : null;
  const newClipId = crypto.randomUUID();

  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    mutate(
      "UPDATE clips SET duration_ms = ?, out_ms = ? WHERE id = ?",
      leftDuration,
      leftOut,
      clip.id,
    );
    mutate(
      `INSERT INTO clips
        (id, track_id, asset_id, kind, start_ms, duration_ms, in_ms, out_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      newClipId,
      clip.track_id,
      clip.asset_id,
      clip.kind,
      input.atMs,
      rightDuration,
      rightIn,
      nowIso(),
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  mutate("UPDATE projects SET updated_at = ? WHERE id = ?", nowIso(), project.id);
  audit(userId, "clip.split", "clip", clip.id, { atMs: input.atMs, newClipId });
  return projectDetail(userId, project.id);
}

export function deleteClip(
  userId: string,
  projectId: string,
  clipId: string,
): ProjectDetail {
  const project = ownedProject(userId, projectId);
  const clip = loadClip(project.id, clipId);
  assertEditable(clip);
  mutate("DELETE FROM clips WHERE id = ?", clip.id);
  mutate("UPDATE projects SET updated_at = ? WHERE id = ?", nowIso(), project.id);
  audit(userId, "clip.delete", "clip", clip.id, {
    startMs: clip.start_ms,
    durationMs: clip.duration_ms,
    assetId: clip.asset_id,
  });
  return projectDetail(userId, project.id);
}

export function createClip(
  userId: string,
  projectId: string,
  rawInput: unknown,
): ProjectDetail {
  const project = ownedProject(userId, projectId);
  const input = parse(createClipSchema, rawInput);
  const asset = one<MediaRow>(
    "SELECT * FROM media_assets WHERE id = ? AND project_id = ?",
    input.assetId,
    project.id,
  );
  if (!asset) throw notFound("Source not found");
  if (asset.kind === "subtitle") {
    throw badRequest("Subtitle files are imported as a transcript, not a timeline clip");
  }

  const desiredTrackKind = asset.kind === "audio" ? "audio" : "video";
  const track = input.trackId
    ? targetTrack(project.id, input.trackId)
    : one<{ id: string; kind: string; locked: number }>(
        "SELECT id, kind, locked FROM tracks WHERE project_id = ? AND kind = ? ORDER BY position ASC LIMIT 1",
        project.id,
        desiredTrackKind,
      );
  if (!track) throw badRequest("No compatible track exists in this project");
  if (track.locked === 1) throw conflict("This track is locked. Unlock it before editing.");
  assertCompatible(asset.kind, track.kind);

  const durationMs = asset.kind === "image" ? 5000 : (asset.duration_ms ?? 0);
  if (durationMs < CLIP_MIN_DURATION_MS) {
    throw badRequest("The source has no usable duration");
  }
  const startMs =
    input.startMs ??
    (one<{ end: number }>(
      "SELECT COALESCE(MAX(start_ms + duration_ms), 0) AS end FROM clips WHERE track_id = ?",
      track.id,
    )?.end ??
      0);

  assertNoOverlap(track.id, null, startMs, durationMs);

  const clipId = crypto.randomUUID();
  mutate(
    `INSERT INTO clips
      (id, track_id, asset_id, kind, start_ms, duration_ms, in_ms, out_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?)`,
    clipId,
    track.id,
    asset.id,
    asset.kind,
    startMs,
    durationMs,
    nowIso(),
  );
  mutate("UPDATE projects SET updated_at = ? WHERE id = ?", nowIso(), project.id);
  audit(userId, "clip.create", "clip", clipId, {
    assetId: asset.id,
    trackId: track.id,
    startMs,
    durationMs,
  });
  return projectDetail(userId, project.id);
}

export function snapshotProject(projectId: string): ProjectSnapshot {
  const project = one<ProjectRow>("SELECT * FROM projects WHERE id = ?", projectId);
  if (!project) throw notFound("Project not found");
  const clips = all<ClipRow>(
    `SELECT c.* FROM clips c
       JOIN tracks t ON t.id = c.track_id
      WHERE t.project_id = ?
      ORDER BY c.created_at ASC`,
    projectId,
  );
  return { name: project.name, clips };
}
```

- [ ] **Step 3: Replace `server/src/routes/clips.ts` with wrappers**

```ts
import { Router } from "express";
import { requireAuth, requireCsrf } from "../lib/auth.js";
import { param } from "../lib/http.js";
import {
  createClip,
  deleteClip,
  splitClip,
  updateClip,
} from "../services/clipEdits.js";

export const clipsRouter = Router();

clipsRouter.patch("/:id/clips/:clipId", requireAuth, requireCsrf, (req, res) => {
  res.json({
    project: updateClip(
      req.auth!.user.id,
      param(req, "id"),
      param(req, "clipId"),
      req.body,
    ),
  });
});

clipsRouter.post("/:id/clips/:clipId/split", requireAuth, requireCsrf, (req, res) => {
  res.status(201).json({
    project: splitClip(
      req.auth!.user.id,
      param(req, "id"),
      param(req, "clipId"),
      req.body,
    ),
  });
});

clipsRouter.delete("/:id/clips/:clipId", requireAuth, requireCsrf, (req, res) => {
  res.json({
    project: deleteClip(req.auth!.user.id, param(req, "id"), param(req, "clipId")),
  });
});

clipsRouter.post("/:id/clips", requireAuth, requireCsrf, (req, res) => {
  res.status(201).json({
    project: createClip(req.auth!.user.id, param(req, "id"), req.body),
  });
});
```

- [ ] **Step 4: Verify the refactor changed no behaviour**

The dev server (tsx watch) restarts on save. Run:

```bash
npm run typecheck
node scripts/smoke.mjs
```

Expected: typecheck 0; the smoke suite ends with its usual pass count and no failures (project detail loads, clips persist, timeline duration 15000, range request 206, etc.).

Also run `node scripts/ui-smoke.mjs` to prove drag/split/delete still work in the browser. Expected: all checks pass (the suite creates and deletes its own project).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/clipEdits.ts server/src/routes/clips.ts
git commit -m "refactor: share clip edit operations with the agent"
```

---

### Task 3: Agent backend and the mock smoke proof

**Files:**
- Create: `server/src/services/agent/state.ts`
- Create: `server/src/services/agent/prompt.ts`
- Create: `server/src/services/agent/provider.ts`
- Create: `server/src/services/agent/mock.ts`
- Create: `server/src/services/agent/tools.ts`
- Create: `server/src/services/agent/conversation.ts`
- Create: `server/src/services/agent/run.ts`
- Create: `server/src/services/agent/undo.ts`
- Create: `server/src/routes/agent.ts`
- Create: `scripts/agent-smoke.mjs`
- Modify: `server/src/app.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `clipEdits.*`, `createRenderJob`, shared agent types.
- Produces: the three routes and `npm run agent:smoke`.

- [ ] **Step 1: Create `server/src/services/agent/state.ts`**

```ts
import { all, one } from "../../db/index.js";
import { notFound } from "../../lib/errors.js";
import type { ProjectRow, TrackRow } from "../serializers.js";

export interface AgentProjectState {
  project: {
    id: string;
    name: string;
    width: number;
    height: number;
    fps: number;
    durationMs: number;
  };
  tracks: { id: string; kind: string; name: string; locked: boolean }[];
  clips: {
    id: string;
    trackId: string;
    kind: string;
    assetId: string | null;
    assetName: string | null;
    startMs: number;
    durationMs: number;
    inMs: number;
  }[];
  assets: {
    id: string;
    name: string;
    kind: string;
    durationMs: number | null;
  }[];
}

export function buildAgentState(projectId: string): AgentProjectState {
  const project = one<ProjectRow>(
    "SELECT * FROM projects WHERE id = ?",
    projectId,
  );
  if (!project) throw notFound("Project not found");

  const tracks = all<TrackRow>(
    "SELECT * FROM tracks WHERE project_id = ? ORDER BY position ASC",
    projectId,
  );
  const clips = all<{
    id: string;
    track_id: string;
    kind: string;
    asset_id: string | null;
    start_ms: number;
    duration_ms: number;
    in_ms: number;
    asset_name: string | null;
  }>(
    `SELECT c.id, c.track_id, c.kind, c.asset_id, c.start_ms, c.duration_ms, c.in_ms,
            a.original_name AS asset_name
       FROM clips c
       JOIN tracks t ON t.id = c.track_id
       LEFT JOIN media_assets a ON a.id = c.asset_id
      WHERE t.project_id = ?
      ORDER BY t.position ASC, c.start_ms ASC`,
    projectId,
  );
  const assets = all<{
    id: string;
    original_name: string;
    kind: string;
    duration_ms: number | null;
  }>(
    "SELECT id, original_name, kind, duration_ms FROM media_assets WHERE project_id = ? ORDER BY created_at ASC",
    projectId,
  );

  return {
    project: {
      id: project.id,
      name: project.name,
      width: project.width,
      height: project.height,
      fps: project.fps,
      durationMs: clips.reduce(
        (max, clip) => Math.max(max, clip.start_ms + clip.duration_ms),
        0,
      ),
    },
    tracks: tracks.map((track) => ({
      id: track.id,
      kind: track.kind,
      name: track.name,
      locked: track.locked === 1,
    })),
    clips: clips.map((clip) => ({
      id: clip.id,
      trackId: clip.track_id,
      kind: clip.kind,
      assetId: clip.asset_id,
      assetName: clip.asset_name,
      startMs: clip.start_ms,
      durationMs: clip.duration_ms,
      inMs: clip.in_ms,
    })),
    assets: assets.map((asset) => ({
      id: asset.id,
      name: asset.original_name,
      kind: asset.kind,
      durationMs: asset.duration_ms,
    })),
  };
}
```

- [ ] **Step 2: Create `server/src/services/agent/prompt.ts`**

```ts
import type { AgentProjectState } from "./state.js";

export function buildSystemPrompt(state: AgentProjectState): string {
  return [
    "You are CUTROOM's editing agent. You edit exactly one project's timeline by calling tools.",
    "Rules:",
    "- Use only the tools provided. Never invent ids; copy clip, asset, track and project ids from the state.",
    "- All times are integer milliseconds on the project timeline. startMs is when a clip begins, durationMs is its visible length, inMs is the source offset.",
    "- Make the smallest edit that satisfies the request. Do not add clips or cards unless asked.",
    "- If the request is ambiguous or a tool fails, say so plainly. Never claim success unless a tool returned ok.",
    "- Reply in one or two short sentences. No tables, JSON or code blocks.",
    "Current project state:",
    JSON.stringify(state),
  ].join("\n");
}
```

- [ ] **Step 3: Create `server/src/services/agent/provider.ts`**

```ts
import crypto from "node:crypto";
import { config } from "../../config.js";
import { AppError } from "../../lib/errors.js";
import type { AgentProjectState } from "./state.js";

export interface WireToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: WireToolCall[];
  tool_call_id?: string;
}

export interface AgentToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface AgentToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ProviderReply {
  content: string;
  toolCalls: AgentToolCall[];
}

export interface ProviderInput {
  messages: ChatMessage[];
  tools: AgentToolDef[];
  state: AgentProjectState;
}

interface WireResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
}

export async function completeWithProvider(
  input: ProviderInput,
): Promise<ProviderReply> {
  if (!config.openCodeApiKey) {
    throw new AppError(
      503,
      "provider_not_configured",
      "The agent has no model key. Add OPENCODE_API_KEY to pro/.env, or run the server with AGENT_PROVIDER=mock.",
    );
  }

  const baseUrl = config.openCodeBaseUrl.replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.openCodeApiKey}`,
    },
    body: JSON.stringify({
      model: config.openCodeModel,
      messages: input.messages,
      tools: input.tools,
      tool_choice: "auto",
    }),
    signal: AbortSignal.timeout(90_000),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 400);
    throw new AppError(
      502,
      "provider_error",
      `The model provider returned ${response.status}. ${detail}`,
    );
  }

  const data = (await response.json()) as WireResponse;
  const message = data.choices?.[0]?.message;
  if (!message) {
    throw new AppError(
      502,
      "provider_error",
      "The model provider returned no message.",
    );
  }

  return {
    content: typeof message.content === "string" ? message.content : "",
    toolCalls: (message.tool_calls ?? []).flatMap((call) => {
      const name = call.function?.name;
      if (!name) return [];
      return [
        {
          id: call.id ?? crypto.randomUUID(),
          name,
          arguments: call.function?.arguments ?? "{}",
        },
      ];
    }),
  };
}
```

- [ ] **Step 4: Create `server/src/services/agent/mock.ts`**

```ts
import crypto from "node:crypto";
import type { ProviderInput, ProviderReply } from "./provider.js";

const CAPABILITIES =
  "I can trim, split, move or delete clips, add a source, rename the project, or start an export.";

export function mockProvider(input: ProviderInput): ProviderReply {
  const last = input.messages[input.messages.length - 1];
  if (last?.role === "tool") {
    return { content: "Done. The timeline is updated.", toolCalls: [] };
  }

  const text =
    [...input.messages]
      .reverse()
      .find((message) => message.role === "user")
      ?.content.toLowerCase() ?? "";
  const { state } = input;
  const videoClips = state.clips.filter((clip) => clip.kind === "video");
  const clip = videoClips[0] ?? state.clips[0];
  const lastVideoClip = videoClips[videoClips.length - 1];

  const call = (name: string, args: unknown): ProviderReply => ({
    content: "",
    toolCalls: [
      {
        id: `mock-${crypto.randomUUID()}`,
        name,
        arguments: JSON.stringify(args),
      },
    ],
  });

  if (text.includes("trim")) {
    if (!clip) return { content: "This project has no clips to trim yet.", toolCalls: [] };
    return call("update_clip", {
      clipId: clip.id,
      durationMs: Math.max(100, clip.durationMs - 1000),
    });
  }
  if (text.includes("split")) {
    if (!clip) return { content: "This project has no clips to split yet.", toolCalls: [] };
    return call("split_clip", {
      clipId: clip.id,
      atMs: clip.startMs + Math.floor(clip.durationMs / 2),
    });
  }
  if (text.includes("delete")) {
    if (!lastVideoClip) {
      return { content: "This project has no video clip to delete.", toolCalls: [] };
    }
    return call("delete_clip", { clipId: lastVideoClip.id });
  }
  if (text.includes("add")) {
    const asset = state.assets.find((item) => item.kind === "video") ?? state.assets[0];
    if (!asset) return { content: "This project has no source to add.", toolCalls: [] };
    return call("add_clip", { assetId: asset.id });
  }
  if (text.includes("rename")) {
    return call("rename_project", { name: "Agent cut" });
  }
  if (text.includes("export")) {
    return call("start_export", {});
  }

  return { content: CAPABILITIES, toolCalls: [] };
}
```

- [ ] **Step 5: Create `server/src/services/agent/tools.ts`**

```ts
import { z } from "zod";
import {
  createClipSchema,
  updateProjectSchema,
} from "@ai-video-agent-studio/shared";
import { audit, mutate, nowIso } from "../../db/index.js";
import { AppError, badRequest } from "../../lib/errors.js";
import { parse } from "../../lib/validate.js";
import {
  createClip,
  deleteClip,
  splitClip,
  updateClip,
} from "../clipEdits.js";
import { createRenderJob } from "../renderService.js";
import { buildAgentState, type AgentProjectState } from "./state.js";
import type { AgentToolDef } from "./provider.js";

export interface ToolContext {
  userId: string;
  projectId: string;
  createdAssetIds: string[];
}

export interface ToolOutcome {
  ok: boolean;
  summary: string;
  state: AgentProjectState;
  thumbnailUrl?: string | null;
}

export const MUTATING_TOOLS = new Set([
  "update_clip",
  "split_clip",
  "delete_clip",
  "add_clip",
  "rename_project",
]);

export const TOOL_DEFS: AgentToolDef[] = [
  {
    type: "function",
    function: {
      name: "get_project",
      description: "Read the current project state: tracks, clips, assets and duration.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "update_clip",
      description:
        "Move or trim an existing clip. Times are integer milliseconds on the project timeline. durationMs is the visible length; inMs is the source offset.",
      parameters: {
        type: "object",
        properties: {
          clipId: { type: "string", description: "Clip id from the project state." },
          startMs: { type: "integer", minimum: 0 },
          durationMs: { type: "integer", minimum: 100 },
          inMs: { type: "integer", minimum: 0 },
        },
        required: ["clipId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "split_clip",
      description:
        "Split a clip at an absolute timeline position in milliseconds, leaving two clips.",
      parameters: {
        type: "object",
        properties: {
          clipId: { type: "string" },
          atMs: { type: "integer", minimum: 0 },
        },
        required: ["clipId", "atMs"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_clip",
      description: "Delete one clip from the timeline. The source file is kept.",
      parameters: {
        type: "object",
        properties: { clipId: { type: "string" } },
        required: ["clipId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_clip",
      description:
        "Add a stored source to the timeline. Without startMs it appends after the last clip on a compatible track.",
      parameters: {
        type: "object",
        properties: {
          assetId: { type: "string", description: "Asset id from the project state." },
          startMs: { type: "integer", minimum: 0 },
        },
        required: ["assetId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "rename_project",
      description: "Rename the project. The name is 1–120 characters.",
      parameters: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "start_export",
      description: "Queue a render of the current timeline through the real FFmpeg queue.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
];

function failure(message: string, projectId: string): ToolOutcome {
  return { ok: false, summary: message, state: buildAgentState(projectId) };
}

function describeAppError(error: AppError): string {
  const details = error.details ? ` ${JSON.stringify(error.details)}` : "";
  return `${error.message}${details}`.slice(0, 600);
}

export async function runAgentTool(
  name: string,
  rawArguments: string,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  let args: unknown;
  try {
    args = rawArguments.trim() ? JSON.parse(rawArguments) : {};
  } catch {
    return failure("The tool arguments were not valid JSON.", ctx.projectId);
  }

  try {
    switch (name) {
      case "get_project": {
        return {
          ok: true,
          summary: "Read the project state.",
          state: buildAgentState(ctx.projectId),
        };
      }
      case "update_clip": {
        const input = parse(
          z.object({
            clipId: z.string().uuid(),
            startMs: z.number().int().min(0).optional(),
            durationMs: z.number().int().min(100).optional(),
            inMs: z.number().int().min(0).optional(),
          }),
          args,
        );
        const patch: { startMs?: number; durationMs?: number; inMs?: number } = {};
        if (input.startMs !== undefined) patch.startMs = input.startMs;
        if (input.durationMs !== undefined) patch.durationMs = input.durationMs;
        if (input.inMs !== undefined) patch.inMs = input.inMs;

        const before = buildAgentState(ctx.projectId).clips.find(
          (clip) => clip.id === input.clipId,
        );
        updateClip(ctx.userId, ctx.projectId, input.clipId, patch);
        const state = buildAgentState(ctx.projectId);
        const after = state.clips.find((clip) => clip.id === input.clipId);
        const label = before?.assetName ?? "clip";
        return {
          ok: true,
          summary: `Updated "${label}" — start ${after?.startMs ?? 0} ms, length ${after?.durationMs ?? 0} ms.`,
          state,
        };
      }
      case "split_clip": {
        const input = parse(
          z.object({
            clipId: z.string().uuid(),
            atMs: z.number().int().min(0).max(6 * 60 * 60 * 1000),
          }),
          args,
        );
        splitClip(ctx.userId, ctx.projectId, input.clipId, { atMs: input.atMs });
        return {
          ok: true,
          summary: `Split the clip at ${input.atMs} ms.`,
          state: buildAgentState(ctx.projectId),
        };
      }
      case "delete_clip": {
        const input = parse(z.object({ clipId: z.string().uuid() }), args);
        const before = buildAgentState(ctx.projectId).clips.find(
          (clip) => clip.id === input.clipId,
        );
        deleteClip(ctx.userId, ctx.projectId, input.clipId);
        return {
          ok: true,
          summary: `Deleted "${before?.assetName ?? "clip"}". The source is kept.`,
          state: buildAgentState(ctx.projectId),
        };
      }
      case "add_clip": {
        const input = parse(createClipSchema, args);
        createClip(ctx.userId, ctx.projectId, input);
        const state = buildAgentState(ctx.projectId);
        const asset = state.assets.find((item) => item.id === input.assetId);
        return {
          ok: true,
          summary: `Added "${asset?.name ?? "source"}" to the timeline.`,
          state,
        };
      }
      case "rename_project": {
        const input = parse(updateProjectSchema, args);
        if (!input.name) throw badRequest("A project name is required.");
        mutate(
          "UPDATE projects SET name = ?, updated_at = ? WHERE id = ?",
          input.name,
          nowIso(),
          ctx.projectId,
        );
        audit(ctx.userId, "project.rename", "project", ctx.projectId, {
          name: input.name,
        });
        return {
          ok: true,
          summary: `Renamed the project to "${input.name}".`,
          state: buildAgentState(ctx.projectId),
        };
      }
      case "start_export": {
        const { job } = createRenderJob(ctx.projectId, ctx.userId);
        return {
          ok: true,
          summary: `Queued export ${job.id.slice(0, 8)}.`,
          state: buildAgentState(ctx.projectId),
        };
      }
      default:
        throw badRequest(`Unknown tool "${name}"`);
    }
  } catch (error) {
    if (error instanceof AppError) return failure(describeAppError(error), ctx.projectId);
    throw error;
  }
}
```

- [ ] **Step 6: Create `server/src/services/agent/conversation.ts`**

```ts
import {
  type AgentAction,
  type AgentConversation,
  type AgentMessage,
} from "@ai-video-agent-studio/shared";
import { config } from "../../config.js";
import { all, one } from "../../db/index.js";
import type { ProjectRow } from "../serializers.js";

export interface AgentMessageRow {
  id: string;
  project_id: string;
  role: "user" | "assistant";
  content: string;
  actions_json: string;
  turn_id: string | null;
  created_at: string;
}

interface AgentTurnRow {
  id: string;
  project_id: string;
  snapshot_json: string;
  created_asset_ids_json: string;
  project_updated_at: string;
  created_at: string;
  undone_at: string | null;
}

function parseActions(value: string): AgentAction[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as AgentAction[]) : [];
  } catch {
    return [];
  }
}

export function loadConversation(projectId: string): AgentConversation {
  const rows = all<AgentMessageRow>(
    `SELECT * FROM agent_messages
      WHERE project_id = ?
      ORDER BY created_at DESC, rowid DESC
      LIMIT 50`,
    projectId,
  ).reverse();

  const project = one<ProjectRow>(
    "SELECT * FROM projects WHERE id = ?",
    projectId,
  );
  const latestTurn = one<AgentTurnRow>(
    `SELECT * FROM agent_turns
      WHERE project_id = ? AND undone_at IS NULL
      ORDER BY created_at DESC, rowid DESC
      LIMIT 1`,
    projectId,
  );
  const canUndo = Boolean(
    latestTurn && project && latestTurn.project_updated_at === project.updated_at,
  );

  return {
    messages: rows.map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      actions: parseActions(row.actions_json),
      turnId: row.turn_id,
      createdAt: row.created_at,
    })),
    canUndo,
    undoBlockedReason:
      latestTurn && !canUndo
        ? "The project changed after this turn, so undo is unavailable."
        : null,
    turnId: latestTurn?.id ?? null,
    provider: {
      name: config.agentProvider,
      model: config.openCodeModel,
      configured:
        config.agentProvider === "mock" || Boolean(config.openCodeApiKey),
    },
  };
}
```

- [ ] **Step 7: Create `server/src/services/agent/run.ts`**

```ts
import crypto from "node:crypto";
import {
  type AgentAction,
  type AgentChatResult,
} from "@ai-video-agent-studio/shared";
import { config } from "../../config.js";
import { all, mutate, nowIso, one } from "../../db/index.js";
import { AppError } from "../../lib/errors.js";
import { parse } from "../../lib/validate.js";
import {
  ownedProject,
  projectDetail,
  snapshotProject,
  type ProjectSnapshot,
} from "../clipEdits.js";
import type { ProjectRow } from "../serializers.js";
import { loadConversation, type AgentMessageRow } from "./conversation.js";
import { mockProvider } from "./mock.js";
import { buildSystemPrompt } from "./prompt.js";
import {
  completeWithProvider,
  type ChatMessage,
} from "./provider.js";
import { MUTATING_TOOLS, TOOL_DEFS, runAgentTool } from "./tools.js";
import { buildAgentState } from "./state.js";

function insertMessage(
  projectId: string,
  role: "user" | "assistant",
  content: string,
  actions: AgentAction[],
  turnId: string | null,
) {
  const id = crypto.randomUUID();
  const createdAt = nowIso();
  mutate(
    `INSERT INTO agent_messages
      (id, project_id, role, content, actions_json, turn_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id,
    projectId,
    role,
    content,
    JSON.stringify(actions),
    turnId,
    createdAt,
  );
  return { id, role, content, actions, turnId, createdAt };
}

function describeFailure(error: unknown): string {
  if (error instanceof AppError) return error.message;
  return error instanceof Error ? error.message : "Unknown error";
}

export async function runAgentTurn(
  userId: string,
  projectId: string,
  message: string,
): Promise<AgentChatResult> {
  ownedProject(userId, projectId);
  if (config.agentProvider === "opencode" && !config.openCodeApiKey) {
    throw new AppError(
      503,
      "provider_not_configured",
      "The agent has no model key. Add OPENCODE_API_KEY to pro/.env, or run the server with AGENT_PROVIDER=mock.",
    );
  }

  const history = all<AgentMessageRow>(
    `SELECT * FROM agent_messages
      WHERE project_id = ? AND role IN ('user', 'assistant')
      ORDER BY created_at DESC, rowid DESC
      LIMIT 12`,
    projectId,
  ).reverse();

  insertMessage(projectId, "user", message, [], null);

  let state = buildAgentState(projectId);
  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(state) },
    ...history.map((row) => ({ role: row.role, content: row.content })),
    { role: "user", content: message },
  ];

  const actions: AgentAction[] = [];
  let snapshot: ProjectSnapshot | null = null;
  const createdAssetIds: string[] = [];
  let finalContent = "";
  const complete =
    config.agentProvider === "mock" ? mockProvider : completeWithProvider;

  try {
    for (let round = 0; round < 8; round += 1) {
      const reply = await complete({
        messages,
        tools: TOOL_DEFS,
        state,
      });

      if (reply.toolCalls.length === 0) {
        finalContent = reply.content.trim() || "Done.";
        break;
      }

      messages.push({
        role: "assistant",
        content: reply.content,
        tool_calls: reply.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: call.arguments },
        })),
      });

      for (const call of reply.toolCalls) {
        if (actions.length >= 12) {
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({
              ok: false,
              error: "The tool call limit for this turn was reached.",
            }),
          });
          continue;
        }

        if (MUTATING_TOOLS.has(call.name) && !snapshot) {
          snapshot = snapshotProject(projectId);
        }

        const outcome = await runAgentTool(call.name, call.arguments, {
          userId,
          projectId,
          createdAssetIds,
        });
        state = outcome.state;
        actions.push({
          tool: call.name,
          ok: outcome.ok,
          summary: outcome.summary,
          thumbnailUrl: outcome.thumbnailUrl,
        });
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(
            outcome.ok
              ? {
                  ok: true,
                  summary: outcome.summary,
                  state,
                }
              : { ok: false, error: outcome.summary, state },
          ).slice(0, 12_000),
        });
      }

      if (actions.length >= 12) break;
    }

    if (!finalContent) {
      finalContent = actions.length
        ? "I stopped after several steps. Tell me how to continue."
        : "I did not make a change. Tell me what to edit.";
    }
  } catch (error) {
    console.error("[agent] turn failed:", error);
    finalContent = actions.length
      ? `I made changes, then hit an error: ${describeFailure(error).slice(0, 300)}`
      : `I couldn't reach the model: ${describeFailure(error).slice(0, 300)}`;
  }

  const mutated = actions.some(
    (action) => action.ok && MUTATING_TOOLS.has(action.tool),
  );
  let turnId: string | null = null;
  if (mutated && snapshot) {
    turnId = crypto.randomUUID();
    const project = one<ProjectRow>(
      "SELECT * FROM projects WHERE id = ?",
      projectId,
    );
    mutate(
      `INSERT INTO agent_turns
        (id, project_id, snapshot_json, created_asset_ids_json, project_updated_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      turnId,
      projectId,
      JSON.stringify(snapshot),
      JSON.stringify(createdAssetIds),
      project?.updated_at ?? nowIso(),
      nowIso(),
    );
  }

  insertMessage(projectId, "assistant", finalContent, actions, turnId);

  return {
    project: projectDetail(userId, projectId),
    conversation: loadConversation(projectId),
  };
}
```

- [ ] **Step 8: Create `server/src/services/agent/undo.ts`**

```ts
import { type ProjectDetail } from "@ai-video-agent-studio/shared";
import { audit, getDb, mutate, nowIso, one } from "../../db/index.js";
import { conflict, notFound } from "../../lib/errors.js";
import {
  ownedProject,
  projectDetail,
  type ProjectSnapshot,
} from "../clipEdits.js";
import { deleteAssetFiles, type MediaRow } from "../mediaService.js";

interface AgentTurnRow {
  id: string;
  project_id: string;
  snapshot_json: string;
  created_asset_ids_json: string;
  project_updated_at: string;
  created_at: string;
  undone_at: string | null;
}

export async function undoTurn(
  userId: string,
  turnId: string,
): Promise<ProjectDetail> {
  const turn = one<AgentTurnRow>(
    "SELECT * FROM agent_turns WHERE id = ?",
    turnId,
  );
  if (!turn) throw notFound("Agent turn not found");

  const project = ownedProject(userId, turn.project_id);
  if (turn.undone_at) throw conflict("That turn was already undone.");

  const latest = one<{ id: string }>(
    `SELECT id FROM agent_turns
      WHERE project_id = ? AND undone_at IS NULL
      ORDER BY created_at DESC, rowid DESC
      LIMIT 1`,
    project.id,
  );
  if (latest?.id !== turn.id) {
    throw conflict("Only the latest agent turn can be undone.");
  }
  if (project.updated_at !== turn.project_updated_at) {
    throw conflict(
      "The project changed after that turn, so undo is unavailable.",
    );
  }

  const snapshot: ProjectSnapshot = JSON.parse(turn.snapshot_json);
  const createdAssetIds: string[] = JSON.parse(turn.created_asset_ids_json);
  const db = getDb();

  db.exec("BEGIN IMMEDIATE");
  try {
    mutate(
      "DELETE FROM clips WHERE track_id IN (SELECT id FROM tracks WHERE project_id = ?)",
      project.id,
    );
    for (const clip of snapshot.clips) {
      mutate(
        `INSERT INTO clips
          (id, track_id, asset_id, kind, start_ms, duration_ms, in_ms, out_ms,
           x, y, scale, rotation, opacity, text, style_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        clip.id,
        clip.track_id,
        clip.asset_id,
        clip.kind,
        clip.start_ms,
        clip.duration_ms,
        clip.in_ms,
        clip.out_ms,
        clip.x,
        clip.y,
        clip.scale,
        clip.rotation,
        clip.opacity,
        clip.text,
        clip.style_json,
        clip.created_at,
      );
    }
    mutate(
      "UPDATE projects SET name = ?, updated_at = ? WHERE id = ?",
      snapshot.name,
      nowIso(),
      project.id,
    );
    mutate("UPDATE agent_turns SET undone_at = ? WHERE id = ?", nowIso(), turn.id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  audit(userId, "agent.undo", "agent_turn", turn.id, {});

  for (const assetId of createdAssetIds) {
    const referenced = one<{ id: string }>(
      "SELECT id FROM clips WHERE asset_id = ? LIMIT 1",
      assetId,
    );
    if (referenced) continue;
    const asset = one<MediaRow>(
      "SELECT * FROM media_assets WHERE id = ? AND project_id = ?",
      assetId,
      project.id,
    );
    if (!asset) continue;
    mutate("DELETE FROM media_assets WHERE id = ?", assetId);
    await deleteAssetFiles(asset).catch((error: unknown) => {
      console.error("[agent] could not remove generated asset files:", error);
    });
  }

  return projectDetail(userId, project.id);
}
```

- [ ] **Step 9: Create `server/src/routes/agent.ts` and mount it**

```ts
import { Router } from "express";
import { agentChatSchema } from "@ai-video-agent-studio/shared";
import { requireAuth, requireCsrf } from "../lib/auth.js";
import { param } from "../lib/http.js";
import { parse } from "../lib/validate.js";
import { projectDetail } from "../services/clipEdits.js";
import { loadConversation } from "../services/agent/conversation.js";
import { runAgentTurn } from "../services/agent/run.js";
import { undoTurn } from "../services/agent/undo.js";

export const agentRouter = Router();

agentRouter.get("/projects/:id", requireAuth, (req, res) => {
  const project = projectDetail(req.auth!.user.id, param(req, "id"));
  res.json({ project, conversation: loadConversation(project.id) });
});

agentRouter.post("/chat", requireAuth, requireCsrf, async (req, res) => {
  const input = parse(agentChatSchema, req.body);
  const result = await runAgentTurn(
    req.auth!.user.id,
    input.projectId,
    input.message,
  );
  res.json(result);
});

agentRouter.post("/turns/:turnId/undo", requireAuth, requireCsrf, async (req, res) => {
  const project = await undoTurn(req.auth!.user.id, param(req, "turnId"));
  res.json({ project, conversation: loadConversation(project.id) });
});
```

In `server/src/app.ts`, import `agentRouter` and add, next to the other mounts:

```ts
  app.use("/api/agent", agentRouter);
```

- [ ] **Step 10: Write the smoke proof**

Create `scripts/agent-smoke.mjs`:

```js
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
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
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
```

- [ ] **Step 11: Add the npm script**

In `pro/package.json` scripts, next to `render:smoke`:

```json
    "agent:smoke": "node scripts/agent-smoke.mjs",
```

- [ ] **Step 12: Run it**

```bash
npm run typecheck
npm run agent:smoke
```

Expected: all checks PASS, the agent export renders, and `Agent smoke passed.` exits 0. The script starts its own server on 4399; the normal dev server is untouched.

- [ ] **Step 13: Commit**

```bash
git add server/src/services/agent server/src/routes/agent.ts server/src/app.ts scripts/agent-smoke.mjs package.json
git commit -m "feat: add the chat agent backend with guarded undo"
```

---

### Task 4: The `/agent` page

**Files:**
- Create: `client/src/pages/AgentPage.tsx`
- Create: `client/src/components/agent/ClipStrip.tsx`
- Modify: `client/src/api.ts:76-151`
- Modify: `client/src/App.tsx:1-85`
- Modify: `client/src/components/AppShell.tsx:23-29`
- Modify: `client/src/styles.css` (append the agent block)

**Interfaces:**
- Consumes: `AgentChatResult`, `AgentConversation`, `AgentMessage`, `ProjectDetail`, `RenderJob`.
- Produces: the `/agent` surface.

- [ ] **Step 1: Add the API calls**

In `client/src/api.ts`, add to the `api` object after `startRender`:

```ts
  getAgentState: (projectId: string) =>
    request<AgentChatResult>(`/api/agent/projects/${projectId}`),
  sendAgentMessage: (projectId: string, message: string) =>
    request<AgentChatResult>("/api/agent/chat", {
      method: "POST",
      body: { projectId, message },
    }),
  undoAgentTurn: (turnId: string) =>
    request<AgentChatResult>(`/api/agent/turns/${turnId}/undo`, {
      method: "POST",
    }),
```

Add `AgentChatResult` to the imported shared types at the top.

- [ ] **Step 2: Create the read-only clip strip**

Create `client/src/components/agent/ClipStrip.tsx`:

```tsx
import {
  formatDuration,
  type ProjectDetail,
} from "@ai-video-agent-studio/shared";

export function ClipStrip({ project }: { project: ProjectDetail }) {
  const total = Math.max(project.durationMs, 1);
  return (
    <div className="clip-strip" aria-label="Timeline overview">
      <div className="clip-strip-head">
        <span>Timeline</span>
        <span className="mono">{formatDuration(project.durationMs)}</span>
      </div>
      <div className="clip-strip-tracks">
        {project.tracks.map((track) => (
          <div className="clip-strip-track" key={track.id}>
            <span className="clip-strip-label">{track.name}</span>
            <div className="clip-strip-lane">
              {track.clips.map((clip) => {
                const asset = project.assets.find((item) => item.id === clip.assetId);
                const label = asset?.originalName ?? clip.text ?? clip.kind;
                return (
                  <span
                    key={clip.id}
                    className={`clip-strip-clip ${clip.kind}`}
                    style={{
                      left: `${(clip.startMs / total) * 100}%`,
                      width: `${Math.max((clip.durationMs / total) * 100, 1.5)}%`,
                    }}
                    title={`${label} · ${formatDuration(clip.durationMs)}`}
                  >
                    {label}
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create the page**

Create `client/src/pages/AgentPage.tsx`:

```tsx
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowUpRight,
  Bot,
  Loader2,
  RotateCcw,
  Send,
} from "lucide-react";
import {
  formatDuration,
  type AgentConversation,
  type AgentMessage,
  type ProjectDetail,
  type RenderJob,
} from "@ai-video-agent-studio/shared";
import { api, ApiError } from "../api";
import { ClipStrip } from "../components/agent/ClipStrip";
import { useToast } from "../components/Toast";
import { useProjects } from "../hooks/useProjects";

const SUGGESTIONS = [
  "Trim the first clip by one second",
  "Split the first clip in half",
  "Start an export",
];

function Message({ message }: { message: AgentMessage }) {
  return (
    <article className={`chat-msg ${message.role}`}>
      <div className="chat-msg-content">{message.content}</div>
      {message.actions.length > 0 ? (
        <ul className="chat-actions">
          {message.actions.map((action, index) => (
            <li
              key={`${action.tool}-${index}`}
              className={action.ok ? "ok" : "failed"}
            >
              {action.thumbnailUrl ? (
                <img src={action.thumbnailUrl} alt="" />
              ) : (
                <span className="chat-action-dot" aria-hidden="true" />
              )}
              <span>{action.summary}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

export function AgentPage() {
  const { projects, loading: projectsLoading } = useProjects();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("project");
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [conversation, setConversation] = useState<AgentConversation | null>(null);
  const [renders, setRenders] = useState<RenderJob[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const logRef = useRef<HTMLDivElement | null>(null);
  const loadSequence = useRef(0);

  const apply = useCallback((next: AgentConversation, nextProject: ProjectDetail) => {
    setConversation(next);
    setProject(nextProject);
  }, []);

  const load = useCallback(
    async (id: string) => {
      const sequence = ++loadSequence.current;
      setLoading(true);
      try {
        const [state, renderData] = await Promise.all([
          api.getAgentState(id),
          api.listRenders(id),
        ]);
        if (sequence !== loadSequence.current) return;
        apply(state.conversation, state.project);
        setRenders(renderData.jobs);
        setError(null);
      } catch (err) {
        if (sequence !== loadSequence.current) return;
        setError(err instanceof ApiError ? err.message : "Could not load the agent.");
      } finally {
        if (sequence === loadSequence.current) setLoading(false);
      }
    },
    [apply],
  );

  useEffect(() => {
    if (projectsLoading || projects.length === 0) return;
    if (selectedId && projects.some((item) => item.id === selectedId)) return;
    setParams({ project: projects[0].id }, { replace: true });
  }, [projects, projectsLoading, selectedId, setParams]);

  useEffect(() => {
    if (selectedId) void load(selectedId);
  }, [selectedId, load]);

  useEffect(() => {
    const element = logRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [conversation?.messages.length, sending]);

  const send = async () => {
    const text = draft.trim();
    if (!text || !selectedId || sending) return;
    setSending(true);
    setDraft("");
    try {
      const result = await api.sendAgentMessage(selectedId, text);
      apply(result.conversation, result.project);
      const lastActions =
        result.conversation.messages[result.conversation.messages.length - 1]?.actions ?? [];
      if (lastActions.some((action) => action.tool === "start_export")) {
        void api
          .listRenders(selectedId)
          .then((data) => setRenders(data.jobs))
          .catch(() => undefined);
      }
    } catch (err) {
      toast(
        err instanceof ApiError ? err.message : "The agent could not answer.",
        "error",
      );
      await load(selectedId);
    } finally {
      setSending(false);
    }
  };

  const undo = async () => {
    if (!conversation?.turnId) return;
    try {
      const result = await api.undoAgentTurn(conversation.turnId);
      apply(result.conversation, result.project);
      toast("Undid the last agent turn.", "success");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not undo.", "error");
    }
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  const provider = conversation?.provider ?? null;
  const canSend = Boolean(provider?.configured) && Boolean(draft.trim()) && !sending;
  const latestRender = renders[0] ?? null;

  if (!projectsLoading && projects.length === 0) {
    return (
      <div className="page">
        <header className="page-header">
          <div>
            <p className="eyebrow">Direct the cut</p>
            <h1>Type it. The agent cuts it.</h1>
            <p className="page-lede">
              The agent edits the same timeline the editor shows. Undo reverts its last turn.
            </p>
          </div>
        </header>
        <div className="empty-state">
          <div className="empty-icon">
            <Bot size={22} />
          </div>
          <h2>No project to edit</h2>
          <p>Create a project first, then come back and describe the cut.</p>
          <Link className="btn btn-primary" to="/">
            Open the dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header agent-header">
        <div>
          <p className="eyebrow">Direct the cut</p>
          <h1>Type it. The agent cuts it.</h1>
          <p className="page-lede">
            The agent edits the same timeline the editor shows. Undo reverts its last turn.
          </p>
        </div>
        <div className="agent-actions">
          <label className="agent-project">
            <span>Project</span>
            <select
              value={selectedId ?? ""}
              onChange={(event) => setParams({ project: event.target.value })}
              disabled={projects.length === 0 || sending}
            >
              {projects.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          {project ? (
            <Link className="btn btn-ghost" to={`/projects/${project.id}`}>
              Open editor
              <ArrowUpRight size={15} />
            </Link>
          ) : null}
        </div>
      </header>

      {error ? <div className="panel agent-error">{error}</div> : null}

      {provider && !provider.configured ? (
        <div className="agent-config">
          <strong>The agent is not configured.</strong> Add{" "}
          <code>OPENCODE_API_KEY</code> and <code>OPENCODE_MODEL</code> to{" "}
          <code>pro/.env</code>, then restart the API. To try the scripted demo,
          run the server with <code>AGENT_PROVIDER=mock</code>.
        </div>
      ) : null}

      <div className="agent-grid">
        <section className="panel chat-panel" aria-label="Agent chat">
          <header className="section-head">
            <div>
              <h2>Conversation</h2>
              <p className="section-sub">The agent only touches this project.</p>
            </div>
            <span className={`agent-badge ${provider?.name ?? ""}`}>
              {provider?.name === "mock"
                ? "Mock agent"
                : (provider?.model ?? "Agent")}
            </span>
          </header>

          <div className="chat-log" ref={logRef}>
            {loading ? (
              <div className="chat-working">
                <Loader2 size={15} className="spin" />
                Loading the transcript…
              </div>
            ) : null}
            {!loading && conversation?.messages.length === 0 ? (
              <div className="chat-empty">
                <Bot size={22} />
                <p>
                  Tell me what to change. I can trim, split, move or delete clips,
                  add a source, rename the project, or start an export.
                </p>
                <div className="chat-suggestions">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      className="btn btn-quiet"
                      onClick={() => setDraft(suggestion)}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {conversation?.messages.map((message) => (
              <Message key={message.id} message={message} />
            ))}
            {sending ? (
              <div className="chat-msg assistant">
                <div className="chat-working">
                  <Loader2 size={15} className="spin" />
                  Working…
                </div>
              </div>
            ) : null}
          </div>

          <form
            className="agent-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onComposerKeyDown}
              placeholder={
                provider?.configured
                  ? "Describe the edit… (Enter to send, Shift+Enter for a new line)"
                  : "The agent needs a model key."
              }
              disabled={!provider?.configured || sending}
              rows={2}
              maxLength={4000}
            />
            <button className="btn btn-primary" type="submit" disabled={!canSend}>
              <Send size={16} />
              Send
            </button>
          </form>

          <div className="agent-undo-row">
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => void undo()}
              disabled={!conversation?.canUndo || sending}
              title={conversation?.undoBlockedReason ?? "Revert the last agent turn"}
            >
              <RotateCcw size={15} />
              Undo last turn
            </button>
            {conversation?.undoBlockedReason ? (
              <span className="agent-hint">{conversation.undoBlockedReason}</span>
            ) : null}
          </div>
        </section>

        <aside className="agent-side">
          <section className="panel">
            <header className="section-head">
              <div>
                <h2>Cut</h2>
                <p className="section-sub">
                  {project ? formatDuration(project.durationMs) : "No project"}
                </p>
              </div>
            </header>
            {project ? (
              <ClipStrip project={project} />
            ) : (
              <p className="panel-note">Pick a project.</p>
            )}
          </section>

          <section className="panel">
            <header className="section-head">
              <div>
                <h2>Target</h2>
              </div>
            </header>
            <dl className="kv">
              <div className="kv-row">
                <dt>Resolution</dt>
                <dd className="mono">
                  {project ? `${project.width}×${project.height}` : "—"}
                </dd>
              </div>
              <div className="kv-row">
                <dt>Frame rate</dt>
                <dd className="mono">{project ? `${project.fps} fps` : "—"}</dd>
              </div>
              <div className="kv-row">
                <dt>Sources</dt>
                <dd className="mono">{project ? project.assets.length : "—"}</dd>
              </div>
            </dl>
          </section>

          <section className="panel">
            <header className="section-head">
              <div>
                <h2>Export</h2>
              </div>
            </header>
            {latestRender ? (
              <div className="agent-export">
                <span className={`status-pill status-${latestRender.status}`}>
                  {latestRender.status}
                </span>
                <span className="agent-hint">
                  {new Date(latestRender.createdAt).toLocaleString()}
                </span>
                <Link className="btn btn-quiet" to="/renders">
                  Open renders
                  <ArrowUpRight size={14} />
                </Link>
              </div>
            ) : (
              <p className="panel-note">
                No export requested yet. Ask the agent or use the editor.
              </p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire the route and the nav**

In `client/src/App.tsx`: import `AgentPage`; replace the `/agent` `RoadmapPage` block with `<Route path="agent" element={<AgentPage />} />`; remove `Bot` from the lucide imports (it was only used by that block).

In `client/src/components/AppShell.tsx`: change the AI Agent entry to:

```ts
  { to: "/agent", label: "AI Agent", icon: Bot },
```

- [ ] **Step 5: Add the styles**

Append to `client/src/styles.css`:

```css
/* AI Agent */
.agent-header {
  align-items: flex-end;
  gap: 18px;
  flex-wrap: wrap;
}
.agent-actions {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}
.agent-project {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--muted);
  font-size: 12px;
}
.agent-project select {
  min-width: 190px;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel-2);
}
.agent-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) minmax(280px, 0.9fr);
  gap: 16px;
  align-items: start;
}
.chat-panel {
  display: flex;
  flex-direction: column;
  min-height: 560px;
  padding: 0;
  overflow: hidden;
}
.chat-panel .section-head {
  padding: 18px 18px 0;
}
.chat-log {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 14px;
  min-height: 360px;
  max-height: 56vh;
  padding: 18px;
  overflow-y: auto;
}
.chat-msg {
  max-width: 88%;
  padding: 10px 13px;
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.5;
}
.chat-msg.user {
  align-self: flex-end;
  border: 1px solid var(--accent-line);
  border-radius: 12px 12px 2px 12px;
  background: var(--accent-soft);
}
.chat-msg.assistant {
  align-self: flex-start;
  border: 1px solid var(--line-soft);
  border-radius: 12px 12px 12px 2px;
  background: var(--panel-2);
}
.chat-msg-content {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.chat-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
}
.chat-actions li {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--muted);
  font-size: 12px;
}
.chat-action-dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--muted);
}
.chat-actions li.ok .chat-action-dot {
  background: var(--ok);
}
.chat-actions li.failed .chat-action-dot {
  background: var(--danger);
}
.chat-actions img {
  width: 64px;
  height: 36px;
  border: 1px solid var(--line);
  border-radius: 4px;
  object-fit: cover;
}
.chat-empty {
  max-width: 420px;
  margin: auto;
  color: var(--muted);
  text-align: center;
}
.chat-empty svg {
  color: var(--accent);
}
.chat-suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: center;
  margin-top: 12px;
}
.chat-working {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--muted);
  font-size: 13px;
}
.agent-composer {
  display: flex;
  gap: 10px;
  padding: 12px;
  border-top: 1px solid var(--line-soft);
}
.agent-composer textarea {
  flex: 1;
  min-height: 44px;
  max-height: 140px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--bg-2);
  color: var(--text);
  resize: vertical;
}
.agent-composer textarea:focus {
  outline: 2px solid var(--accent-line);
  outline-offset: 1px;
}
.agent-undo-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 0 12px 12px;
}
.agent-hint {
  color: var(--dim);
  font-size: 12px;
}
.agent-badge {
  padding: 3px 8px;
  border: 1px solid var(--line);
  border-radius: 999px;
  color: var(--muted);
  font-family: var(--mono);
  font-size: 11px;
}
.agent-badge.mock {
  border-color: rgba(245, 196, 81, 0.4);
  color: var(--warn);
}
.agent-config {
  margin-bottom: 14px;
  padding: 12px 14px;
  border: 1px solid rgba(245, 196, 81, 0.35);
  border-radius: var(--radius);
  background: rgba(245, 196, 81, 0.07);
  font-size: 13px;
}
.agent-config code {
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--panel-2);
  font-family: var(--mono);
}
.agent-error {
  margin-bottom: 14px;
  border-color: var(--danger);
  color: var(--danger);
}
.agent-side {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.agent-export {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}
.clip-strip {
  padding: 4px 0;
}
.clip-strip-head {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
  color: var(--muted);
  font-size: 12px;
}
.clip-strip-tracks {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.clip-strip-track {
  display: grid;
  grid-template-columns: 58px 1fr;
  align-items: center;
  gap: 8px;
}
.clip-strip-label {
  overflow: hidden;
  color: var(--dim);
  font-size: 10px;
  letter-spacing: 0.06em;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
}
.clip-strip-lane {
  position: relative;
  height: 22px;
  overflow: hidden;
  border: 1px solid var(--line-soft);
  border-radius: 5px;
  background: var(--bg-2);
}
.clip-strip-clip {
  position: absolute;
  top: 2px;
  bottom: 2px;
  overflow: hidden;
  padding: 0 4px;
  border: 1px solid var(--line);
  border-radius: 3px;
  background: var(--panel-3);
  color: var(--muted);
  font-size: 9px;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.clip-strip-clip.video,
.clip-strip-clip.overlay {
  border-color: var(--accent-line);
  background: rgba(255, 138, 61, 0.14);
  color: var(--text);
}
.clip-strip-clip.audio {
  border-color: rgba(94, 234, 212, 0.3);
  background: rgba(94, 234, 212, 0.1);
}
@media (max-width: 1050px) {
  .agent-grid {
    grid-template-columns: 1fr;
  }
  .chat-log {
    max-height: none;
  }
}
```

- [ ] **Step 6: Verify the build and the guard**

```bash
npm run typecheck
npm run css:check
npm run agent:smoke
```

Expected: all 0. (The page compiles; the smoke proves the backend it talks to.)

- [ ] **Step 7: Browser walkthrough with the mock provider**

The running API must be restarted with `AGENT_PROVIDER=mock` (the client stays on 5180):

1. Stop the dev API process on port 4320.
2. From `pro/`, start it with the mock provider in the background: `AGENT_PROVIDER=mock npm run dev:server`.
3. Sign in at `http://127.0.0.1:5180` and open `AI Agent`.
4. Create a project and upload `test-fixtures/fixture-a.mp4` (or seed it through the API), then open `/agent?project=<id>`.
5. Send “Split the first clip in half”. Expect: user bubble, assistant bubble, a green action chip, two clips in the strip.
6. Click “Undo last turn”. Expect: one clip again, the transcript keeps both messages, the button disables.
7. Send “Start an export”. Expect: an export chip and the Export panel showing a status.
8. Screenshot the page to `pro/test-results/agent-page.png`.
9. Delete the temporary project, then restart the API normally (no `AGENT_PROVIDER`).

Expected: every step is visible in the page; no browser console errors other than ignored auth noise.

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/AgentPage.tsx client/src/components/agent/ClipStrip.tsx client/src/api.ts client/src/App.tsx client/src/components/AppShell.tsx client/src/styles.css
git commit -m "feat: add the AI agent chat page"
```

---

### Task 5: Truthful copy and the full gate

**Files:**
- Modify: `client/src/pages/DashboardPage.tsx:21-28`
- Verify: all suites

**Interfaces:**
- Consumes: everything above.
- Produces: a verified milestone.

- [ ] **Step 1: Update the milestone list**

In `client/src/pages/DashboardPage.tsx`:

```ts
  { label: "Chat agent with undo", state: "live" },
```

replacing `{ label: "Agent tools with approval", state: "planned" }`. Keep “Keyframed motion graphics” planned: generated MP4 cards are not keyframed timeline properties.

- [ ] **Step 2: Run the full gate**

From `pro/`, with the API on 4320 (normal provider settings) and the client on 5180:

```bash
npm run typecheck
npm run css:check
node scripts/smoke.mjs
node scripts/ui-smoke.mjs
npm run render:smoke
npm run agent:smoke
```

Expected: every suite exits 0; the agent smoke starts and stops its own server; no project or temp directory is left behind.

- [ ] **Step 3: Final walkthrough**

Repeat Task 4 Step 7 once against the merged result, including the unconfigured-provider banner (start the API without a key and without mock once, open `/agent`, confirm the banner and disabled composer, then restart normally). Screenshot to `pro/test-results/agent-unconfigured.png`.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/DashboardPage.tsx
git commit -m "docs: mark the chat agent live on the dashboard"
```

---

## Self-review

- **Spec coverage:** chat page + editor retained (Task 4), OpenCode Zen + `.env` + mock (Tasks 1, 3), immediate edits + guarded undo (Tasks 2, 3), validated tools (Task 3), honest errors (Task 3), transcript persistence (Task 3), tests and browser proof (Tasks 3–5). Motion cards are Phase 2.
- **Placeholder scan:** no TBD/TODO; every created file has code; verification commands have expected results.
- **Type consistency:** `AgentConversation.turnId` is produced by `loadConversation` and consumed by the page; `AgentChatResult` is used by both routes and `api.ts`; `ToolOutcome.state` feeds `run.ts`; `snapshotProject` returns the exact shape `undo.ts` reads.
- **Known edge:** `process.loadEnvFile` throws if the file contains invalid syntax; the server then fails at boot with a clear Node error rather than silently ignoring the key.
