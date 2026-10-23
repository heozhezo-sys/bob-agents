import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Bot,
  FileText,
  Film,
  FolderOpen,
  LayoutDashboard,
  LayoutTemplate,
  ListVideo,
  LogOut,
  Menu,
  Palette,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import { Brand } from "./Brand";
import { useAuth } from "../store/auth";
import { api } from "../api";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/projects", label: "Projects", icon: FolderOpen },
  { to: "/agent", label: "AI Agent", icon: Bot },
  { to: "/media", label: "Media", icon: Film },
  { to: "/transcripts", label: "Transcripts", icon: FileText, soon: true },
  { to: "/motion", label: "Motion", icon: Sparkles, soon: true },
  { to: "/templates", label: "Templates", icon: LayoutTemplate, soon: true },
  { to: "/brand", label: "Brand kit", icon: Palette, soon: true },
  { to: "/renders", label: "Renders", icon: ListVideo },
  { to: "/settings", label: "Settings", icon: Settings },
];

const TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/projects": "Projects",
  "/agent": "AI Agent",
  "/media": "Media",
  "/transcripts": "Transcripts",
  "/motion": "Motion graphics",
  "/templates": "Templates",
  "/brand": "Brand kit",
  "/renders": "Render queue",
  "/settings": "Settings",
};

function EngineStatus() {
  const [state, setState] = useState<"loading" | "ready" | "offline">("loading");

  useEffect(() => {
    let cancelled = false;
    api
      .getHealth()
      .then((health) => {
        if (!cancelled) setState(health.ok && health.ffmpeg ? "ready" : "offline");
      })
      .catch(() => {
        if (!cancelled) setState("offline");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <span className={`engine-state engine-${state}`}>
      <span className="engine-dot" aria-hidden="true" />
      {state === "loading" ? "Checking engine" : state === "ready" ? "Engine ready" : "Engine offline"}
    </span>
  );
}

export function AppShell() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const isEditor = /^\/projects\/[^/]+$/.test(location.pathname);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  const title = TITLES[location.pathname] ?? "Studio";

  return (
    <div className="shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      {menuOpen ? (
        <button
          type="button"
          className="rail-scrim"
          aria-label="Close navigation"
          onClick={() => setMenuOpen(false)}
        />
      ) : null}
      <aside className={`rail ${menuOpen ? "rail-open" : ""}`} aria-label="Studio navigation">
        <div className="rail-top">
          <NavLink to="/" className="rail-brand" aria-label="CUTROOM home">
            <Brand size={28} subtitle />
          </NavLink>
          <button
            type="button"
            className="rail-close"
            onClick={() => setMenuOpen(false)}
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="rail-nav">
          <p className="rail-label">Workspace</p>
          {NAV.slice(0, 5).map((item) => (
            <RailLink key={item.to} item={item} />
          ))}
          <p className="rail-label">Build</p>
          {NAV.slice(5).map((item) => (
            <RailLink key={item.to} item={item} />
          ))}
        </nav>

        <div className="rail-footer">
          <div className="rail-user">
            <span className="avatar" aria-hidden="true">
              {user?.displayName?.slice(0, 1).toUpperCase() ?? "O"}
            </span>
            <span className="rail-user-text">
              <span className="rail-user-name">{user?.displayName ?? "Owner"}</span>
              <span className="rail-user-role">Local studio</span>
            </span>
            <button
              type="button"
              className="icon-button"
              onClick={handleLogout}
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut size={16} />
            </button>
          </div>
          <div className="rail-status">
            <EngineStatus />
            <span className="version-tag mono">v0.1.0</span>
          </div>
        </div>
      </aside>

      <div className="shell-main">
        {!isEditor ? (
          <header className="topbar">
            <div className="topbar-left">
              <button
                type="button"
                className="icon-button mobile-menu"
                onClick={() => setMenuOpen(true)}
                aria-label="Open navigation"
              >
                <Menu size={19} />
              </button>
              <span className="topbar-title">{title}</span>
              <span className="topbar-sep" aria-hidden="true" />
              <span className="topbar-context">Local-first video studio</span>
            </div>
            <div className="topbar-right">
              <span className="local-pill">
                <span className="local-dot" aria-hidden="true" />
                On this machine
              </span>
            </div>
          </header>
        ) : null}
        <main id="main-content" className="outlet">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function RailLink({
  item,
}: {
  item: { to: string; label: string; icon: typeof LayoutDashboard; end?: boolean; soon?: boolean };
}) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) => `rail-link ${isActive ? "active" : ""}`}
      title={item.label}
    >
      <Icon size={17} aria-hidden="true" />
      <span className="rail-link-label">{item.label}</span>
      {item.soon ? <span className="soon-dot" title="Later milestone" /> : null}
    </NavLink>
  );
}
