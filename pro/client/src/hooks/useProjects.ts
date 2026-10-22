import { useCallback, useEffect, useState } from "react";
import type { Project } from "@ai-video-agent-studio/shared";
import { api, ApiError } from "../api";

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await api.listProjects();
      setProjects(data.projects);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load projects");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { projects, loading, error, refresh };
}
