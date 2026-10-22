import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  AudioLines,
  Captions,
  Eye,
  Film,
  Lock,
  Maximize2,
  Type,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";
import {
  CLIP_MIN_DURATION_MS,
  formatTimecode,
  type Clip,
  type MediaAsset,
  type Track,
  type TrackKind,
} from "@ai-video-agent-studio/shared";
import { clockLabel } from "../../lib/format";

const HEAD_WIDTH = 132;
const MAX_CLIP_MS = 6 * 60 * 60 * 1000;

type DragMode = "move" | "trim-start" | "trim-end";

interface DragState {
  mode: DragMode;
  clip: Clip;
  originX: number;
  originStart: number;
  originDuration: number;
  originIn: number;
  moved: boolean;
}

interface ClipPreview {
  clipId: string;
  startMs: number;
  durationMs: number;
  inMs: number;
  invalid: boolean;
}

export interface ClipPatch {
  startMs?: number;
  durationMs?: number;
  inMs?: number;
}

interface TimelineProps {
  tracks: Track[];
  assets: MediaAsset[];
  durationMs: number;
  fps: number;
  pxPerSecond: number;
  playheadMs: number;
  selectedClipId: string | null;
  waveforms: Record<string, number[]>;
  onSetZoom: (pxPerSecond: number) => void;
  onSeek: (ms: number) => void;
  onSelectClip: (clip: Clip) => void;
  onEditClip: (clip: Clip, patch: ClipPatch) => void;
  onSplitClip: (clip: Clip, atMs: number) => void;
}

const TRACK_ICON: Record<TrackKind, LucideIcon> = {
  video: Film,
  audio: AudioLines,
  text: Type,
  subtitle: Captions,
  overlay: Film,
};

function waveformSlice(
  peaks: number[],
  inMs: number,
  durationMs: number,
  assetDurationMs: number | null,
): number[] {
  if (peaks.length === 0) return [];
  const total = assetDurationMs && assetDurationMs > 0 ? assetDurationMs : durationMs;
  const startRatio = Math.max(0, Math.min(1, inMs / total));
  const endRatio = Math.max(startRatio, Math.min(1, (inMs + durationMs) / total));
  const from = Math.floor(startRatio * peaks.length);
  const to = Math.max(from + 1, Math.ceil(endRatio * peaks.length));
  const slice = peaks.slice(from, to);
  const bars = 64;
  return Array.from({ length: bars }, (_, index) => {
    const a = Math.floor((index / bars) * slice.length);
    const b = Math.max(a + 1, Math.floor(((index + 1) / bars) * slice.length));
    let max = 0;
    for (let i = a; i < b && i < slice.length; i += 1) {
      if (slice[i] > max) max = slice[i];
    }
    return Math.max(0.05, max);
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function Timeline({
  tracks,
  assets,
  durationMs,
  fps,
  pxPerSecond,
  playheadMs,
  selectedClipId,
  waveforms,
  onSetZoom,
  onSeek,
  onSelectClip,
  onEditClip,
  onSplitClip,
}: TimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<ClipPreview | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [preview, setPreview] = useState<ClipPreview | null>(null);

  const totalMs = Math.max(durationMs, 10_000);
  const pxPerMs = pxPerSecond / 1000;
  const contentWidth = Math.max(560, totalMs * pxPerMs + 120);

  const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  const rawStep = 76 / pxPerSecond;
  const stepSeconds = steps.find((step) => step >= rawStep) ?? 600;
  const tickCount = Math.ceil(totalMs / (stepSeconds * 1000));
  const ticks = Array.from({ length: tickCount + 1 }, (_, index) => index * stepSeconds * 1000);

  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const clipCount = tracks.reduce((sum, track) => sum + track.clips.length, 0);

  useEffect(() => {
    if (!drag) return;
    const thresholdMs = Math.max(2, 10 / pxPerMs);

    const snap = (value: number, excludeClipId: string): number => {
      let best = value;
      let bestDistance = thresholdMs;
      const consider = (point: number) => {
        const distance = Math.abs(point - value);
        if (distance <= bestDistance) {
          best = point;
          bestDistance = distance;
        }
      };
      consider(0);
      consider(playheadMs);
      for (const track of tracks) {
        for (const clip of track.clips) {
          if (clip.id === excludeClipId) continue;
          consider(clip.startMs);
          consider(clip.startMs + clip.durationMs);
        }
      }
      return best;
    };

    const othersFor = (clip: Clip): Clip[] =>
      (tracks.find((track) => track.id === clip.trackId)?.clips ?? []).filter(
        (item) => item.id !== clip.id,
      );

    const onMove = (event: PointerEvent) => {
      const dxMs = (event.clientX - drag.originX) / pxPerMs;
      if (Math.abs(event.clientX - drag.originX) > 2) drag.moved = true;
      const asset = drag.clip.assetId ? assetById.get(drag.clip.assetId) : null;
      const isMedia = Boolean(asset && asset.kind !== "image");
      const assetLimit =
        isMedia && asset?.durationMs ? Math.max(CLIP_MIN_DURATION_MS, asset.durationMs - drag.originIn) : MAX_CLIP_MS;
      const others = othersFor(drag.clip);

      let next: ClipPreview;

      if (drag.mode === "move") {
        let start = Math.max(0, drag.originStart + dxMs);
        const snappedStart = snap(start, drag.clip.id);
        const snappedEndStart = snap(start + drag.originDuration, drag.clip.id) - drag.originDuration;
        start =
          Math.abs(snappedStart - start) <= Math.abs(snappedEndStart - start)
            ? snappedStart
            : snappedEndStart;
        start = Math.max(0, start);
        const end = start + drag.originDuration;
        const invalid = others.some(
          (clip) => clip.startMs < end && clip.startMs + clip.durationMs > start,
        );
        next = {
          clipId: drag.clip.id,
          startMs: Math.round(start),
          durationMs: drag.originDuration,
          inMs: drag.originIn,
          invalid,
        };
      } else if (drag.mode === "trim-start") {
        const previousEnd = Math.max(
          0,
          ...others
            .filter((clip) => clip.startMs + clip.durationMs <= drag.originStart + 1)
            .map((clip) => clip.startMs + clip.durationMs),
        );
        const sourceFloor = isMedia ? Math.max(0, drag.originStart - drag.originIn) : 0;
        const floor = Math.max(0, previousEnd, sourceFloor);
        const ceiling = drag.originStart + drag.originDuration - CLIP_MIN_DURATION_MS;
        let start = clamp(drag.originStart + dxMs, floor, ceiling);
        start = clamp(snap(start, drag.clip.id), floor, ceiling);
        const delta = start - drag.originStart;
        next = {
          clipId: drag.clip.id,
          startMs: Math.round(start),
          durationMs: Math.round(drag.originDuration - delta),
          inMs: Math.round(isMedia ? drag.originIn + delta : 0),
          invalid: false,
        };
      } else {
        const nextStart = others
          .map((clip) => clip.startMs)
          .filter((value) => value >= drag.originStart + drag.originDuration - 1)
          .sort((a, b) => a - b)[0];
        const maxByNext = nextStart === undefined ? MAX_CLIP_MS : nextStart - drag.originStart;
        const maxDuration = Math.max(
          CLIP_MIN_DURATION_MS,
          Math.min(maxByNext, assetLimit, MAX_CLIP_MS),
        );
        let nextDuration = clamp(
          drag.originDuration + dxMs,
          CLIP_MIN_DURATION_MS,
          maxDuration,
        );
        const snappedEnd = snap(drag.originStart + nextDuration, drag.clip.id) - drag.originStart;
        nextDuration = clamp(snappedEnd, CLIP_MIN_DURATION_MS, maxDuration);
        next = {
          clipId: drag.clip.id,
          startMs: drag.originStart,
          durationMs: Math.round(nextDuration),
          inMs: drag.originIn,
          invalid: false,
        };
      }

      previewRef.current = next;
      setPreview(next);
    };

    const finish = () => {
      const next = previewRef.current;
      if (drag.moved && next) {
        if (drag.mode === "move" && next.startMs !== drag.originStart) {
          onEditClip(drag.clip, { startMs: next.startMs });
        } else if (drag.mode === "trim-start") {
          onEditClip(drag.clip, {
            startMs: next.startMs,
            durationMs: next.durationMs,
            inMs: next.inMs,
          });
        } else if (drag.mode === "trim-end" && next.durationMs !== drag.originDuration) {
          onEditClip(drag.clip, { durationMs: next.durationMs });
        }
      }
      previewRef.current = null;
      setPreview(null);
      setDrag(null);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", finish, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, [drag]);

  const beginDrag = (
    event: ReactPointerEvent<HTMLElement>,
    clip: Clip,
    mode: DragMode,
    locked: boolean,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    onSelectClip(clip);
    if (locked) return;
    setDrag({
      mode,
      clip,
      originX: event.clientX,
      originStart: clip.startMs,
      originDuration: clip.durationMs,
      originIn: clip.inMs,
      moved: false,
    });
  };

  const seekFromPointer = (event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, event.clientX - rect.left);
    const ms = Math.min(totalMs, Math.round(x / pxPerMs));
    onSeek(ms);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 5000 : 1000;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      onSeek(Math.min(totalMs, playheadMs + step));
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      onSeek(Math.max(0, playheadMs - step));
    } else if (event.key === "Home") {
      event.preventDefault();
      onSeek(0);
    } else if (event.key === "End") {
      event.preventDefault();
      onSeek(totalMs);
    }
  };

  const fit = () => {
    const element = scrollRef.current;
    if (!element) return;
    const available = element.clientWidth - HEAD_WIDTH - 140;
    const seconds = totalMs / 1000;
    const next = Math.max(6, Math.min(240, available / Math.max(1, seconds)));
    onSetZoom(Math.round(next));
  };

  return (
    <section className="timeline" aria-label="Timeline">
      <header className="timeline-toolbar">
        <div className="timeline-toolbar-left">
          <span className="timeline-title">Timeline</span>
          <span className="chip mono">{clipCount} clip{clipCount === 1 ? "" : "s"}</span>
          <span className="chip mono">{clockLabel(durationMs)}</span>
        </div>
        <div className="timeline-toolbar-right">
          <span className="timeline-tc mono">{formatTimecode(playheadMs, fps)}</span>
          <div className="zoom-group" role="group" aria-label="Timeline zoom">
            <button
              type="button"
              className="icon-button"
              onClick={() => onSetZoom(Math.max(6, Math.round(pxPerSecond / 1.4)))}
              aria-label="Zoom out"
              title="Zoom out"
            >
              <ZoomOut size={15} />
            </button>
            <span className="zoom-value mono">{Math.round(pxPerSecond)}px/s</span>
            <button
              type="button"
              className="icon-button"
              onClick={() => onSetZoom(Math.min(400, Math.round(pxPerSecond * 1.4)))}
              aria-label="Zoom in"
              title="Zoom in"
            >
              <ZoomIn size={15} />
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={fit}
              aria-label="Fit timeline to view"
              title="Fit to view"
            >
              <Maximize2 size={14} />
            </button>
          </div>
        </div>
      </header>

      <div
        className="timeline-scroll"
        ref={scrollRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        aria-label="Timeline. Use left and right arrows to move the playhead."
      >
        <div className="timeline-inner" style={{ width: HEAD_WIDTH + contentWidth }}>
          <div className="ruler-row">
            <div className="ruler-spacer" aria-hidden="true" />
            <div
              className="ruler"
              style={{ width: contentWidth }}
              onMouseDown={seekFromPointer}
            >
              {ticks.map((tick) => (
                <span
                  key={tick}
                  className="ruler-tick"
                  style={{ left: tick * pxPerMs }}
                >
                  <span className="ruler-label mono">{clockLabel(tick)}</span>
                </span>
              ))}
            </div>
          </div>

          <div className="tracks">
            {tracks.map((track) => {
              const Icon = TRACK_ICON[track.kind] ?? Film;
              return (
                <div className={`track-row track-${track.kind}`} key={track.id}>
                  <div className="track-head">
                    <span className="track-kind" aria-hidden="true">
                      <Icon size={13} />
                    </span>
                    <span className="track-name">{track.name}</span>
                    <span className="track-flags" title="Track controls arrive in a later milestone">
                      {track.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
                      {track.locked ? <Lock size={12} /> : <Eye size={12} />}
                    </span>
                  </div>
                  <div
                    className="track-lane"
                    style={{ width: contentWidth }}
                    onMouseDown={(event) => {
                      if (event.target === event.currentTarget) seekFromPointer(event);
                    }}
                  >
                    {track.clips.map((clip) => {
                      const asset = clip.assetId ? assetById.get(clip.assetId) : null;
                      const peaks = asset ? waveforms[asset.id] : undefined;
                      const selected = clip.id === selectedClipId;
                      const shown = preview?.clipId === clip.id ? preview : null;
                      const startMs = shown?.startMs ?? clip.startMs;
                      const durationMs = shown?.durationMs ?? clip.durationMs;
                      const inMs = shown?.inMs ?? clip.inMs;
                      const width = Math.max(18, durationMs * pxPerMs);
                      const bars =
                        peaks && asset
                          ? waveformSlice(peaks, inMs, durationMs, asset.durationMs)
                          : [];
                      const dragging = drag?.clip.id === clip.id && drag.moved;
                      return (
                        <button
                          type="button"
                          key={clip.id}
                          className={`clip clip-${clip.kind} ${selected ? "selected" : ""} ${
                            dragging ? "clip-dragging" : ""
                          } ${shown?.invalid ? "clip-invalid" : ""}`}
                          style={{ left: startMs * pxPerMs, width }}
                          onPointerDown={(event) =>
                            beginDrag(event, clip, "move", track.locked)
                          }
                          onClick={(event) => {
                            event.stopPropagation();
                            onSelectClip(clip);
                          }}
                          onDoubleClick={(event) => {
                            event.stopPropagation();
                            if (
                              playheadMs > clip.startMs + CLIP_MIN_DURATION_MS &&
                              playheadMs < clip.startMs + clip.durationMs - CLIP_MIN_DURATION_MS
                            ) {
                              onSplitClip(clip, playheadMs);
                            }
                          }}
                          title={`${asset?.originalName ?? clip.kind} · ${clockLabel(
                            durationMs,
                          )} — drag to move, double-click to split`}
                          aria-pressed={selected}
                        >
                          {asset?.thumbnailUrl && clip.kind === "video" ? (
                            <img className="clip-thumb" src={asset.thumbnailUrl} alt="" draggable={false} />
                          ) : null}
                          {bars.length > 0 ? (
                            <span className="clip-wave" aria-hidden="true">
                              {bars.map((peak, index) => (
                                <span key={index} style={{ height: `${Math.round(peak * 100)}%` }} />
                              ))}
                            </span>
                          ) : null}
                          <span className="clip-label">
                            {asset?.originalName ?? clip.kind}
                          </span>
                          {selected && !track.locked ? (
                            <>
                              <span
                                className="clip-trim clip-trim-start"
                                role="presentation"
                                title="Trim clip start"
                                onPointerDown={(event) =>
                                  beginDrag(event, clip, "trim-start", track.locked)
                                }
                              />
                              <span
                                className="clip-trim clip-trim-end"
                                role="presentation"
                                title="Trim clip end"
                                onPointerDown={(event) =>
                                  beginDrag(event, clip, "trim-end", track.locked)
                                }
                              />
                            </>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {clipCount === 0 ? (
            <div className="timeline-empty" style={{ left: HEAD_WIDTH }}>
              <p>
                <strong>Timeline is empty.</strong> Upload a source and it lands
                here as real, persisted clip data.
              </p>
            </div>
          ) : null}

          <div
            className="playhead"
            style={{ left: HEAD_WIDTH + playheadMs * pxPerMs }}
            aria-hidden="true"
          >
            <span className="playhead-handle" />
          </div>
        </div>
      </div>
    </section>
  );
}
