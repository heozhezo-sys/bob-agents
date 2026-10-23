import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowUpRight,
  Bot,
  Loader2,
  RotateCcw,
  Send,
} from "lucide-react";
import {
  formatDuration,
  type AgentConversation,
  type AgentMessage,
  type ProjectDetail,
  type RenderJob,
} from "@ai-video-agent-studio/shared";
import { api, ApiError } from "../api";
import { ClipStrip } from "../components/agent/ClipStrip";
import { useToast } from "../components/Toast";
import { useProjects } from "../hooks/useProjects";

const SUGGESTIONS = [
  "Trim the first clip by one second",
  "Split the first clip in half",
  "Start an export",
];

function Message({ message }: { message: AgentMessage }) {
  return (
    <article className={`chat-msg ${message.role}`}>
      <div className="chat-msg-content">{message.content}</div>
      {message.actions.length > 0 ? (
        <ul className="chat-actions">
          {message.actions.map((action, index) => (
            <li
              key={`${action.tool}-${index}`}
              className={action.ok ? "ok" : "failed"}
            >
              {action.thumbnailUrl ? (
                <img src={action.thumbnailUrl} alt="" />
              ) : (
                <span className="chat-action-dot" aria-hidden="true" />
              )}
              <span>{action.summary}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

export function AgentPage() {
  const { projects, loading: projectsLoading } = useProjects();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("project");
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [conversation, setConversation] = useState<AgentConversation | null>(null);
  const [renders, setRenders] = useState<RenderJob[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const logRef = useRef<HTMLDivElement | null>(null);
  const loadSequence = useRef(0);

  const apply = useCallback((next: AgentConversation, nextProject: ProjectDetail) => {
    setConversation(next);
    setProject(nextProject);
  }, []);

  const load = useCallback(
    async (id: string) => {
      const sequence = ++loadSequence.current;
      setLoading(true);
      try {
        const [state, renderData] = await Promise.all([
          api.getAgentState(id),
          api.listRenders(id),
        ]);
        if (sequence !== loadSequence.current) return;
        apply(state.conversation, state.project);
        setRenders(renderData.jobs);
        setError(null);
      } catch (err) {
        if (sequence !== loadSequence.current) return;
        setError(err instanceof ApiError ? err.message : "Could not load the agent.");
      } finally {
        if (sequence === loadSequence.current) setLoading(false);
      }
    },
    [apply],
  );

  useEffect(() => {
    if (projectsLoading || projects.length === 0) return;
    if (selectedId && projects.some((item) => item.id === selectedId)) return;
    setParams({ project: projects[0].id }, { replace: true });
  }, [projects, projectsLoading, selectedId, setParams]);

  useEffect(() => {
    if (selectedId) void load(selectedId);
  }, [selectedId, load]);

  useEffect(() => {
    const element = logRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [conversation?.messages.length, sending]);

  const send = async () => {
    const text = draft.trim();
    if (!text || !selectedId || sending) return;
    setSending(true);
    setDraft("");
    try {
      const result = await api.sendAgentMessage(selectedId, text);
      apply(result.conversation, result.project);
      const lastActions =
        result.conversation.messages[result.conversation.messages.length - 1]?.actions ?? [];
      if (lastActions.some((action) => action.tool === "start_export")) {
        void api
          .listRenders(selectedId)
          .then((data) => setRenders(data.jobs))
          .catch(() => undefined);
      }
    } catch (err) {
      toast(
        err instanceof ApiError ? err.message : "The agent could not answer.",
        "error",
      );
      await load(selectedId);
    } finally {
      setSending(false);
    }
  };

  const undo = async () => {
    if (!conversation?.turnId) return;
    try {
      const result = await api.undoAgentTurn(conversation.turnId);
      apply(result.conversation, result.project);
      toast("Undid the last agent turn.", "success");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not undo.", "error");
    }
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  const provider = conversation?.provider ?? null;
  const canSend = Boolean(provider?.configured) && Boolean(draft.trim()) && !sending;
  const latestRender = renders[0] ?? null;

  if (!projectsLoading && projects.length === 0) {
    return (
      <div className="page">
        <header className="page-header">
          <div>
            <p className="eyebrow">Direct the cut</p>
            <h1>Type it. The agent cuts it.</h1>
            <p className="page-lede">
              The agent edits the same timeline the editor shows. Undo reverts its last turn.
            </p>
          </div>
        </header>
        <div className="empty-state">
          <div className="empty-icon">
            <Bot size={22} />
          </div>
          <h2>No project to edit</h2>
          <p>Create a project first, then come back and describe the cut.</p>
          <Link className="btn btn-primary" to="/">
            Open the dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header agent-header">
        <div>
          <p className="eyebrow">Direct the cut</p>
          <h1>Type it. The agent cuts it.</h1>
          <p className="page-lede">
            The agent edits the same timeline the editor shows. Undo reverts its last turn.
          </p>
        </div>
        <div className="agent-actions">
          <label className="agent-project">
            <span>Project</span>
            <select
              value={selectedId ?? ""}
              onChange={(event) => setParams({ project: event.target.value })}
              disabled={projects.length === 0 || sending}
            >
              {projects.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          {project ? (
            <Link className="btn btn-ghost" to={`/projects/${project.id}`}>
              Open editor
              <ArrowUpRight size={15} />
            </Link>
          ) : null}
        </div>
      </header>

      {error ? <div className="panel agent-error">{error}</div> : null}

      {provider && !provider.configured ? (
        <div className="agent-config">
          <strong>The agent is not configured.</strong> Add{" "}
          <code>OPENCODE_API_KEY</code> and <code>OPENCODE_MODEL</code> to{" "}
          <code>pro/.env</code>, then restart the API. To try the scripted demo,
          run the server with <code>AGENT_PROVIDER=mock</code>.
        </div>
      ) : null}

      <div className="agent-grid">
        <section className="panel chat-panel" aria-label="Agent chat">
          <header className="section-head">
            <div>
              <h2>Conversation</h2>
              <p className="section-sub">The agent only touches this project.</p>
            </div>
            <span className={`agent-badge ${provider?.name ?? ""}`}>
              {provider?.name === "mock"
                ? "Mock agent"
                : (provider?.model ?? "Agent")}
            </span>
          </header>

          <div className="chat-log" ref={logRef}>
            {loading ? (
              <div className="chat-working">
                <Loader2 size={15} className="spin" />
                Loading the transcript…
              </div>
            ) : null}
            {!loading && conversation?.messages.length === 0 ? (
              <div className="chat-empty">
                <Bot size={22} />
                <p>
                  Tell me what to change. I can trim, split, move or delete clips,
                  add a source, rename the project, or start an export.
                </p>
                <div className="chat-suggestions">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      className="btn btn-quiet"
                      onClick={() => setDraft(suggestion)}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {conversation?.messages.map((message) => (
              <Message key={message.id} message={message} />
            ))}
            {sending ? (
              <div className="chat-msg assistant">
                <div className="chat-working">
                  <Loader2 size={15} className="spin" />
                  Working…
                </div>
              </div>
            ) : null}
          </div>

          <form
            className="agent-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onComposerKeyDown}
              placeholder={
                provider?.configured
                  ? "Describe the edit… (Enter to send, Shift+Enter for a new line)"
                  : "The agent needs a model key."
              }
              disabled={!provider?.configured || sending}
              rows={2}
              maxLength={4000}
            />
            <button className="btn btn-primary" type="submit" disabled={!canSend}>
              <Send size={16} />
              Send
            </button>
          </form>

          <div className="agent-undo-row">
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => void undo()}
              disabled={!conversation?.canUndo || sending}
              title={conversation?.undoBlockedReason ?? "Revert the last agent turn"}
            >
              <RotateCcw size={15} />
              Undo last turn
            </button>
            {conversation?.undoBlockedReason ? (
              <span className="agent-hint">{conversation.undoBlockedReason}</span>
            ) : null}
          </div>
        </section>

        <aside className="agent-side">
          <section className="panel">
            <header className="section-head">
              <div>
                <h2>Cut</h2>
                <p className="section-sub">
                  {project ? formatDuration(project.durationMs) : "No project"}
                </p>
              </div>
            </header>
            {project ? (
              <ClipStrip project={project} />
            ) : (
              <p className="panel-note">Pick a project.</p>
            )}
          </section>

          <section className="panel">
            <header className="section-head">
              <div>
                <h2>Target</h2>
              </div>
            </header>
            <dl className="kv">
              <div className="kv-row">
                <dt>Resolution</dt>
                <dd className="mono">
                  {project ? `${project.width}×${project.height}` : "—"}
                </dd>
              </div>
              <div className="kv-row">
                <dt>Frame rate</dt>
                <dd className="mono">{project ? `${project.fps} fps` : "—"}</dd>
              </div>
              <div className="kv-row">
                <dt>Sources</dt>
                <dd className="mono">{project ? project.assets.length : "—"}</dd>
              </div>
            </dl>
          </section>

          <section className="panel">
            <header className="section-head">
              <div>
                <h2>Export</h2>
              </div>
            </header>
            {latestRender ? (
              <div className="agent-export">
                <span className={`status-pill status-${latestRender.status}`}>
                  {latestRender.status}
                </span>
                <span className="agent-hint">
                  {new Date(latestRender.createdAt).toLocaleString()}
                </span>
                <Link className="btn btn-quiet" to="/renders">
                  Open renders
                  <ArrowUpRight size={14} />
                </Link>
              </div>
            ) : (
              <p className="panel-note">
                No export requested yet. Ask the agent or use the editor.
              </p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
