import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FolderOpen, Loader2, Plus, Search, Trash2 } from "lucide-react";
import type { Project, ProjectDetail } from "@ai-video-agent-studio/shared";
import { CreateProjectModal } from "../components/CreateProjectModal";
import { Modal } from "../components/Modal";
import { ProjectCard } from "../components/ProjectCard";
import { useToast } from "../components/Toast";
import { useProjects } from "../hooks/useProjects";
import { api, ApiError } from "../api";

export function ProjectsPage() {
  const { projects, loading, error, refresh } = useProjects();
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((project) => project.name.toLowerCase().includes(q));
  }, [projects, query]);

  const onCreated = (project: ProjectDetail) => {
    setCreateOpen(false);
    navigate(`/projects/${project.id}`);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.deleteProject(deleteTarget.id);
      toast(`Deleted “${deleteTarget.name}”`, "success");
      setDeleteTarget(null);
      await refresh();
    } catch (err) {
      toast(
        err instanceof ApiError ? err.message : "Could not delete the project",
        "error",
      );
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Library</p>
          <h1>Projects</h1>
          <p className="page-lede">
            {loading
              ? "Reading the local database…"
              : `${projects.length} project${projects.length === 1 ? "" : "s"} on this machine.`}
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
          <Plus size={16} />
          New project
        </button>
      </header>

      <div className="toolbar">
        <label className="search-field">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search projects"
            aria-label="Search projects"
          />
        </label>
        <span className="toolbar-count mono">
          {filtered.length} shown
        </span>
      </div>

      {loading ? (
        <div className="project-grid">
          <div className="skeleton-card" />
          <div className="skeleton-card" />
          <div className="skeleton-card" />
          <div className="skeleton-card" />
        </div>
      ) : error ? (
        <div className="inline-error" role="alert">
          <p>{error}</p>
          <button type="button" className="btn btn-ghost" onClick={() => void refresh()}>
            Retry
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon" aria-hidden="true">
            <FolderOpen size={26} />
          </span>
          <h2>{projects.length === 0 ? "The shelf is empty" : "No project matches"}</h2>
          <p>
            {projects.length === 0
              ? "A project holds your sources, timeline, transcript and renders. Create one to begin."
              : "Try a different search, or clear the field to see everything."}
          </p>
          {projects.length === 0 ? (
            <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
              <Plus size={16} /> Create the first project
            </button>
          ) : (
            <button type="button" className="btn btn-ghost" onClick={() => setQuery("")}>
              Clear search
            </button>
          )}
        </div>
      ) : (
        <div className="project-grid">
          {filtered.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onRequestDelete={setDeleteTarget}
            />
          ))}
        </div>
      )}

      <CreateProjectModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={onCreated}
      />

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete project?"
        description="This removes the project, its timeline, and every uploaded source file from this machine."
      >
        <div className="danger-box">
          <Trash2 size={17} aria-hidden="true" />
          <p>
            <strong>{deleteTarget?.name}</strong> will be permanently deleted.
            This cannot be undone unless you have a backup of the data directory.
          </p>
        </div>
        <div className="modal-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setDeleteTarget(null)}
            disabled={deleting}
          >
            Keep project
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => void confirmDelete()}
            disabled={deleting}
          >
            {deleting ? <Loader2 size={16} className="spin" /> : <Trash2 size={16} />}
            {deleting ? "Deleting" : "Delete permanently"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
