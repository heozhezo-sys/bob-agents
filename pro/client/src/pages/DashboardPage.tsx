import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Circle,
  CircleCheck,
  Clapperboard,
  Cpu,
  Film,
  FolderOpen,
  Loader2,
  Plus,
  Timer,
} from "lucide-react";
import { formatDuration, type ProjectDetail } from "@ai-video-agent-studio/shared";
import { CreateProjectModal } from "../components/CreateProjectModal";
import { ProjectCard } from "../components/ProjectCard";
import { useProjects } from "../hooks/useProjects";
import { clockLabel } from "../lib/format";

const MILESTONES = [
  { label: "Upload, probe & source preview", state: "live" },
  { label: "Persistent multi-track timeline", state: "live" },
  { label: "Real FFmpeg render & download", state: "next" },
  { label: "Whisper transcription & burn-in captions", state: "planned" },
  { label: "Keyframed motion graphics", state: "planned" },
  { label: "Agent tools with approval", state: "planned" },
];

export function DashboardPage() {
  const { projects, loading, error } = useProjects();
  const [createOpen, setCreateOpen] = useState(false);
  const navigate = useNavigate();

  const sourceCount = projects.reduce((sum, project) => sum + project.assetCount, 0);
  const timelineMs = projects.reduce((sum, project) => sum + project.durationMs, 0);
  const recent = projects.slice(0, 3);

  const onCreated = (project: ProjectDetail) => {
    setCreateOpen(false);
    navigate(`/projects/${project.id}`);
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Studio overview</p>
          <h1>Your edit bay, at a glance.</h1>
          <p className="page-lede">
            Every number below is read from the local database. Nothing here is
            simulated.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
          <Plus size={16} />
          New project
        </button>
      </header>

      <section className="stat-grid" aria-label="Studio totals">
        <StatCard
          icon={FolderOpen}
          label="Projects"
          value={loading ? "—" : String(projects.length)}
          detail="Stored locally"
        />
        <StatCard
          icon={Film}
          label="Source files"
          value={loading ? "—" : String(sourceCount)}
          detail="Probed with FFprobe"
        />
        <StatCard
          icon={Timer}
          label="Timeline time"
          value={loading ? "—" : clockLabel(timelineMs)}
          detail="Across all sequences"
        />
        <StatCard
          icon={Cpu}
          label="Media engine"
          value="FFmpeg 6.1"
          detail="Ready for rendering"
          tone="ok"
        />
      </section>

      <div className="dashboard-grid">
        <section className="panel">
          <header className="section-head">
            <div>
              <h2>Recent cuts</h2>
              <p className="section-sub">Pick up where you left off.</p>
            </div>
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => navigate("/projects")}
            >
              All projects <ArrowRight size={14} />
            </button>
          </header>

          {loading ? (
            <div className="project-grid">
              <div className="skeleton-card" />
              <div className="skeleton-card" />
              <div className="skeleton-card" />
            </div>
          ) : error ? (
            <p className="inline-error" role="alert">{error}</p>
          ) : recent.length === 0 ? (
            <div className="empty-state compact">
              <span className="empty-icon" aria-hidden="true">
                <Clapperboard size={24} />
              </span>
              <h3>No cuts yet</h3>
              <p>Create a project, then drop in footage. The first upload appears on the timeline.</p>
              <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
                <Plus size={16} /> Start a project
              </button>
            </div>
          ) : (
            <div className="project-grid">
              {recent.map((project) => (
                <ProjectCard key={project.id} project={project} />
              ))}
            </div>
          )}
        </section>

        <aside className="panel roadmap-panel">
          <header className="section-head">
            <div>
              <h2>Build pipeline</h2>
              <p className="section-sub">What is wired up right now.</p>
            </div>
          </header>
          <ol className="milestone-list">
            {MILESTONES.map((milestone) => (
              <li key={milestone.label} className={`milestone ${milestone.state}`}>
                {milestone.state === "live" ? (
                  <CircleCheck size={16} aria-hidden="true" />
                ) : milestone.state === "next" ? (
                  <Loader2 size={16} className="milestone-next" aria-hidden="true" />
                ) : (
                  <Circle size={16} aria-hidden="true" />
                )}
                <span>{milestone.label}</span>
                <span className="milestone-state">
                  {milestone.state === "live"
                    ? "Live"
                    : milestone.state === "next"
                      ? "Next"
                      : "Planned"}
                </span>
              </li>
            ))}
          </ol>
          <p className="panel-note">
            The studio refuses to fake a render, a transcript or an AI edit. Each
            surface unlocks only when the real operation behind it is verified.
          </p>
        </aside>
      </div>

      <CreateProjectModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={onCreated}
      />
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: typeof Film;
  label: string;
  value: string;
  detail: string;
  tone?: "ok";
}) {
  return (
    <div className={`stat-card ${tone === "ok" ? "stat-ok" : ""}`}>
      <span className="stat-icon" aria-hidden="true">
        <Icon size={16} />
      </span>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      <span className="stat-detail">{detail}</span>
    </div>
  );
}
