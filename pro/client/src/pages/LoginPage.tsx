import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import {
  Eye,
  EyeOff,
  HardDrive,
  Loader2,
  LockKeyhole,
  ScanLine,
  Timeline,
} from "lucide-react";
import { Brand } from "../components/Brand";
import { useAuth } from "../store/auth";
import { ApiError } from "../api";

export function LoginPage() {
  const { status, login } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (status === "authenticated") {
    return <Navigate to="/" replace />;
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!password.trim()) {
      setError("Enter your studio passphrase.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await login(password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not sign in. Check the server and try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      <section className="auth-brand-panel">
        <Brand size={34} subtitle />

        <div className="auth-pitch">
          <p className="eyebrow">Local-first video studio</p>
          <h1>
            Cut real video.
            <br />
            Direct it like a
            <br />
            <span className="auth-accent">room full of editors.</span>
          </h1>
          <p className="auth-lede">
            A working edit bay for footage you actually own: source-accurate
            previews, a persistent timeline, and an agent that operates the tools
            instead of pretending to.
          </p>

          <ul className="auth-features">
            <li>
              <ScanLine size={17} aria-hidden="true" />
              <span>
                <strong>Real media, inspected.</strong> FFprobe metadata,
                thumbnails and waveforms generated from your files.
              </span>
            </li>
            <li>
              <Timeline size={17} aria-hidden="true" />
              <span>
                <strong>A timeline that persists.</strong> Clips are database
                records, not stage props that vanish on refresh.
              </span>
            </li>
            <li>
              <HardDrive size={17} aria-hidden="true" />
              <span>
                <strong>Your media stays here.</strong> Local storage and a
                single-owner passphrase.
              </span>
            </li>
          </ul>
        </div>

        <div className="auth-strip" aria-hidden="true">
          <span className="strip-frame" />
          <span className="strip-frame" />
          <span className="strip-frame" />
          <span className="strip-play" />
          <span className="strip-frame" />
          <span className="strip-frame" />
          <span className="strip-frame" />
        </div>

        <p className="auth-footnote mono">
          BUILD 0.1 · UPLOAD, PROBE &amp; TIMELINE LIVE
        </p>
      </section>

      <section className="auth-form-panel">
        <div className="auth-card">
          <div className="auth-card-icon" aria-hidden="true">
            <LockKeyhole size={20} />
          </div>
          <h2>Sign in to your studio</h2>
          <p className="auth-card-copy">
            One owner passphrase protects this workspace. It is never sent to a
            third party.
          </p>

          <form onSubmit={onSubmit} className="auth-form">
            <label className="field">
              <span className="field-label">Passphrase</span>
              <span className="password-wrap">
                <input
                  className="input"
                  type={show ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter your passphrase"
                  autoComplete="current-password"
                  autoFocus
                  aria-invalid={error ? true : undefined}
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShow((value) => !value)}
                  aria-label={show ? "Hide passphrase" : "Show passphrase"}
                >
                  {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </span>
            </label>

            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : null}

            <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
              {submitting ? <Loader2 size={16} className="spin" /> : null}
              {submitting ? "Signing in" : "Enter studio"}
            </button>
          </form>

          <p className="auth-hint">
            The owner passphrase comes from <code>APP_PASSWORD</code>. On a fresh
            install it is printed once in the server log.
          </p>
        </div>
      </section>
    </div>
  );
}
