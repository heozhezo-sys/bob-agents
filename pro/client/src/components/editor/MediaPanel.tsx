import { useMemo, useState } from "react";
import {
  AudioLines,
  FileText,
  Film,
  Image as ImageIcon,
  LayoutTemplate,
  Loader2,
  Search,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  formatBytes,
  formatDuration,
  type MediaAsset,
} from "@ai-video-agent-studio/shared";
import type { EditorTab, UploadTask } from "../../types";

interface MediaPanelProps {
  assets: MediaAsset[];
  selectedAssetId: string | null;
  uploads: UploadTask[];
  tab: EditorTab;
  onTabChange: (tab: EditorTab) => void;
  onSelect: (assetId: string) => void;
  onPickFiles: () => void;
  onUploadFiles: (files: File[]) => void;
  onCancelUpload: (taskId: string) => void;
  onDeleteAsset: (asset: MediaAsset) => void;
  onClose: () => void;
}

const TABS: Array<{ id: EditorTab; label: string }> = [
  { id: "media", label: "Media" },
  { id: "text", label: "Text" },
  { id: "audio", label: "Audio" },
  { id: "templates", label: "Templates" },
];

function KindIcon({ kind }: { kind: MediaAsset["kind"] }) {
  if (kind === "audio") return <AudioLines size={18} aria-hidden="true" />;
  if (kind === "image") return <ImageIcon size={18} aria-hidden="true" />;
  if (kind === "subtitle") return <FileText size={18} aria-hidden="true" />;
  return <Film size={18} aria-hidden="true" />;
}

export function MediaPanel({
  assets,
  selectedAssetId,
  uploads,
  tab,
  onTabChange,
  onSelect,
  onPickFiles,
  onUploadFiles,
  onCancelUpload,
  onDeleteAsset,
  onClose,
}: MediaPanelProps) {
  const [query, setQuery] = useState("");
  const [dragging, setDragging] = useState(false);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let scoped = assets;
    if (tab === "audio") scoped = assets.filter((asset) => asset.kind === "audio");
    if (tab === "text") scoped = assets.filter((asset) => asset.kind === "subtitle");
    if (tab === "templates") return [];
    if (!q) return scoped;
    return scoped.filter((asset) => asset.originalName.toLowerCase().includes(q));
  }, [assets, query, tab]);

  return (
    <aside className="media-panel" aria-label="Media library">
      <header className="panel-header">
        <span>Sources</span>
        <div className="panel-header-actions">
          <button
            type="button"
            className="icon-button"
            onClick={onPickFiles}
            aria-label="Upload media"
            title="Upload media"
          >
            <Upload size={15} />
          </button>
          <button
            type="button"
            className="icon-button panel-close"
            onClick={onClose}
            aria-label="Close media panel"
          >
            <X size={16} />
          </button>
        </div>
      </header>

      <div className="panel-tabs" role="tablist" aria-label="Media panel sections">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={`panel-tab ${tab === item.id ? "active" : ""}`}
            onClick={() => onTabChange(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab !== "templates" ? (
        <>
          <div
            className={`dropzone ${dragging ? "dragging" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              const files = Array.from(event.dataTransfer.files ?? []);
              if (files.length > 0) onUploadFiles(files);
            }}
          >
            <span className="dropzone-icon" aria-hidden="true">
              <Upload size={17} />
            </span>
            <p>
              <strong>Drop footage</strong> or{" "}
              <button type="button" className="link-button" onClick={onPickFiles}>
                browse
              </button>
            </p>
            <p className="dropzone-hint">
              MP4 · MOV · WebM · MP3 · WAV · M4A · JPG · PNG · SRT/VTT — up to 2 GB
            </p>
          </div>

          <label className="search-field media-search">
            <Search size={14} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter sources"
              aria-label="Filter sources"
            />
          </label>
        </>
      ) : null}

      <div className="media-scroll">
        {tab === "templates" ? (
          <div className="panel-note-block">
            <span className="empty-icon small" aria-hidden="true">
              <LayoutTemplate size={20} />
            </span>
            <h3>Motion presets arrive in M5</h3>
            <p>
              The keyframe model and canvas preview are next. Planned presets:
              lower third, fade-up title, karaoke caption, pop-on word, and a
              slow push-in.
            </p>
            <span className="soon-chip">
              <Sparkles size={12} /> Not wired yet
            </span>
          </div>
        ) : visible.length === 0 ? (
          <div className="media-empty">
            <KindIcon kind={tab === "audio" ? "audio" : tab === "text" ? "subtitle" : "video"} />
            <p>
              {tab === "audio"
                ? "No audio sources yet. Drop a music bed or voice file."
                : tab === "text"
                  ? "No subtitle files yet. Upload an SRT or VTT, or transcribe in M4."
                  : assets.length === 0
                    ? "No sources yet. Drop a video to begin."
                    : "Nothing matches that filter."}
            </p>
          </div>
        ) : (
          <ul className="asset-list">
            {visible.map((asset) => {
              const selected = asset.id === selectedAssetId;
              return (
                <li key={asset.id} className={`asset-row ${selected ? "selected" : ""}`}>
                  <button
                    type="button"
                    className="asset-main"
                    onClick={() => onSelect(asset.id)}
                    aria-pressed={selected}
                  >
                    <span className="asset-thumb" aria-hidden="true">
                      {asset.thumbnailUrl ? (
                        <img src={asset.thumbnailUrl} alt="" loading="lazy" />
                      ) : (
                        <KindIcon kind={asset.kind} />
                      )}
                    </span>
                    <span className="asset-info">
                      <span className="asset-name" title={asset.originalName}>
                        {asset.originalName}
                      </span>
                      <span className="asset-meta mono">
                        {formatBytes(asset.sizeBytes)}
                        {asset.durationMs ? ` · ${formatDuration(asset.durationMs)}` : ""}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="asset-delete"
                    onClick={() => onDeleteAsset(asset)}
                    aria-label={`Delete ${asset.originalName}`}
                    title="Delete source"
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {uploads.length > 0 ? (
          <div className="upload-tasks" aria-live="polite">
            {uploads.map((task) => (
              <div key={task.id} className={`upload-task upload-${task.status}`}>
                <div className="upload-task-head">
                  <span className="upload-name" title={task.name}>
                    {task.name}
                  </span>
                  <span className="upload-state mono">
                    {task.status === "processing" ? (
                      <>
                        <Loader2 size={11} className="spin" /> inspecting
                      </>
                    ) : task.status === "done" ? (
                      "added"
                    ) : task.status === "error" ? (
                      "failed"
                    ) : (
                      `${task.progress}%`
                    )}
                  </span>
                </div>
                <div className="progress" aria-hidden="true">
                  <span style={{ width: `${task.progress}%` }} />
                </div>
                {task.error ? <p className="upload-error">{task.error}</p> : null}
                {task.status === "uploading" ? (
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => onCancelUpload(task.id)}
                  >
                    Cancel upload
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <footer className="panel-footer mono">
        {assets.length} source{assets.length === 1 ? "" : "s"} · stored locally
      </footer>
    </aside>
  );
}
