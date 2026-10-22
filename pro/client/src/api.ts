import type {
  ApiErrorBody,
  MediaAsset,
  Project,
  ProjectDetail,
  RenderJob,
  SessionInfo,
  WaveformData,
} from "@ai-video-agent-studio/shared";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let csrfToken = "";

export function setCsrfToken(token: string): void {
  csrfToken = token;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json" };
  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  if (method !== "GET" && csrfToken) {
    headers["x-csrf-token"] = csrfToken;
  }
  const response = await fetch(path, {
    method,
    headers,
    body,
    credentials: "same-origin",
    signal: options.signal,
  });
  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!response.ok) {
    const parsed = data as ApiErrorBody | null;
    throw new ApiError(
      response.status,
      parsed?.error?.code ?? "request_failed",
      parsed?.error?.message ?? response.statusText,
      parsed?.error?.details,
    );
  }
  return data as T;
}

export const api = {
  me: () => request<SessionInfo>("/api/auth/me"),
  login: (password: string) =>
    request<SessionInfo>("/api/auth/login", {
      method: "POST",
      body: { password },
    }),
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: boolean }>("/api/auth/password", {
      method: "POST",
      body: { currentPassword, newPassword },
    }),
  updateProfile: (displayName: string) =>
    request<{ ok: boolean; displayName: string }>("/api/auth/profile", {
      method: "PATCH",
      body: { displayName },
    }),

  listProjects: () => request<{ projects: Project[] }>("/api/projects"),
  getProject: (id: string) =>
    request<{ project: ProjectDetail }>(`/api/projects/${id}`),
  createProject: (input: {
    name: string;
    width: number;
    height: number;
    fps: number;
  }) =>
    request<{ project: ProjectDetail }>("/api/projects", {
      method: "POST",
      body: input,
    }),
  updateProject: (
    id: string,
    input: Partial<{ name: string; width: number; height: number; fps: number }>,
  ) =>
    request<{ project: ProjectDetail }>(`/api/projects/${id}`, {
      method: "PATCH",
      body: input,
    }),
  deleteProject: (id: string) =>
    request<{ ok: boolean }>(`/api/projects/${id}`, { method: "DELETE" }),
  deleteAsset: (id: string) =>
    request<{ ok: boolean }>(`/api/assets/${id}`, { method: "DELETE" }),
  updateClip: (
    projectId: string,
    clipId: string,
    input: Partial<{ startMs: number; durationMs: number; inMs: number; trackId: string }>,
  ) =>
    request<{ project: ProjectDetail }>(`/api/projects/${projectId}/clips/${clipId}`, {
      method: "PATCH",
      body: input,
    }),
  splitClip: (projectId: string, clipId: string, atMs: number) =>
    request<{ project: ProjectDetail }>(
      `/api/projects/${projectId}/clips/${clipId}/split`,
      { method: "POST", body: { atMs } },
    ),
  deleteClip: (projectId: string, clipId: string) =>
    request<{ project: ProjectDetail }>(
      `/api/projects/${projectId}/clips/${clipId}`,
      { method: "DELETE" },
    ),
  addClip: (projectId: string, input: { assetId: string; trackId?: string; startMs?: number }) =>
    request<{ project: ProjectDetail }>(`/api/projects/${projectId}/clips`, {
      method: "POST",
      body: input,
    }),
  listRenders: (projectId: string) =>
    request<{ jobs: RenderJob[] }>(`/api/projects/${projectId}/renders`),
  listAllRenders: () => request<{ jobs: RenderJob[] }>("/api/renders"),
  startRender: (projectId: string) =>
    request<{ job: RenderJob }>(`/api/projects/${projectId}/renders`, {
      method: "POST",
      body: {},
    }),

  getHealth: () =>
    request<{
      ok: boolean;
      version: string;
      ffmpeg: boolean;
      provider: { configured: boolean };
    }>("/api/health"),
};

export function uploadAsset(
  projectId: string,
  file: File,
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<MediaAsset> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/projects/${projectId}/assets`);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Accept", "application/json");
    if (csrfToken) xhr.setRequestHeader("x-csrf-token", csrfToken);

    if (signal) {
      if (signal.aborted) {
        reject(new DOMException("Upload cancelled", "AbortError"));
        return;
      }
      signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onerror = () =>
      reject(new ApiError(0, "network_error", "The upload could not reach the server"));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    xhr.onload = () => {
      let payload: unknown = null;
      try {
        payload = JSON.parse(xhr.responseText || "null");
      } catch {
        payload = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve((payload as { asset: MediaAsset }).asset);
        return;
      }
      const error = (payload as ApiErrorBody | null)?.error;
      reject(
        new ApiError(
          xhr.status,
          error?.code ?? "upload_failed",
          error?.message ?? "Upload failed",
          error?.details,
        ),
      );
    };

    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}

export async function getWaveform(assetId: string): Promise<WaveformData | null> {
  try {
    const response = await fetch(`/api/assets/${assetId}/waveform`, {
      credentials: "same-origin",
    });
    if (!response.ok) return null;
    return (await response.json()) as WaveformData;
  } catch {
    return null;
  }
}

export async function getSubtitleText(assetId: string): Promise<string> {
  const response = await fetch(`/api/assets/${assetId}/stream`, {
    credentials: "same-origin",
  });
  if (!response.ok) throw new ApiError(response.status, "read_failed", "Could not read subtitle");
  return response.text();
}
