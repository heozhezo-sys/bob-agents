import { useEffect, useState } from "react";
import { Download, Film, Loader2 } from "lucide-react";
import {
  formatDuration,
  type ProjectDetail,
  type RenderJob,
} from "@ai-video-agent-studio/shared";
import { Modal } from "../Modal";
import { api, ApiError } from "../../api";
import { useToast } from "../Toast";

interface ExportModalProps {
  open: boolean;
  project: ProjectDetail;
  onClose: () => void;
}

function statusLabel(status: RenderJob["status"]): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "running":
      return "Rendering";
    case "succeeded":
      return "Ready";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
  }
}

export function ExportModal({ open, project, onClose }: ExportModalProps) {
  const toast = useToast();
  const [jobs, setJobs] = useState<RenderJob[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clipCount = project.tracks.reduce((sum, track) => sum + track.clips.length, 0);

  const load = async () => {
    try {
      const data = await api.listRenders(project.id);
      setJobs(data.jobs);
      const latest = data.jobs[0];
      if (latest && (latest.status === "queued" || latest.status === "running")) {
        setActiveId(latest.id);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load renders");
    }
  };

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, project.id]);

  useEffect(() => {
    if (!open || !activeId) return;
    const timer = setInterval(() => {
      void api
        .listRenders(project.id)
        .then((data) => {
          setJobs(data.jobs);
          const job = data.jobs.find((item) => item.id === activeId);
          if (job && (job.status === "succeeded" || job.status === "failed")) {
            setActiveId(null);
            if (job.status === "succeeded") toast("Render complete", "success");
            if (job.status === "failed") toast(job.error ?? "Render failed", "error");
          }
        })
        .catch(() => undefined);
    }, 1000);
    return () => clearInterval(timer);
  }, [open, activeId, project.id, toast]);

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      const data = await api.startRender(project.id);
      setJobs((current) => [data.job, ...current]);
      setActiveId(data.job.id);
      toast("Render queued", "info");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start the render");
    } finally {
      setStarting(false);
    }
  };

  const activeJob = activeId ? jobs.find((job) => job.id === activeId) ?? null : null;
  const latestReady = jobs.find((job) => job.status === "succeeded") ?? null;
  const busy = Boolean(activeJob && (activeJob.status === "queued" || activeJob.status === "running"));

  return (
    <Modal
      open={open}
      onClose={() => {
        setActiveId(null);
        onClose();
      }}
      title="Export project"
      description="Renders a real H.264 MP4 from the current timeline through the FFmpeg queue."
      wide
    >
      <div className="export-summary">
        <div className="export-stat">
          <span className="export-label">Resolution</span>
          <strong>
            {project.width}×{project.height}
          </strong>
        </div>
        <div className="export-stat">
          <span className="export-label">Frame rate</span>
          <strong>{project.fps} fps</strong>
        </div>
        <div className="export-stat">
          <span className="export-label">Duration</span>
          <strong>{formatDuration(project.durationMs)}</strong>
        </div>
        <div className="export-stat">
          <span className="export-label">Clips</span>
          <strong>{clipCount}</strong>
        </div>
      </div>

      <p className="export-note">
        Output is verified with ffprobe before download. Text and motion layers are
        not burned in yet; video, audio and image clips are rendered.
      </p>

      <div className="export-actions">
        <button
          type="button"
          className="btn btn-primary btn-block"
          onClick={() => void start()}
          disabled={starting || busy}
        >
          {starting || busy ? (
            <>
              <Loader2 size={15} className="spin" /> {busy ? "Rendering…" : "Starting…"}
            </>
          ) : (
            <>
              <Film size={15} /> Start export
            </>
          )}
        </button>
      </div>

      {activeJob ? (
        <div className="render-progress-card">
          <div className="render-progress-head">
            <span>{statusLabel(activeJob.status)}</span>
            <span className="mono">{activeJob.progress}%</span>
          </div>
          <div className="progress-bar" role="progressbar" aria-valuenow={activeJob.progress} aria-valuemin={0} aria-valuemax={100}>
            <div className="progress-fill" style={{ width: `${activeJob.progress}%` }} />
          </div>
          {activeJob.error ? <p className="form-error">{activeJob.error}</p> : null}
        </div>
      ) : null}

      {latestReady?.fileUrl ? (
        <div className="export-preview">
          <video
            className="export-video"
            src={latestReady.fileUrl}
            controls
            preload="metadata"
          />
          <a
            className="btn btn-ghost btn-block"
            href={latestReady.downloadUrl ?? undefined}
            download
          >
            <Download size={15} /> Download MP4
          </a>
        </div>
      ) : null}

      {jobs.length > 0 ? (
        <section className="export-history">
          <h3 className="export-history-title">Recent exports</h3>
          <div className="job-list">
            {jobs.slice(0, 6).map((job) => (
              <div className="job-row" key={job.id}>
                <div className="job-meta">
                  <span>{statusLabel(job.status)}</span>
                  <span className="mono">{job.progress}%</span>
                  <span>{new Date(job.createdAt).toLocaleString()}</span>
                  {job.downloadUrl ? (
                    <a href={job.downloadUrl} download>
                      Download
                    </a>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </Modal>
  );
}
