import { useEffect, useRef, useState, type RefObject } from "react";
import {
  AudioLines,
  FileText,
  Film,
  Image as ImageIcon,
  Loader2,
  Play,
  Upload,
} from "lucide-react";
import {
  formatBytes,
  formatDuration,
  formatTimecode,
  type Clip,
  type MediaAsset,
} from "@ai-video-agent-studio/shared";
import { getSubtitleText, getWaveform } from "../../api";
import { clockLabel, resolutionLabel } from "../../lib/format";

interface PreviewStageProps {
  asset: MediaAsset | null;
  selectedClip: Clip | null;
  fps: number;
  playheadMs: number;
  mediaRef: RefObject<HTMLMediaElement | null>;
  onTimeUpdate: (ms: number) => void;
  onPickFiles: () => void;
}

function Waveform({ asset }: { asset: MediaAsset }) {
  const [peaks, setPeaks] = useState<number[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPeaks(null);
    void getWaveform(asset.id).then((data) => {
      if (!cancelled) setPeaks(data?.peaks ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [asset.id]);

  if (peaks === null) {
    return (
      <div className="audio-wave loading">
        <Loader2 size={18} className="spin" />
        <span>Reading waveform</span>
      </div>
    );
  }
  if (peaks.length === 0) {
    return (
      <div className="audio-wave empty">
        <AudioLines size={18} />
        <span>Waveform unavailable</span>
      </div>
    );
  }
  const bars = 96;
  const sampled = Array.from({ length: bars }, (_, index) => {
    const from = Math.floor((index / bars) * peaks.length);
    const to = Math.max(from + 1, Math.floor(((index + 1) / bars) * peaks.length));
    let max = 0;
    for (let i = from; i < to && i < peaks.length; i += 1) {
      if (peaks[i] > max) max = peaks[i];
    }
    return Math.max(0.04, max);
  });
  return (
    <div className="audio-wave" aria-hidden="true">
      {sampled.map((peak, index) => (
        <span key={index} style={{ height: `${Math.round(peak * 100)}%` }} />
      ))}
    </div>
  );
}

function SubtitlePreview({ asset }: { asset: MediaAsset }) {
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setText(null);
    setFailed(false);
    void getSubtitleText(asset.id)
      .then((value) => {
        if (!cancelled) setText(value.slice(0, 8000));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [asset.id]);

  if (failed) return <p className="inline-error">Could not read this subtitle file.</p>;
  if (text === null) return <Loader2 size={20} className="spin" />;
  return <pre className="subtitle-preview">{text}</pre>;
}

export function PreviewStage({
  asset,
  selectedClip,
  fps,
  playheadMs,
  mediaRef,
  onTimeUpdate,
  onPickFiles,
}: PreviewStageProps) {
  const stageRef = useRef<HTMLDivElement>(null);

  const bindMedia = (element: HTMLMediaElement | null) => {
    mediaRef.current = element;
  };

  const seekToIn = (element: HTMLMediaElement) => {
    if (selectedClip && selectedClip.assetId === asset?.id) {
      element.currentTime = Math.max(0, selectedClip.inMs / 1000);
    }
  };

  const handleTime = (element: HTMLMediaElement) => {
    if (!asset) return;
    const base =
      selectedClip && selectedClip.assetId === asset.id
        ? selectedClip.startMs - selectedClip.inMs
        : 0;
    onTimeUpdate(Math.max(0, Math.round(element.currentTime * 1000 + base)));
  };

  return (
    <section className="preview-column" aria-label="Preview">
      <div className="preview-header">
        <div className="preview-title">
          <span className="preview-label">Source monitor</span>
          {asset ? (
            <span className="preview-name" title={asset.originalName}>
              {asset.originalName}
            </span>
          ) : (
            <span className="preview-name muted">No source selected</span>
          )}
        </div>
        {asset ? (
          <div className="preview-chips mono">
            <span className="chip">{asset.kind}</span>
            {asset.width && asset.height ? (
              <span className="chip">
                {resolutionLabel(asset.width, asset.height)}
              </span>
            ) : null}
            {asset.kind !== "image" && asset.fps ? (
              <span className="chip">{asset.fps.toFixed(2)} fps</span>
            ) : null}
            <span className="chip">{formatBytes(asset.sizeBytes)}</span>
          </div>
        ) : null}
      </div>

      <div className="preview-stage" ref={stageRef}>
        {!asset ? (
          <div className="preview-empty">
            <span className="empty-icon" aria-hidden="true">
              <Film size={28} />
            </span>
            <h2>Nothing on the monitor</h2>
            <p>
              Drop a real file into the media panel. CUTROOM probes it with
              FFprobe and builds a thumbnail and waveform from the actual media.
            </p>
            <button type="button" className="btn btn-primary" onClick={onPickFiles}>
              <Upload size={16} /> Bring in footage
            </button>
            <p className="preview-empty-hint mono">
              MP4 · MOV · WEBM · MP3 · WAV · JPG · PNG · SRT
            </p>
          </div>
        ) : asset.kind === "video" ? (
          <div className="video-frame">
            <span className="source-badge mono">SOURCE · UNRENDERED</span>
            <video
              key={asset.id}
              ref={bindMedia}
              src={asset.streamUrl}
              poster={asset.thumbnailUrl ?? undefined}
              controls
              playsInline
              preload="metadata"
              onLoadedMetadata={(event) => seekToIn(event.currentTarget)}
              onTimeUpdate={(event) => handleTime(event.currentTarget)}
            />
          </div>
        ) : asset.kind === "image" ? (
          <div className="image-frame">
            <span className="source-badge mono">STILL IMAGE</span>
            <img src={asset.streamUrl} alt={asset.originalName} />
          </div>
        ) : asset.kind === "audio" ? (
          <div className="audio-frame">
            <span className="audio-frame-icon" aria-hidden="true">
              <AudioLines size={26} />
            </span>
            <h2>{asset.originalName}</h2>
            <p className="mono audio-frame-meta">
              {formatDuration(asset.durationMs)} ·{" "}
              {asset.sampleRate ? `${asset.sampleRate / 1000} kHz` : "audio"} ·{" "}
              {asset.channels ?? 1} ch
            </p>
            <Waveform asset={asset} />
            <audio
              key={asset.id}
              ref={bindMedia}
              src={asset.streamUrl}
              controls
              preload="metadata"
              onLoadedMetadata={(event) => seekToIn(event.currentTarget)}
              onTimeUpdate={(event) => handleTime(event.currentTarget)}
            />
          </div>
        ) : (
          <div className="subtitle-frame">
            <span className="source-badge mono">SUBTITLE SOURCE</span>
            <SubtitlePreview asset={asset} />
          </div>
        )}
      </div>

      <footer className="preview-footer">
        <span className="preview-footer-left">
          <Play size={12} aria-hidden="true" />
          {selectedClip
            ? `Clip starts ${clockLabel(selectedClip.startMs)} · ${clockLabel(selectedClip.durationMs)} long`
            : asset
              ? "Original source · no timeline clip"
              : "Waiting for a source"}
        </span>
        <span className="preview-tc mono" aria-label="Playhead timecode">
          {formatTimecode(playheadMs, fps)}
        </span>
      </footer>
    </section>
  );
}
