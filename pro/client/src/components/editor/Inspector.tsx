import { useEffect, useState } from "react";
import {
  Bot,
  KeyRound,
  Plus,
  Scissors,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wand2,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  formatBytes,
  formatDuration,
  formatTimecode,
  type Clip,
  type MediaAsset,
  type ProjectDetail,
  type Track,
} from "@ai-video-agent-studio/shared";
import { api } from "../../api";
import { resolutionLabel } from "../../lib/format";

interface ClipPatch {
  startMs?: number;
  durationMs?: number;
  inMs?: number;
  trackId?: string;
}

interface InspectorProps {
  project: ProjectDetail;
  asset: MediaAsset | null;
  clip: Clip | null;
  playheadMs: number;
  canSplit: boolean;
  onUpdateClip: (patch: ClipPatch) => void;
  onSplit: () => void;
  onDeleteClip: () => void;
  onAddToTimeline: () => void;
  onDeleteAsset: (asset: MediaAsset) => void;
  onClose: () => void;
}

type InspectorTab = "inspector" | "agent";

const AGENT_TOOLS = [
  "timeline.trim / split / move / delete",
  "timeline.add_title with keyframes",
  "transcript.search and caption burn-in",
  "timeline.remove_silence from real VAD",
  "render.create with a validated plan",
];

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="kv-row">
      <dt>{label}</dt>
      <dd className="mono">{value}</dd>
    </div>
  );
}

const TRACK_ACCEPTS: Record<string, string[]> = {
  video: ["video", "overlay"],
  image: ["video", "overlay"],
  audio: ["audio"],
  text: ["text"],
  subtitle: ["subtitle"],
};

function seconds(value: number): string {
  return (value / 1000).toFixed(2);
}

function ClipEditor({
  clip,
  asset,
  tracks,
  canSplit,
  onUpdateClip,
  onSplit,
  onDeleteClip,
}: {
  clip: Clip;
  asset: MediaAsset | null;
  tracks: Track[];
  canSplit: boolean;
  onUpdateClip: (patch: ClipPatch) => void;
  onSplit: () => void;
  onDeleteClip: () => void;
}) {
  const [start, setStart] = useState(seconds(clip.startMs));
  const [length, setLength] = useState(seconds(clip.durationMs));
  const [inPoint, setInPoint] = useState(seconds(clip.inMs));

  useEffect(() => {
    setStart(seconds(clip.startMs));
    setLength(seconds(clip.durationMs));
    setInPoint(seconds(clip.inMs));
  }, [clip.id, clip.startMs, clip.durationMs, clip.inMs]);

  const isImage = asset?.kind === "image";
  const compatible = tracks.filter((track) => TRACK_ACCEPTS[clip.kind]?.includes(track.kind));

  const apply = () => {
    const startMs = Math.round(Number(start) * 1000);
    const durationMs = Math.round(Number(length) * 1000);
    const inMs = Math.round(Number(inPoint) * 1000);
    if (!Number.isFinite(startMs) || !Number.isFinite(durationMs)) return;
    onUpdateClip({
      startMs: Math.max(0, startMs),
      durationMs: Math.max(100, durationMs),
      inMs: isImage ? 0 : Math.max(0, inMs),
    });
  };

  return (
    <div className="clip-editor">
      <div className="clip-fields">
        <label className="clip-field">
          <span>Start</span>
          <input
            className="input mono"
            type="number"
            min={0}
            step={0.1}
            value={start}
            onChange={(event) => setStart(event.target.value)}
            onBlur={apply}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                apply();
              }
            }}
            aria-label="Clip start in seconds"
          />
        </label>
        <label className="clip-field">
          <span>Length</span>
          <input
            className="input mono"
            type="number"
            min={0.1}
            step={0.1}
            value={length}
            onChange={(event) => setLength(event.target.value)}
            onBlur={apply}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                apply();
              }
            }}
            aria-label="Clip length in seconds"
          />
        </label>
        <label className="clip-field">
          <span>Source in</span>
          <input
            className="input mono"
            type="number"
            min={0}
            step={0.1}
            value={inPoint}
            disabled={isImage}
            onChange={(event) => setInPoint(event.target.value)}
            onBlur={apply}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                apply();
              }
            }}
            aria-label="Source in point in seconds"
          />
        </label>
      </div>

      {compatible.length > 1 ? (
        <label className="clip-field clip-track-select">
          <span>Track</span>
          <select
            className="input"
            value={clip.trackId}
            onChange={(event) => onUpdateClip({ trackId: event.target.value })}
            aria-label="Move clip to track"
          >
            {compatible.map((track) => (
              <option key={track.id} value={track.id}>
                {track.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className="clip-actions">
        <button type="button" className="btn btn-quiet" onClick={apply}>
          Apply
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={onSplit}
          disabled={!canSplit}
          title={
            canSplit
              ? "Split at the playhead (S)"
              : "Move the playhead inside the clip to split"
          }
        >
          <Scissors size={14} /> Split
        </button>
        <button type="button" className="btn btn-danger-ghost" onClick={onDeleteClip}>
          <Trash2 size={14} /> Delete
        </button>
      </div>
      <p className="inspector-hint">
        Drag the clip to move it, drag its edges to trim, double-click to split.
        Changes are saved immediately.
      </p>
    </div>
  );
}

export function Inspector({
  project,
  asset,
  clip,
  canSplit,
  onUpdateClip,
  onSplit,
  onDeleteClip,
  onAddToTimeline,
  onDeleteAsset,
  onClose,
}: InspectorProps) {
  const [tab, setTab] = useState<InspectorTab>("inspector");
  const [providerConfigured, setProviderConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getHealth()
      .then((health) => {
        if (!cancelled) setProviderConfigured(health.provider.configured);
      })
      .catch(() => {
        if (!cancelled) setProviderConfigured(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const trackName = clip
    ? project.tracks.find((track) => track.id === clip.trackId)?.name ?? "Track"
    : null;

  return (
    <aside className="inspector" aria-label="Inspector">
      <header className="panel-header">
        <span>Inspector</span>
        <button
          type="button"
          className="icon-button panel-close"
          onClick={onClose}
          aria-label="Close inspector"
        >
          <X size={16} />
        </button>
      </header>

      <div className="panel-tabs" role="tablist" aria-label="Inspector sections">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "inspector"}
          className={`panel-tab ${tab === "inspector" ? "active" : ""}`}
          onClick={() => setTab("inspector")}
        >
          Details
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "agent"}
          className={`panel-tab ${tab === "agent" ? "active" : ""}`}
          onClick={() => setTab("agent")}
        >
          <Bot size={13} /> Agent
        </button>
      </div>

      <div className="inspector-scroll">
        {tab === "inspector" ? (
          <>
            <section className="inspector-section">
              <div className="section-kicker">
                <span>Selection</span>
                {asset ? <span className="chip mono">{asset.kind}</span> : null}
              </div>
              {asset ? (
                <>
                  <h3 className="inspector-title" title={asset.originalName}>
                    {asset.originalName}
                  </h3>
                  <dl className="kv">
                    {asset.durationMs ? (
                      <Row label="Duration" value={formatDuration(asset.durationMs)} />
                    ) : null}
                    {asset.width && asset.height ? (
                      <Row
                        label="Resolution"
                        value={`${asset.width}×${asset.height} · ${resolutionLabel(asset.width, asset.height)}`}
                      />
                    ) : null}
                    {asset.kind !== "image" && asset.fps ? (
                      <Row label="Frame rate" value={`${asset.fps.toFixed(3)} fps`} />
                    ) : null}
                    {asset.videoCodec ? <Row label="Video" value={asset.videoCodec} /> : null}
                    {asset.audioCodec ? <Row label="Audio" value={asset.audioCodec} /> : null}
                    {asset.sampleRate ? (
                      <Row
                        label="Audio format"
                        value={`${asset.sampleRate / 1000} kHz · ${asset.channels ?? 1} ch`}
                      />
                    ) : null}
                    {asset.bitrate ? (
                      <Row label="Bitrate" value={`${(asset.bitrate / 1_000_000).toFixed(2)} Mbps`} />
                    ) : null}
                    <Row label="File size" value={formatBytes(asset.sizeBytes)} />
                    <Row
                      label="Added"
                      value={new Date(asset.createdAt).toLocaleString(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    />
                  </dl>
                  <button
                    type="button"
                    className="btn btn-danger-ghost btn-block"
                    onClick={() => onDeleteAsset(asset)}
                  >
                    <Trash2 size={14} /> Delete source and its clips
                  </button>
                  {!clip ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-block clip-add"
                      onClick={onAddToTimeline}
                    >
                      <Plus size={14} /> Add to timeline
                    </button>
                  ) : null}
                </>
              ) : (
                <p className="inspector-empty">
                  Select a source in the media panel to inspect the metadata
                  FFprobe read from the file.
                </p>
              )}
            </section>

            {clip ? (
              <section className="inspector-section">
                <div className="section-kicker">
                  <span>Timeline clip</span>
                  <span className="chip mono">{trackName}</span>
                </div>
                <dl className="kv">
                  <Row label="Starts at" value={formatTimecode(clip.startMs, project.fps)} />
                  <Row label="Length" value={formatDuration(clip.durationMs)} />
                  <Row label="Source in" value={formatTimecode(clip.inMs, project.fps)} />
                  <Row
                    label="Source out"
                    value={
                      clip.outMs !== null
                        ? formatTimecode(clip.outMs, project.fps)
                        : formatTimecode(clip.inMs + clip.durationMs, project.fps)
                    }
                  />
                  <Row label="Stored as" value={clip.id.slice(0, 8)} />
                </dl>
                <ClipEditor
                  clip={clip}
                  asset={asset}
                  tracks={project.tracks}
                  canSplit={canSplit}
                  onUpdateClip={onUpdateClip}
                  onSplit={onSplit}
                  onDeleteClip={onDeleteClip}
                />
              </section>
            ) : null}

            <section className="inspector-section">
              <div className="section-kicker">
                <span>Project</span>
              </div>
              <dl className="kv">
                <Row label="Canvas" value={`${project.width}×${project.height}`} />
                <Row label="Frame rate" value={`${project.fps} fps`} />
                <Row label="Sources" value={String(project.assets.length)} />
                <Row label="Timeline" value={formatDuration(project.durationMs)} />
                <Row label="Tracks" value={String(project.tracks.length)} />
              </dl>
            </section>
          </>
        ) : (
          <section className="inspector-section agent-section">
            <div className="agent-status">
              <span
                className={`engine-dot ${providerConfigured ? "dot-ok" : "dot-idle"}`}
                aria-hidden="true"
              />
              <div>
                <strong>
                  {providerConfigured === null
                    ? "Checking provider"
                    : providerConfigured
                      ? "OpenCode Zen connected"
                      : "No model provider"}
                </strong>
                <p>
                  {providerConfigured
                    ? "The agent endpoint is configured. Tool execution unlocks in Milestone 6."
                    : "Add OPENCODE_API_KEY to Platform → Secrets to enable the editing agent."}
                </p>
              </div>
            </div>

            <div className="agent-block">
              <h4>
                <Wand2 size={14} /> What the agent will operate
              </h4>
              <ul className="tool-list">
                {AGENT_TOOLS.map((tool) => (
                  <li key={tool}>
                    <Sparkles size={12} aria-hidden="true" />
                    <span className="mono">{tool}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="agent-block">
              <h4>
                <ShieldCheck size={14} /> Guardrails, by design
              </h4>
              <ul className="guardrail-list">
                <li>Zod-validated tool calls, never shell commands.</li>
                <li>Destructive edits require a visible plan and approval.</li>
                <li>Provider calls are explicit; nothing is sent silently.</li>
              </ul>
            </div>

            <div className="agent-block config-block">
              <h4>
                <KeyRound size={14} /> Provider setup
              </h4>
              <pre className="code-block mono">OPENCODE_API_KEY=••••••••••••</pre>
              <p className="inspector-hint">
                Create a key at opencode.ai/auth, then add it under Platform →
                Secrets or in <code>server/.env</code>. The key never reaches the
                browser.
              </p>
            </div>

            <span className="soon-chip">
              <Bot size={12} /> Agent lands in Milestone 6
            </span>
          </section>
        )}
      </div>
    </aside>
  );
}
