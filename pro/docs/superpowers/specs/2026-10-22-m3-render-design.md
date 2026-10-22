# M3 — Real FFmpeg render & download: finish and prove it

Date: 2026-10-22
Status: approved
Scope: the CUTROOM app in `pro/`

## Problem

The studio's third milestone is labelled **Next** on the dashboard, but the renderer
behind it already works. Meanwhile the editor itself renders as unstyled HTML, and the
browser test suite cannot get past the clip-drag step.

Three separate truths are tangled together:

1. **The editor is unstyled.** `pro/client/src/styles.css:1215` contains a stray,
   unclosed `.export-summary {` rule. Every rule after that line is swallowed by it, so
   the editor, timeline, media panel and project cards have rendered as raw HTML since
   the ExportModal work landed. The app shell and dashboard sit earlier in the file and
   are unaffected, which is why the damage is easy to miss.
2. **The browser test fails for the wrong reason.** `scripts/ui-smoke.mjs` measures the
   first clip without scrolling it into view. In the editor layout the clip sits at
   y=978 inside an 861px viewport, so Chromium delivers `pointerdown` and `pointerup`
   but drops the `pointermove` events. The drag handler never runs, the test waits for
   a `PATCH` that can never arrive, and the suite times out. **The application's drag is
   correct** — with the clip in view, `pointermove` fires six times and
   `PATCH {"startMs":2000}` goes out.
3. **The milestone badges lie.** The dashboard says the render is "Next" and the
   roadmap panels say the studio has no renderer, while a real render already succeeds
   end-to-end.

## Goal

M3 becomes true and proven: a user can upload footage, cut it on the timeline, export
it, watch the render progress and download a verified MP4 — in a correctly styled UI,
with every badge telling the truth.

## Non-goals

These are real work, but they belong to later milestones and most of them are not
reachable from the current UI:

- **Multi-visual-track compositing.** The project creates exactly one video, one audio
  and one text track, and there is no add-track control, so a second visual track
  cannot be built from the UI. The renderer already refuses loudly rather than
  silently dropping a track. (Milestone 5)
- **Text and motion burn-in.** `createClipSchema` requires a `mediaAssetId`, so no text
  clip can be created and the text track is always empty. (Milestone 5)
- **Render cancel and delete.** `RenderStatus` includes `cancelled`, but no UI reaches
  it. Deferred; the queue holds at most 20 jobs.
- **Agent, transcripts, motion, brand kit, templates.** Separate slices.
- **A vitest suite.** `npm test` runs vitest with zero test files and fails. The render
  path is already covered by a real end-to-end proof (`scripts/render-smoke.mjs`), so a
  unit suite adds little here.

## Changes

### 1. Unbreak the editor stylesheet

Delete the stray `.export-summary {` line at `pro/client/src/styles.css:1215`. The real
`.export-summary` rule already exists at the end of the file, added with the
ExportModal styles.

Acceptance: the editor, timeline, media panel and project cards render per the design
system; the dashboard and shell are unchanged.

### 2. Fix the browser test harness

In `pro/scripts/ui-smoke.mjs`, scroll the target clip into view before measuring it,
and do the same for the trim handle and the ruler before those interactions. Chromium
cannot deliver pointer events to an element outside the viewport.

Acceptance: `node scripts/ui-smoke.mjs` completes with every check passing, including
the clip drag, the trim handle and the split steps.

### 3. Make the badges tell the truth

- `pro/client/src/pages/DashboardPage.tsx` — the "Build pipeline" list moves
  "Real FFmpeg render & download" from `next` to `live`.
- `pro/client/src/pages/RoadmapPage.tsx` and `pro/client/src/App.tsx` — the shared
  roadmap copy no longer claims the studio has no renderer; it states what is live
  (uploads, probing, the timeline, the render) and what is not (text and motion
  burn-in, multi-track compositing).
- `pro/client/src/components/editor/ExportModal.tsx` — the note keeps its existing
  warning that text and motion layers are not burned in, and gains the multi-track
  limitation, so nothing in the UI overstates the renderer.

Acceptance: no surface claims a capability the renderer does not have, and no surface
claims a capability is missing when it is not.

### 4. Prove the export path in the browser

Walk the real path in a browser and capture screenshots: upload a source, see it on
the timeline, open Export, queue a render, watch the progress bar advance, download the
MP4 and play it back in the browser.

Acceptance: the downloaded file opens in the browser's video player with the expected
duration and dimensions.

### 5. Make the render checks first-class

`scripts/render-smoke.mjs` is not referenced by any npm script, so the strongest proof
in the repo is invisible to `npm run`. Add it as `npm run render:smoke`.

Acceptance: `npm run render:smoke` runs the existing 19 checks and passes.

### 6. Correct the Renders page empty state

The page itself is already honest and complete: it lists every render across all
projects, names the owning project, shows live progress and offers an inline preview
plus a download. The one inaccuracy is the empty state, which says "Open a project and
use Export to queue a real FFmpeg render" on a page that lists renders from every
project. Reword it to say that no export has been requested yet.

### 7. Test data hygiene

`scripts/ui-smoke.mjs` creates a project and never deletes it; `scripts/render-smoke.mjs`
already cleans up after itself. Make the browser script delete its project at the end,
the same way.

With the user's approval, purge the 25 leftover smoke-test projects and their 32
source files from `pro/data/`, and the render job created while investigating. The
user's own project ("Untitled film") is kept.

Acceptance: the studio opens on a clean dashboard with the real project only; running
`npm run ui` leaves no new projects behind.

## Data flow (unchanged)

```
Editor ──POST /api/projects/:id/renders──▶ job row (queued)
                                             │
                          in-process queue ──┘  (one render at a time)
                                             │
                    ffmpeg segment per clip ─▶ concat ─▶ audio mix
                                             │
                                    ffprobe verify (duration, size)
                                             │
                        row (succeeded) + file under data/renders
                                             │
       GET /api/renders/:id/file ──▶ range-capable inline playback / download
```

## Error handling (unchanged)

| Condition | Result |
|---|---|
| Empty timeline | 400 `empty_timeline` |
| Clip overlaps another on the same track | 409 conflict |
| Clip extends past the end of its source | 400 with `maxDurationMs` |
| More than one visual track | 400 `multiple_video_tracks` |
| Queue holds 20 jobs | 429 `render_queue_full` |
| More than 6 render requests per minute | 429 rate limited |
| FFmpeg fails | job `failed` with the error and log, partial file deleted, audit event |
| Server restarts mid-render | in-flight jobs marked `failed` on boot |

## Verification

| Check | Command | Expectation |
|---|---|---|
| API smoke | `node scripts/smoke.mjs` | all checks pass |
| Browser smoke | `node scripts/ui-smoke.mjs` | all checks pass, no timeout |
| Render smoke | `npm run render:smoke` | 19 checks pass, real MP4 probed |
| Types | `npm run typecheck` | clean |
| Manual | browser | export → progress → download → playback, screenshots |

## Risk

- Deleting the stray CSS rule restores every rule after line 1215 at once. Any rule
  that was quietly broken by nesting will now apply. The editor is the only surface
  affected, and it is verified by screenshot.
- Purging the smoke projects is irreversible for those test files, which are also
  regenerated by `npm run fixtures`. The user's own project is excluded.
