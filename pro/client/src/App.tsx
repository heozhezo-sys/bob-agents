import { useEffect } from "react";
import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
} from "react-router-dom";
import {
  Bot,
  FileText,
  Film,
  LayoutTemplate,
  ListVideo,
  Palette,
  Sparkles,
} from "lucide-react";
import { Brand } from "./components/Brand";
import { AppShell } from "./components/AppShell";
import { ToastProvider } from "./components/Toast";
import { useAuth } from "./store/auth";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { EditorPage } from "./pages/EditorPage";
import { RenderQueuePage } from "./pages/RenderQueuePage";
import { SettingsPage } from "./pages/SettingsPage";
import { RoadmapPage } from "./pages/RoadmapPage";
import { NotFoundPage } from "./pages/NotFoundPage";

function Splash() {
  return (
    <div className="splash">
      <Brand size={36} subtitle />
      <span className="splash-bar" aria-hidden="true">
        <span />
      </span>
      <p className="mono">OPENING STUDIO</p>
    </div>
  );
}

function RequireAuth() {
  const status = useAuth((state) => state.status);
  if (status === "loading") return <Splash />;
  if (status === "anonymous") return <Navigate to="/login" replace />;
  return <Outlet />;
}

export default function App() {
  const init = useAuth((state) => state.init);

  useEffect(() => {
    void init();
  }, [init]);

  return (
    <BrowserRouter>
      <ToastProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<RequireAuth />}>
            <Route element={<AppShell />}>
              <Route index element={<DashboardPage />} />
              <Route path="projects" element={<ProjectsPage />} />
              <Route path="projects/:id" element={<EditorPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route
                path="agent"
                element={
                  <RoadmapPage
                    title="AI Agent"
                    eyebrow="Direct the cut"
                    milestone="Milestone 6"
                    icon={Bot}
                    summary="A natural-language agent that calls the same validated editing tools the UI uses. It will not receive a shell, and it will not touch a source file."
                    bullets={[
                      "Plan-first edits: trim, split, reorder and delete with a visible diff.",
                      "Title and caption insertion using the real keyframe model.",
                      "Silence removal driven by transcript timestamps, not guesses.",
                      "Render requests routed through the verified FFmpeg queue.",
                      "OpenCode Zen provider with server-side key storage.",
                    ]}
                  />
                }
              />
              <Route
                path="media"
                element={
                  <RoadmapPage
                    title="Media"
                    eyebrow="Source library"
                    milestone="Milestone 2"
                    icon={Film}
                    summary="A studio-wide source browser with bins, search, proxy previews and safe deletion. The per-project media panel is already live inside the editor."
                    bullets={[
                      "Cross-project source index with real metadata.",
                      "Proxy generation for fast scrubbing of large files.",
                      "Bins, tags and duplicate detection.",
                      "Storage usage read from disk, never estimated.",
                    ]}
                  />
                }
              />
              <Route
                path="transcripts"
                element={
                  <RoadmapPage
                    title="Transcripts"
                    eyebrow="Words on the timeline"
                    milestone="Milestone 4"
                    icon={FileText}
                    summary="Local Whisper transcription with word-level timestamps, speaker labelling and a transcript editor locked to playback."
                    bullets={[
                      "faster-whisper sidecar running on this machine.",
                      "Word timestamps stored as real segment records.",
                      "SRT and VTT export, plus burned-in and karaoke captions.",
                      "Transcript search that maps back to timecode.",
                    ]}
                  />
                }
              />
              <Route
                path="motion"
                element={
                  <RoadmapPage
                    title="Motion graphics"
                    eyebrow="Type in motion"
                    milestone="Milestone 5"
                    icon={Sparkles}
                    summary="Keyframed titles, lower thirds and kinetic captions rendered to pixels, with a canvas preview that uses the same interpolation as the renderer."
                    bullets={[
                      "Position, scale, rotation, opacity and easing keyframes.",
                      "Presets: fade-up, pop-on word, lower third and slow push-in.",
                      "ASS-based animated captions for reliable burn-in.",
                      "Canvas preview that matches the rendered output.",
                    ]}
                  />
                }
              />
              <Route
                path="templates"
                element={
                  <RoadmapPage
                    title="Templates"
                    eyebrow="Repeatable formats"
                    milestone="Milestone 5"
                    icon={LayoutTemplate}
                    summary="Reusable sequences for intros, shorts and titled sections, built from the same clip and keyframe primitives as a manual edit."
                    bullets={[
                      "Save a sequence as a template with placeholders.",
                      "Apply a template without re-encoding sources.",
                      "Vertical and square variants for social cuts.",
                      "Template previews rendered from the real project model.",
                    ]}
                  />
                }
              />
              <Route
                path="brand"
                element={
                  <RoadmapPage
                    title="Brand kit"
                    eyebrow="Consistent identity"
                    milestone="Milestone 7"
                    icon={Palette}
                    summary="Fonts, colors, logo assets and caption styles stored once and applied across every render."
                    bullets={[
                      "Upload a logo once; use it in every title preset.",
                      "Color tokens mapped directly into FFmpeg and canvas.",
                      "Caption style presets with safe-area checks.",
                      "Per-project overrides without duplicating assets.",
                    ]}
                  />
                }
              />
              <Route path="renders" element={<RenderQueuePage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Route>
        </Routes>
      </ToastProvider>
    </BrowserRouter>
  );
}
