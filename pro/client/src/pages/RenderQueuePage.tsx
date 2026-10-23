import { useEffect, useState } from "react";
import { Download, ListVideo, RefreshCw } from "lucide-react";
import {
  formatDuration,
  type RenderJob,
} from "@ai-video-agent-studio/shared";
import { api, ApiError } from "../api";
import { useToast } from "../components/Toast";

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

export function RenderQueuePage() {
  const toast = useToast();
  const [jobs, setJobs] = useState<RenderJob[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const data = await api.listAllRenders();
      setJobs(data.jobs);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not load renders", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!jobs.some((job) => job.status === "queued" || job.status === "running")) return;
    const timer = setInterval(() => void load(), 2000);
    return () => clearInterval(timer);
  }, [jobs]);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Milestone 3</p>
          <h1>Render queue</h1>
          <p className="page-subtitle">
            Every export requested from the editor. Files are verified with ffprobe
            before they are offered for download.
          </p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={() => void load()}>
          <RefreshCw size={15} /> Refresh
        </button>
      </header>

      {loading ? (
        <div className="empty-state">Loading renders…</div>
      ) : jobs.length === 0 ? (
        <div className="empty-state">
          <ListVideo size={28} aria-hidden="true" />
          <h3>No renders yet</h3>
          <p>No export has been requested yet. Open a project and use Export.</p>
        </div>
      ) : (
        <div className="job-list">
          {jobs.map((job) => (
            <article className="job-row job-row-wide" key={job.id}>
              <div className="job-main">
                <strong>{job.projectName ?? "Project"}</strong>
                <span className={`status-pill status-${job.status}`}>
                  {statusLabel(job.status)}
                </span>
              </div>
              <div className="job-meta">
                <span>{job.progress}%</span>
                <span>{new Date(job.createdAt).toLocaleString()}</span>
                {job.error ? <span className="form-error">{job.error}</span> : null}
              </div>
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${job.progress}%` }} />
              </div>
              {job.fileUrl ? (
                <div className="job-downloads">
                  <video className="job-video" src={job.fileUrl} controls preload="metadata" />
                  <a className="btn btn-ghost" href={job.downloadUrl ?? undefined} download>
                    <Download size={14} /> Download MP4
                  </a>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
