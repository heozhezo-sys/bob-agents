# Agent editor — Phase 2: generated motion cards

**Goal:** let the agent generate an animated title, bullet list or bar chart as a real
MP4, ingest it as a normal source, append it to the video track, and remove both the
clip and the file when the turn is undone. No new clip kind, no renderer changes.

**Design:** `docs/superpowers/specs/2026-10-23-agent-editor-design.md`, section
"Motion cards".

## Global constraints

- FFmpeg only. No new dependency, no browser/canvas renderer.
- The spec's user strings never enter the filtergraph. Every text line goes through a
  `textfile` written into a per-render temp directory; the font is copied there too, so
  `fontfile`/`textfile` are plain relative names with no escaping.
- Colors and numbers are validated before they reach FFmpeg. Hex colors are exactly
  `#RRGGBB`.
- Motion output uses the project's width, height and fps; 2–15 s, default 4 s.
- A failed render creates nothing. A failed clip insert removes the ingested asset.
- Existing routes, clip behavior, undo guards and the Phase 1 tests are unchanged.

## File structure

- Create: `server/src/services/motionService.ts`
- Modify: `server/src/config.ts` (`motionFont`)
- Modify: `server/src/services/agent/tools.ts` (tool def + execution)
- Modify: `server/src/services/agent/mock.ts` (deterministic card request)
- Modify: `scripts/agent-smoke.mjs` (card assertions)
- Modify: `client/src/pages/DashboardPage.tsx` (milestone)
- Create: `docs/superpowers/plans/2026-10-23-agent-editor-phase2.md` (this file)

## Task 1: the renderer

`server/src/services/motionService.ts` exports:

```ts
export const motionSpecSchema = z.object({
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
  background: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#0e1013"),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#ff8a3d"),
}).superRefine((spec, ctx) => {
  if (spec.layout === "bullets" && !spec.bullets?.length) {
    ctx.addIssue({ code: "custom", path: ["bullets"], message: "A bullet card needs bullets." });
  }
  if (spec.layout === "bars" && !spec.bars?.length) {
    ctx.addIssue({ code: "custom", path: ["bars"], message: "A bar card needs bars." });
  }
});
```

`createMotionGraphic(userId, projectId, spec)`:

1. `ownedProject(userId, projectId)`; use its width/height/fps.
2. `resolveFont()`: `config.motionFont`, then Segoe UI Semibold / Arial Bold,
   Supplemental Arial Bold, DejaVu Sans Bold, Liberation Sans Bold. Missing → 500
   `motion_font_missing` naming `MOTION_FONT`.
3. `mkdtemp(path.join(paths.tmp, "motion-"))`, copy the font to `font.ttf`, write every
   wrapped text line to `line-N.txt`.
4. Build the filtergraph:
   - `color` source + silent `anullsrc`;
   - `drawbox` for the accent rule, panels, bullet dots, bar tracks and bar fills;
   - `drawtext` for title, subtitle, bullets and bar labels/values;
   - staggered bullet alpha/enable, growing bar widths via `w='...'`;
   - `fade` in/out (0.3 s), `format=yuv420p`.
5. Render `card.mp4` with `runBinary(ffmpegPath, args, { cwd: workDir, timeoutMs: 120_000 })`;
   non-zero exit → 500 `motion_render_failed` with the tail of stderr.
6. `ingestUpload({ tempPath: card.mp4, originalName: "motion-<layout>.mp4", projectId, declaredMime: "video/mp4" })`.
7. `createClip(userId, projectId, { assetId })`; on failure delete the asset row and
   files, then rethrow.
8. Return `{ asset, startMs, durationMs }`; the caller maps `asset` to a thumbnail URL.
9. `finally rm(workDir, { recursive: true, force: true })`.

Layout rules (all sizes derive from the project width):

- title: wrapped at 24 chars, accent rule above, subtitle below, vertically centered;
- bullets: heading + rule, up to 5 bullets, each appears 0.18 s after the previous;
- bars: heading + subtitle, up to 5 rows, label left, value right, track + accent fill
  growing over 0.6 s.

## Task 2: tool and mock

`create_motion_graphic` definition: `layout`, `title`, optional `subtitle`, `bullets`,
`bars`, `durationMs`, `background`, `accent`; required `layout`, `title`. Add it to
`MUTATING_TOOLS`.

Execution:

```ts
case "create_motion_graphic": {
  const spec = parse(motionSpecSchema, args);
  const result = await createMotionGraphic(ctx.userId, ctx.projectId, spec);
  ctx.createdAssetIds.push(result.asset.id);
  return {
    ok: true,
    summary: `Generated a ${spec.layout} card and added it at ${result.startMs} ms.`,
    state: buildAgentState(ctx.projectId),
    thumbnailUrl: `/api/assets/${result.asset.id}/thumbnail`,
  };
}
```

Mock: `"motion" | "chart" | "title card"` triggers a bars card for `bar|chart`,
otherwise a title card. Exact values keep the smoke deterministic.

## Task 3: the smoke proof

Extend `scripts/agent-smoke.mjs` after the add/undo pair:

1. Chat `"Create a bar chart card"`.
2. Action chip is `create_motion_graphic` and `ok`.
3. `project.assets.length` is 2; video clips are 3; the new clip's asset name starts
   with `motion-`.
4. The new asset exposes a thumbnail URL and a stream URL; `GET` the thumbnail (200)
   and the stream with `Range: bytes=0-1023` (206, `video/mp4`).
5. Undo: assets return to 1, video clips to 2, transcript keeps the turn.
6. Existing export still renders.

## Task 4: copy and gate

- Dashboard gains `{ label: "Generated title cards", state: "live" }`; "Keyframed
  motion graphics" stays planned.
- Gate: `npm run typecheck`, `npm run css:check`, `node scripts/smoke.mjs`,
  `node scripts/ui-smoke.mjs`, `npm run render:smoke`, `npm run agent:smoke`.
- Browser walkthrough: `/agent` with `AGENT_PROVIDER=mock`, send
  `"Create a bar chart card"`, confirm the thumbnail chip and three timeline clips,
  screenshot `test-results/agent-motion.png`, undo, confirm two clips.

## Limits

- Text is wrapped by character count, not measured glyphs; extreme strings may clip.
- One visual track, so cards append at the end of the cut.
- No images, pie/line charts, brand fonts or keyframed card properties.
- A render queued before an undo keeps the old cut; Renders remains the record.
