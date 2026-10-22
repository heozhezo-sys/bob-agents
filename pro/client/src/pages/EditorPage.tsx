import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Check,
  Download,
  Loader2,
  PanelLeft,
  PanelRight,
  Trash2,
  Upload,
} from "lucide-react";
import {
  MAX_UPLOAD_BYTES,
  formatDuration,
  formatTimecode,
  type Clip,
  type MediaAsset,
  type ProjectDetail,
} from "@ai-video-agent-studio/shared";
import { api, ApiError, uploadAsset } from "../api";
import { MediaPanel } from "../components/editor/MediaPanel";
import { PreviewStage } from "../components/editor/PreviewStage";
import { Timeline, type ClipPatch } from "../components/editor/Timeline";
import { Inspector } from "../components/editor/Inspector";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toast";
import { useWaveforms } from "../hooks/useWaveforms";
import { aspectRatioLabel, resolutionLabel } from "../lib/format";
import type { EditorTab, SaveState, UploadTask } from "../types";

type MobilePanel = "none" | "media" | "inspector";

export function EditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [uploads, setUploads] = useState<UploadTask[]>([]);
  const [tab, setTab] = useState<EditorTab>("media");
  const [pxPerSecond, setPxPerSecond] = useState(64);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("none");
  const [deleteTarget, setDeleteTarget] = useState<MediaAsset | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");

  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllers = useRef(new Map<string, AbortController>());

  const waveforms = useWaveforms(project?.assets ?? []);

  const allClips = useMemo(
    () => project?.tracks.flatMap((track) => track.clips) ?? [],
    [project],
  );
  const selectedAsset = useMemo(
    () => project?.assets.find((asset) => asset.id === selectedAssetId) ?? null,
    [project, selectedAssetId],
  );
  const selectedClip = useMemo(
    () => allClips.find((clip) => clip.id === selectedClipId) ?? null,
    [allClips, selectedClipId],
  );

  const load = useCallback(
    async (initial: boolean) => {
      if (!id) return;
      try {
        const data = await api.getProject(id);
        setProject(data.project);
        setTitleDraft(data.project.name);
        setError(null);
        const clips = data.project.tracks.flatMap((track) => track.clips);
        const firstClip = clips.find((clip) => clip.assetId) ?? null;
        setSelectedAssetId((current) => {
          if (current && data.project.assets.some((asset) => asset.id === current)) {
            return current;
          }
          return firstClip?.assetId ?? data.project.assets[0]?.id ?? null;
        });
        setSelectedClipId((current) => {
          if (current && clips.some((clip) => clip.id === current)) return current;
          return firstClip?.id ?? null;
        });
        if (firstClip) {
          setPlayheadMs((current) => (current === 0 ? firstClip.startMs : current));
        }
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Could not load the project");
      } finally {
        if (initial) setLoading(false);
      }
    },
    [id],
  );

  useEffect(() => {
    setLoading(true);
    setSelectedClipId(null);
    setPlayheadMs(0);
    setSelectedAssetId(null);
    void load(true);
  }, [load]);

  useEffect(() => {
    const controllers = abortControllers.current;
    return () => {
      for (const controller of controllers.values()) controller.abort();
    };
  }, []);

  useEffect(() => {
    if (mobilePanel === "none") return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setMobilePanel("none");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobilePanel]);

  const commitTitle = async () => {
    if (!project) return;
    const trimmed = titleDraft.trim();
    if (!trimmed) {
      setTitleDraft(project.name);
      return;
    }
    if (trimmed === project.name) {
      setSaveState("idle");
      return;
    }
    setSaveState("saving");
    try {
      const data = await api.updateProject(project.id, { name: trimmed });
      setProject(data.project);
      setTitleDraft(data.project.name);
      setSaveState("saved");
      toast("Project renamed", "success");
      window.setTimeout(() => setSaveState("idle"), 2000);
    } catch (err) {
      setSaveState("error");
      setTitleDraft(project.name);
      toast(err instanceof ApiError ? err.message : "Could not rename the project", "error");
    }
  };

  const selectAsset = (assetId: string) => {
    setSelectedAssetId(assetId);
    const clip = allClips.find((item) => item.assetId === assetId);
    setSelectedClipId(clip?.id ?? null);
    if (clip) {
      setPlayheadMs(clip.startMs);
      if (mediaRef.current) {
        mediaRef.current.currentTime = Math.max(0, clip.inMs / 1000);
      }
    }
    setMobilePanel("none");
  };

  const selectClip = (clip: Clip) => {
    setSelectedClipId(clip.id);
    if (clip.assetId) setSelectedAssetId(clip.assetId);
    setPlayheadMs(clip.startMs);
    if (mediaRef.current) {
      mediaRef.current.currentTime = Math.max(0, clip.inMs / 1000);
    }
  };

  const seekTo = (ms: number) => {
    if (!project) return;
    const total = Math.max(project.durationMs, 10_000);
    const clamped = Math.max(0, Math.min(ms, total));
    setPlayheadMs(clamped);
    const clip = allClips.find(
      (item) => item.startMs <= clamped && clamped < item.startMs + item.durationMs,
    );
    if (clip) {
      setSelectedClipId(clip.id);
      if (clip.assetId) setSelectedAssetId(clip.assetId);
      if (mediaRef.current) {
        mediaRef.current.currentTime = (clip.inMs + (clamped - clip.startMs)) / 1000;
      }
    }
  };

  const openFilePicker = () => fileInputRef.current?.click();

  const handleFiles = async (files: File[]) => {
    if (!project || files.length === 0) return;
    for (const file of files) {
      if (file.size > MAX_UPLOAD_BYTES) {
        toast(`${file.name} is larger than the 2 GB limit`, "error");
        continue;
      }
      const taskId =
        typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setUploads((current) => [
        ...current,
        { id: taskId, name: file.name, progress: 0, status: "uploading" },
      ]);
      const controller = new AbortController();
      abortControllers.current.set(taskId, controller);
      try {
        const asset = await uploadAsset(
          project.id,
          file,
          (percent) => {
            setUploads((current) =>
              current.map((task) =>
                task.id === taskId
                  ? {
                      ...task,
                      progress: percent,
                      status: percent >= 100 ? "processing" : "uploading",
                    }
                  : task,
              ),
            );
          },
          controller.signal,
        );
        const fresh = await api.getProject(project.id);
        setProject(fresh.project);
        setSelectedAssetId(asset.id);
        const newClip = fresh.project.tracks
          .flatMap((track) => track.clips)
          .find((clip) => clip.assetId === asset.id);
        setSelectedClipId(newClip?.id ?? null);
        if (newClip) setPlayheadMs(newClip.startMs);
        setUploads((current) =>
          current.map((task) =>
            task.id === taskId ? { ...task, progress: 100, status: "done" } : task,
          ),
        );
        toast(
          `${asset.originalName} added${asset.durationMs ? ` · ${formatDuration(asset.durationMs)}` : ""}`,
          "success",
        );
        window.setTimeout(() => {
          setUploads((current) => current.filter((task) => task.id !== taskId));
        }, 2500);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          setUploads((current) => current.filter((task) => task.id !== taskId));
          toast(`Upload of ${file.name} cancelled`, "info");
        } else {
          const message =
            err instanceof ApiError ? err.message : "The upload failed before it finished";
          setUploads((current) =>
            current.map((task) =>
              task.id === taskId ? { ...task, status: "error", error: message } : task,
            ),
          );
          toast(message, "error");
        }
      } finally {
        abortControllers.current.delete(taskId);
      }
    }
  };

  const cancelUpload = (taskId: string) => {
    abortControllers.current.get(taskId)?.abort();
  };

  const applyClipPatch = async (clip: Clip, patch: ClipPatch) => {
    if (!project) return;
    try {
      const data = await api.updateClip(project.id, clip.id, patch);
      setProject(data.project);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not update the clip", "error");
      try {
        const fresh = await api.getProject(project.id);
        setProject(fresh.project);
      } catch {
        // The toast already explains the failure; keep the last good state.
      }
    }
  };

  const splitClip = async (clip: Clip, atMs: number) => {
    if (!project) return;
    if (atMs <= clip.startMs + 100 || atMs >= clip.startMs + clip.durationMs - 100) {
      toast("Move the playhead at least 0.1s inside the clip to split it", "info");
      return;
    }
    try {
      const data = await api.splitClip(project.id, clip.id, Math.round(atMs));
      setProject(data.project);
      const freshClips = data.project.tracks.flatMap((track) => track.clips);
      const newClip = freshClips.find(
        (item) => item.trackId === clip.trackId && item.startMs === Math.round(atMs),
      );
      if (newClip) setSelectedClipId(newClip.id);
      setPlayheadMs(Math.round(atMs));
      toast(`Split at ${formatTimecode(Math.round(atMs), project.fps)}`, "success");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not split the clip", "error");
    }
  };

  const deleteClip = async (clip: Clip) => {
    if (!project) return;
    try {
      const data = await api.deleteClip(project.id, clip.id);
      setProject(data.project);
      if (selectedClipId === clip.id) setSelectedClipId(null);
      toast("Clip removed from the timeline", "success");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not delete the clip", "error");
    }
  };

  const addAssetToTimeline = async (asset: MediaAsset) => {
    if (!project) return;
    const existingIds = new Set(allClips.map((clip) => clip.id));
    try {
      const data = await api.addClip(project.id, { assetId: asset.id });
      setProject(data.project);
      const newClip = data.project.tracks
        .flatMap((track) => track.clips)
        .find((clip) => !existingIds.has(clip.id));
      if (newClip) {
        setSelectedClipId(newClip.id);
        setSelectedAssetId(asset.id);
        setPlayheadMs(newClip.startMs);
      }
      toast(`${asset.originalName} added to the timeline`, "success");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not add the source", "error");
    }
  };

  const confirmDeleteAsset = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.deleteAsset(deleteTarget.id);
      const fresh = await api.getProject(project!.id);
      setProject(fresh.project);
      if (selectedAssetId === deleteTarget.id) {
        const nextClip = fresh.project.tracks.flatMap((track) => track.clips)[0] ?? null;
        setSelectedAssetId(nextClip?.assetId ?? fresh.project.assets[0]?.id ?? null);
        setSelectedClipId(nextClip?.id ?? null);
        if (nextClip) setPlayheadMs(nextClip.startMs);
      }
      toast(`Deleted ${deleteTarget.originalName}`, "success");
      setDeleteTarget(null);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not delete the source", "error");
    } finally {
      setDeleting(false);
    }
  };

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (document.querySelector("dialog[open]")) return;

      if (event.code === "Space") {
        if (target?.closest('button, a, [role="button"]')) return;
        const media = mediaRef.current;
        if (!media) return;
        event.preventDefault();
        if (media.paused) void media.play().catch(() => undefined);
        else media.pause();
        return;
      }

      if (!selectedClip || !project) return;
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        void deleteClip(selectedClip);
      } else if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        void splitClip(selectedClip, playheadMs);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedClip, playheadMs, project]);

  if (loading) {
    return (
      <div className="editor-loading">
        <Loader2 size={22} className="spin" />
        <span>Loading project</span>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="editor-loading">
        <p className="inline-error" role="alert">{error ?? "Project not found"}</p>
        <div className="editor-error-actions">
          <button type="button" className="btn btn-ghost" onClick={() => navigate("/projects")}>
            <ArrowLeft size={15} /> Back to projects
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void load(true)}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="editor">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        accept="video/*,audio/*,image/*,.srt,.vtt"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.currentTarget.value = "";
          void handleFiles(files);
        }}
      />

      <header className="editor-header">
        <button
          type="button"
          className="icon-button"
          onClick={() => navigate("/projects")}
          aria-label="Back to projects"
          title="Back to projects"
        >
          <ArrowLeft size={17} />
        </button>

        <div className="editor-title-wrap">
          <input
            className="editor-title-input"
            value={titleDraft}
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={() => void commitTitle()}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                setTitleDraft(project.name);
                event.currentTarget.blur();
              }
            }}
            aria-label="Project name"
            maxLength={120}
          />
          <span className={`save-state save-${saveState}`} aria-live="polite">
            {saveState === "saving" ? (
              <>
                <Loader2 size={11} className="spin" /> saving
              </>
            ) : saveState === "saved" ? (
              <>
                <Check size={11} /> saved
              </>
            ) : saveState === "error" ? (
              "rename failed"
            ) : (
              "local"
            )}
          </span>
        </div>

        <div className="editor-badges mono">
          <span className="chip">{resolutionLabel(project.width, project.height)}</span>
          <span className="chip">{aspectRatioLabel(project.width, project.height)}</span>
          <span className="chip">{project.fps} fps</span>
        </div>

        <div className="editor-header-right">
          <button
            type="button"
            className="btn btn-ghost editor-panel-toggle"
            aria-label="Toggle media panel"
            aria-expanded={mobilePanel === "media"}
            onClick={() => setMobilePanel((current) => (current === "media" ? "none" : "media"))}
          >
            <PanelLeft size={15} /> <span className="toggle-label">Media</span>
          </button>
          <button
            type="button"
            className="btn btn-ghost editor-panel-toggle"
            aria-label="Toggle inspector panel"
            aria-expanded={mobilePanel === "inspector"}
            onClick={() =>
              setMobilePanel((current) => (current === "inspector" ? "none" : "inspector"))
            }
          >
            <PanelRight size={15} /> <span className="toggle-label">Inspect</span>
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={openFilePicker}
            title="Upload a source"
          >
            <Upload size={15} /> <span className="btn-label">Upload</span>
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled
            title="The FFmpeg render pipeline lands in Milestone 3"
            aria-disabled="true"
          >
            <Download size={15} /> Export
            <span className="btn-badge">M3</span>
          </button>
        </div>
      </header>

      <div className="editor-main">
        {mobilePanel !== "none" ? (
          <button
            type="button"
            className="editor-scrim"
            aria-label="Close panel"
            onClick={() => setMobilePanel("none")}
          />
        ) : null}

        <div className={`editor-drawer media-drawer ${mobilePanel === "media" ? "drawer-open" : ""}`}>
          <MediaPanel
            assets={project.assets}
            selectedAssetId={selectedAssetId}
            uploads={uploads}
            tab={tab}
            onTabChange={setTab}
            onSelect={selectAsset}
            onPickFiles={openFilePicker}
            onUploadFiles={(files) => void handleFiles(files)}
            onCancelUpload={cancelUpload}
            onDeleteAsset={setDeleteTarget}
            onClose={() => setMobilePanel("none")}
          />
        </div>

        <div className="center-column">
          <PreviewStage
            asset={selectedAsset}
            selectedClip={selectedClip}
            fps={project.fps}
            playheadMs={playheadMs}
            mediaRef={mediaRef}
            onTimeUpdate={setPlayheadMs}
            onPickFiles={openFilePicker}
          />
          <Timeline
            tracks={project.tracks}
            assets={project.assets}
            durationMs={project.durationMs}
            fps={project.fps}
            pxPerSecond={pxPerSecond}
            playheadMs={playheadMs}
            selectedClipId={selectedClipId}
            waveforms={waveforms}
            onSetZoom={setPxPerSecond}
            onSeek={seekTo}
            onSelectClip={selectClip}
            onEditClip={applyClipPatch}
            onSplitClip={(clip, atMs) => void splitClip(clip, atMs)}
          />
        </div>

        <div
          className={`editor-drawer inspector-drawer ${mobilePanel === "inspector" ? "drawer-open" : ""}`}
        >
          <Inspector
            project={project}
            asset={selectedAsset}
            clip={selectedClip}
            playheadMs={playheadMs}
            canSplit={
              Boolean(selectedClip) &&
              playheadMs > (selectedClip?.startMs ?? 0) + 100 &&
              playheadMs < (selectedClip?.startMs ?? 0) + (selectedClip?.durationMs ?? 0) - 100
            }
            onUpdateClip={(patch) => {
              if (selectedClip) void applyClipPatch(selectedClip, patch);
            }}
            onSplit={() => {
              if (selectedClip) void splitClip(selectedClip, playheadMs);
            }}
            onDeleteClip={() => {
              if (selectedClip) void deleteClip(selectedClip);
            }}
            onAddToTimeline={() => {
              if (selectedAsset) void addAssetToTimeline(selectedAsset);
            }}
            onDeleteAsset={setDeleteTarget}
            onClose={() => setMobilePanel("none")}
          />
        </div>
      </div>

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete this source?"
        description="The file is removed from disk. Every timeline clip that references it is removed too."
      >
        <div className="danger-box">
          <Trash2 size={17} aria-hidden="true" />
          <p>
            <strong>{deleteTarget?.originalName}</strong>
            {deleteTarget?.durationMs ? ` · ${formatDuration(deleteTarget.durationMs)}` : ""} will
            be permanently deleted.
          </p>
        </div>
        <div className="modal-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setDeleteTarget(null)}
            disabled={deleting}
          >
            Keep source
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => void confirmDeleteAsset()}
            disabled={deleting}
          >
            {deleting ? <Loader2 size={15} className="spin" /> : <Trash2 size={15} />}
            {deleting ? "Deleting" : "Delete source"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
