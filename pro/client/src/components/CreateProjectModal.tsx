import { useState, type FormEvent } from "react";
import { Loader2, Plus } from "lucide-react";
import {
  RESOLUTION_PRESETS,
  type ProjectDetail,
} from "@ai-video-agent-studio/shared";
import { api, ApiError } from "../api";
import { Modal } from "./Modal";

interface CreateProjectModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (project: ProjectDetail) => void;
}

export function CreateProjectModal({ open, onClose, onCreated }: CreateProjectModalProps) {
  const [name, setName] = useState("Untitled film");
  const [presetIndex, setPresetIndex] = useState(0);
  const [fps, setFps] = useState(30);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preset = RESOLUTION_PRESETS[presetIndex];

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give the project a name.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const data = await api.createProject({
        name: trimmed,
        width: preset.width,
        height: preset.height,
        fps,
      });
      setName("Untitled film");
      setPresetIndex(0);
      setFps(30);
      onCreated(data.project);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the project");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New project"
      description="Choose a canvas. You can change it later; source files are never re-encoded."
    >
      <form onSubmit={onSubmit} className="stack-form">
        <label className="field">
          <span className="field-label">Project name</span>
          <input
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={120}
            autoFocus
          />
        </label>

        <fieldset className="field">
          <legend className="field-label">Canvas</legend>
          <div className="preset-grid">
            {RESOLUTION_PRESETS.map((option, index) => (
              <button
                key={option.label}
                type="button"
                className={`preset ${index === presetIndex ? "preset-active" : ""}`}
                onClick={() => {
                  setPresetIndex(index);
                  setFps(option.fps);
                }}
                aria-pressed={index === presetIndex}
              >
                <span className={`preset-shape shape-${option.width === option.height ? "square" : option.height > option.width ? "portrait" : "landscape"}`} aria-hidden="true" />
                <span className="preset-label">{option.label}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <label className="field">
          <span className="field-label">Frame rate</span>
          <select
            className="input"
            value={fps}
            onChange={(event) => setFps(Number(event.target.value))}
          >
            <option value={24}>24 fps · cinema</option>
            <option value={25}>25 fps · PAL</option>
            <option value={30}>30 fps · standard</option>
            <option value={60}>60 fps · smooth</option>
          </select>
        </label>

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? <Loader2 size={16} className="spin" /> : <Plus size={16} />}
            {submitting ? "Creating" : "Create project"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
