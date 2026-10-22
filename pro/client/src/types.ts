export interface UploadTask {
  id: string;
  name: string;
  progress: number;
  status: "uploading" | "processing" | "done" | "error";
  error?: string;
}

export type EditorTab = "media" | "text" | "audio" | "templates";

export type SaveState = "idle" | "saving" | "saved" | "error";
