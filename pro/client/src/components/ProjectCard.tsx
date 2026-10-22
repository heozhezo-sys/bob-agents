import { Link } from "react-router-dom";
import { Film, Trash2 } from "lucide-react";
import type { Project } from "@ai-video-agent-studio/shared";
import { formatDuration } from "@ai-video-agent-studio/shared";
import { aspectRatioLabel, relativeTime, resolutionLabel } from "../lib/format";

interface ProjectCardProps {
  project: Project;
  onRequestDelete?: (project: Project) => void;
}

export function ProjectCard({ project, onRequestDelete }: ProjectCardProps) {
  return (
    <article className="project-card">
      <Link
        to={`/projects/${project.id}`}
        className="project-card-link"
        aria-label={`Open ${project.name}`}
      >
        <div className="project-cover">
          {project.coverUrl ? (
            <img src={project.coverUrl} alt="" loading="lazy" />
          ) : (
            <span className="cover-fallback" aria-hidden="true">
              <Film size={26} />
            </span>
          )}
          <span className="project-ratio mono">{aspectRatioLabel(project.width, project.height)}</span>
          <span className="project-updated">{relativeTime(project.updatedAt)}</span>
        </div>
        <div className="project-body">
          <h3 className="project-name">{project.name}</h3>
          <p className="project-meta mono">
            {resolutionLabel(project.width, project.height)} · {project.fps} fps
          </p>
          <div className="project-foot mono">
            <span>
              {project.assetCount} source{project.assetCount === 1 ? "" : "s"}
            </span>
            <span>{formatDuration(project.durationMs)}</span>
          </div>
        </div>
      </Link>
      {onRequestDelete ? (
        <button
          type="button"
          className="project-delete"
          onClick={() => onRequestDelete(project)}
          aria-label={`Delete ${project.name}`}
          title="Delete project"
        >
          <Trash2 size={15} />
        </button>
      ) : null}
    </article>
  );
}
