# M4 — A chat agent that edits the cut, plus generated motion cards

Date: 2026-10-23
Status: approved
Scope: the CUTROOM app in `pro/`

## Problem

The sidebar has an **AI Agent** entry, but `/agent` renders a roadmap placeholder and
the server has no agent code at all. The only reference to a model is
`config.openCodeApiKey` in the boot log, which claims "agent uses rule-based commands"
against an agent that does not exist.

The request is a chat-only editing surface: the user types what they want, the agent
makes the edit, and the result is visible immediately. It must also produce motion
graphics — animated titles, bullet cards and bar charts — in the spirit of Claude
Motion.

**Claude Motion itself cannot be embedded.** It is an Anthropic in-app beta (Team and
Enterprise) that writes code to animate cards inside Claude; it has no public API. What
can be reproduced in CUTROOM is the approach: cards described as data, rendered by
code, exported as a real MP4. CUTROOM already has the FFmpeg renderer that makes that
last step honest.

## Goal

A signed-in user can open **AI Agent**, pick a project, and describe an edit in chat.
The agent reads the real project state, calls the same validated edit operations the UI
uses, shows what it changed, and can undo its last turn. It can also generate an
animated title/bullets/bars card, ingest it as a normal source, and place it on the
timeline so the existing export pipeline includes it.

The existing timeline editor remains. Chat is another way to drive it, not a
replacement, and no surface may claim the agent did something it did not do.

## Non-goals

- **Streaming tokens.** Replies are non-streaming in this milestone; the UI shows a
  working state, then the complete message and its action list.
- **Multiple conversations per project.** One transcript per project, newest 50 messages
  shown.
- **Transcript/silence tools, captions, keyframed motion.** Those remain roadmap items.
  This milestone has no transcript data to drive them.
- **Images, pie/line charts, brand fonts, CSV import in motion cards.** Text, rules,
  blocks and bar charts only.
- **Removing the manual editor.** It stays as the inspection and fallback surface.
- **Arbitrary code execution by the model.** The agent gets a fixed tool registry, no
  shell, no filesystem access, no HTTP client, and cannot delete source files.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Brain | Existing OpenCode Zen gateway (`OPENCODE_API_KEY`, `OPENCODE_BASE_URL`, `OPENCODE_MODEL`) | Already in server config; OpenAI-compatible chat completions with tool calls. The model must support tool calling. |
| Key storage | Server-side only, in `pro/.env` | The browser never sees the key. `config.ts` gains `.env` loading via Node's `process.loadEnvFile`. |
| Surfaces | New `/agent` page; the editor stays | The chat page is the primary editing surface; the editor remains for inspection and manual fixes. |
| Edit policy | Apply immediately, undo the last turn | Matches "the AI edits for me"; safety comes from a snapshot and a guard, not from an approval dialog for every trim. |
| Motion output | Real MP4, ingested as a normal asset + clip | Reuses the existing upload/render pipeline; no new clip kind and no renderer changes. |
| Test provider | `AGENT_PROVIDER=mock` | Deterministic, offline, and lets the whole flow be smoke-tested without a key. Clearly labelled in the UI. |
| Phasing | Phase 1 footage edits, Phase 2 motion cards | Each phase ships working software and has its own plan file. |

## Architecture

### Data

Migration `002_agent` adds two tables:

```
agent_messages(id, project_id, role, content, actions_json, turn_id, created_at)
  role is 'user' or 'assistant'
  actions_json is [{ tool, ok, summary, thumbnailUrl? }]
  turn_id links an assistant message to the turn it produced

agent_turns(id, project_id, snapshot_json, created_asset_ids_json,
            project_updated_at, created_at, undone_at)
  snapshot_json is { name, clips: ClipRow[] } taken before the first mutation
  project_updated_at is projects.updated_at immediately after the turn finished
```

Both tables cascade with the project. No conversation table: the project is the
conversation. A turn exists only when at least one mutating tool ran.

### Request flow

`POST /api/agent/chat` (auth + CSRF) takes `{ projectId, message }`:

1. Persist the user message.
2. Load the last 12 user/assistant messages and build a compact project state.
3. Call the provider with the system prompt, history, user message, and tool schemas.
4. While the model requests tools (max 8 model rounds, 12 tool calls):
   - before the first mutating tool, snapshot the project name and every clip row;
   - execute the tool through the shared edit services;
   - append the structured result and the refreshed compact state;
   - record `{ tool, ok, summary }` for the UI.
5. Persist the assistant message and, if anything mutated, the turn row.
6. Return the updated project detail and the conversation.

Provider failures are errors, not fabricated success. If tools already ran, the
assistant message records what changed and the turn remains undoable; if nothing ran,
the user message stays and the API returns `502`.

### Tools

| Tool | Arguments | Reuses |
|---|---|---|
| `get_project` | — | project state reader |
| `update_clip` | `clipId`, optional `startMs`, `durationMs`, `inMs` | `updateClip` service + `updateClipSchema` |
| `split_clip` | `clipId`, `atMs` (absolute timeline ms) | `splitClip` service + `splitClipSchema` |
| `delete_clip` | `clipId` | `deleteClip` service |
| `add_clip` | `assetId`, optional `startMs` | `createClip` service + `createClipSchema` |
| `rename_project` | `name` | `updateProjectSchema` |
| `start_export` | — | `createRenderJob` |
| `create_motion_graphic` | `layout`, `title`, optional `subtitle`, `bullets`, `bars`, `durationMs`, `background`, `accent` | Phase 2: motion renderer + `ingestUpload` + `createClip` |

The clip operations currently live inside `routes/clips.ts`. They move to
`services/clipEdits.ts` so the HTTP routes and the agent call one implementation with
one set of validations (ownership, locked tracks, source bounds, overlap). The routes
become thin wrappers; their responses do not change.

### Undo

`POST /api/agent/turns/:turnId/undo` restores the snapshot: deletes the project's
current clips, re-inserts the snapshot rows verbatim, restores the project name, and
removes any assets the turn created that are no longer referenced. It refuses when:

- the turn was already undone;
- it is not the latest non-undone turn;
- `projects.updated_at` no longer matches `agent_turns.project_updated_at`, which means
  something else edited the project after the turn.

That last guard is the important one: a stale snapshot must never silently overwrite
newer manual work. Consequence: undo is effectively one level deep, and the UI says
"Undo last turn", not "undo history".

### Motion cards

`services/motionService.ts` turns a spec into an MP4 with FFmpeg alone:

- `color` source at the project's resolution and fps, 2–15 s;
- `drawbox` for the accent rule, background panel and bar-chart bars;
- `drawtext` with `textfile=` for every text element (avoids filter-graph escaping of
  user text), staggered alpha for bullets, fade in/out over the whole clip;
- a silent `anullsrc` audio track so the existing renderer never has to special-case a
  silent source;
- libx264, `yuv420p`, faststart.

The output is ingested with the existing `ingestUpload`, which probes it, makes a
thumbnail and stores it in `data/uploads`; then `createClip` appends it to the video
track. The export pipeline composes it exactly like any other source.

Fonts come from `MOTION_FONT` or a short list of common system fonts. If none exists,
the tool returns a clear error and creates nothing.

## UX

`/agent` — **AI Agent**:

- project picker (with a link to create one when the list is empty), "Open editor" link;
- chat transcript: user messages, assistant text, action chips with a check or warning;
  motion actions may show the generated thumbnail;
- composer: Enter sends, Shift+Enter adds a line; disabled while a turn is running;
- undo control for the latest turn, disabled with the server's reason when blocked;
- right column: read-only clip strip (tracks × time), latest export status with a link
  to Renders, provider badge (`mock` or the configured model);
- when not configured: a banner that names the two environment variables and tells the
  user how to restart, or how to run the mock agent. The page still loads history.
- no project: an empty state linking to the dashboard.

The nav loses the "soon" dot for AI Agent. Dashboard milestone copy changes from
"Agent tools with approval" to "Chat agent with undo" once Phase 1 is verified, and
gains "Generated title cards" once Phase 2 is verified. The copy must not say
"approval" because edits apply immediately.

## Safety

- All routes require a session; mutations require CSRF.
- Every tool resolves the project through the owner check; the model never supplies a
  user id or a project id it can change.
- The tool registry is fixed, arguments are zod-validated, ids must be UUIDs, and tool
  calls are capped per turn.
- Locked tracks, overlap and source bounds are enforced by the shared services, not by
  the model's judgment.
- Undo restores only clips and the project name; it cannot resurrect deleted sources
  and never touches files outside the project's own storage.
- The API key is read server-side only; errors are truncated before surfacing.

## Verification

- Existing gates stay green: `npm run typecheck`, `npm run css:check`, `node
  scripts/smoke.mjs`, `node scripts/ui-smoke.mjs`, `npm run render:smoke`.
- New `npm run agent:smoke` starts its own API on a spare port with
  `AGENT_PROVIDER=mock` and a temporary data directory, then proves:
  trim, split, delete, add, rename and export through chat; the undo snapshot restores
  clips; a manual edit after a turn blocks undo; the transcript persists; a second
  agent turn is still undoable.
- Phase 2 adds: a generated card is a real MP4 (ffprobe), becomes an asset and a clip,
  appears in the timeline, and undo removes both clip and asset.
- Browser walkthrough of `/agent` against a mock-enabled API with screenshots in
  `pro/test-results/`.
- A real-key run is manual and only claimed if it happens. The smoke suite never calls
  the network.

## Deliberate limits

- Non-streaming; one transcript per project; one-level undo; project-changed guard.
- Motion cards are generated graphics, not keyframed timeline properties: no images,
  no pie/line charts, no brand fonts, host font required.
- The model must support tool calling; a model without it surfaces the provider's
  error in chat. No automatic fallback model.
- Single visual track (existing), so a card is appended to the video track at its end.
- Starting an export does not block undo; a render queued before an undo keeps the old
  cut. The Renders page remains the source of truth for what was exported.
