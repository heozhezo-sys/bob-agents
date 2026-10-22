import { useEffect, useState, type FormEvent } from "react";
import { Check, KeyRound, Loader2, Save, ShieldCheck, UserRound } from "lucide-react";
import { useAuth } from "../store/auth";
import { api, ApiError } from "../api";
import { useToast } from "../components/Toast";

interface Health {
  ok: boolean;
  version: string;
  ffmpeg: boolean;
  provider: { configured: boolean };
}

export function SettingsPage() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [savingName, setSavingName] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getHealth()
      .then((data) => {
        if (!cancelled) setHealth(data);
      })
      .catch(() => {
        if (!cancelled) setHealth(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    if (!user) return;
    const trimmed = displayName.trim();
    if (!trimmed) return;
    setSavingName(true);
    try {
      await api.updateProfile(trimmed);
      setUser({ ...user, displayName: trimmed });
      toast("Profile updated", "success");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not update the profile", "error");
    } finally {
      setSavingName(false);
    }
  };

  const savePassword = async (event: FormEvent) => {
    event.preventDefault();
    setPasswordError(null);
    if (newPassword.length < 8) {
      setPasswordError("Use at least 8 characters for the new passphrase.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("The new passphrase and confirmation do not match.");
      return;
    }
    setSavingPassword(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast("Passphrase changed. Other sessions were signed out.", "success");
    } catch (err) {
      setPasswordError(
        err instanceof ApiError ? err.message : "Could not change the passphrase",
      );
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Configuration</p>
          <h1>Settings</h1>
          <p className="page-lede">
            Account, security and the state of the local media engine.
          </p>
        </div>
      </header>

      <div className="settings-grid">
        <section className="panel settings-panel">
          <header className="section-head">
            <div>
              <h2>
                <UserRound size={15} /> Profile
              </h2>
              <p className="section-sub">Shown in the studio rail.</p>
            </div>
          </header>
          <form className="stack-form" onSubmit={saveProfile}>
            <label className="field">
              <span className="field-label">Display name</span>
              <input
                className="input"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                maxLength={80}
              />
            </label>
            <div>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={savingName || !displayName.trim() || displayName.trim() === user?.displayName}
              >
                {savingName ? <Loader2 size={15} className="spin" /> : <Save size={15} />}
                Save profile
              </button>
            </div>
          </form>
        </section>

        <section className="panel settings-panel">
          <header className="section-head">
            <div>
              <h2>
                <KeyRound size={15} /> Owner passphrase
              </h2>
              <p className="section-sub">
                Changing it signs out every other session.
              </p>
            </div>
          </header>
          <form className="stack-form" onSubmit={savePassword}>
            <label className="field">
              <span className="field-label">Current passphrase</span>
              <input
                className="input"
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                autoComplete="current-password"
              />
            </label>
            <div className="two-col">
              <label className="field">
                <span className="field-label">New passphrase</span>
                <input
                  className="input"
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  autoComplete="new-password"
                />
              </label>
              <label className="field">
                <span className="field-label">Confirm</span>
                <input
                  className="input"
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  autoComplete="new-password"
                />
              </label>
            </div>
            {passwordError ? (
              <p className="form-error" role="alert">{passwordError}</p>
            ) : null}
            <div>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={
                  savingPassword || !currentPassword || !newPassword || !confirmPassword
                }
              >
                {savingPassword ? <Loader2 size={15} className="spin" /> : <Check size={15} />}
                Change passphrase
              </button>
            </div>
          </form>
        </section>

        <section className="panel settings-panel">
          <header className="section-head">
            <div>
              <h2>
                <ShieldCheck size={15} /> System
              </h2>
              <p className="section-sub">Read directly from the running server.</p>
            </div>
          </header>
          <dl className="kv">
            <div className="kv-row">
              <dt>API</dt>
              <dd className="mono">{health?.ok ? "online" : health ? "degraded" : "unreachable"}</dd>
            </div>
            <div className="kv-row">
              <dt>Version</dt>
              <dd className="mono">{health?.version ?? "—"}</dd>
            </div>
            <div className="kv-row">
              <dt>FFmpeg</dt>
              <dd className="mono">{health ? (health.ffmpeg ? "available" : "missing") : "—"}</dd>
            </div>
            <div className="kv-row">
              <dt>Model provider</dt>
              <dd className="mono">
                {health ? (health.provider.configured ? "configured" : "not configured") : "—"}
              </dd>
            </div>
            <div className="kv-row">
              <dt>Database</dt>
              <dd className="mono">SQLite · local</dd>
            </div>
            <div className="kv-row">
              <dt>Media storage</dt>
              <dd className="mono">./data</dd>
            </div>
          </dl>
          <p className="inspector-hint">
            Provider keys are read by the server only. They are never included in
            API responses or shipped to the browser.
          </p>
        </section>
      </div>
    </div>
  );
}
