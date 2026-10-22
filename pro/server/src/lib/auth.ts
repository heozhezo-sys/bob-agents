import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";
import { all, audit, mutate, nowIso, one } from "../db/index.js";
import { unauthorized, forbidden } from "./errors.js";

export const SESSION_COOKIE = "cutroom_session";

export interface UserRow {
  id: string;
  display_name: string;
  role: "owner" | "editor" | "viewer";
  created_at: string;
  updated_at: string;
}

export interface SessionRow {
  id: string;
  user_id: string;
  csrf_token: string;
  expires_at: string;
}

const KEY_LENGTH = 64;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .scryptSync(password, salt, KEY_LENGTH, SCRYPT_PARAMS)
    .toString("hex");
  return `scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, salt, expected] = parts;
  try {
    const derived = crypto.scryptSync(password, salt, KEY_LENGTH, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    const expectedBuf = Buffer.from(expected, "hex");
    if (expectedBuf.length !== derived.length) return false;
    return crypto.timingSafeEqual(derived, expectedBuf);
  } catch {
    return false;
  }
}

function generatePassphrase(): string {
  const words = [
    "amber",
    "cinema",
    "cut",
    "frame",
    "grain",
    "light",
    "lens",
    "motion",
    "reel",
    "score",
    "shot",
    "studio",
  ];
  const picks = Array.from({ length: 4 }, () =>
    words[crypto.randomInt(0, words.length)],
  );
  const digits = String(crypto.randomInt(1000, 9999));
  return `${picks.join("-")}-${digits}`;
}

export function ensureOwnerAccount(log: (msg: string) => void): void {
  const count = one<{ c: number }>("SELECT COUNT(*) AS c FROM users");
  const hasUsers = (count?.c ?? 0) > 0;

  if (!hasUsers) {
    const password = config.appPassword || generatePassphrase();
    const now = nowIso();
    mutate(
      `INSERT INTO users (id, display_name, password_hash, role, created_at, updated_at)
       VALUES (?, ?, ?, 'owner', ?, ?)`,
      crypto.randomUUID(),
      "Owner",
      hashPassword(password),
      now,
      now,
    );
    if (!config.appPassword) {
      log(
        [
          "",
          "  ┌──────────────────────────────────────────────────────────────┐",
          "  │  CUTROOM owner password (store this somewhere safe)          │",
          `  │  ${password.padEnd(58)}│`,
          "  │  Set APP_PASSWORD in Platform → Secrets to choose your own.   │",
          "  └──────────────────────────────────────────────────────────────┘",
          "",
        ].join("\n"),
      );
    }
  } else if (config.resetPassword && config.appPassword) {
    const owner = one<UserRow>("SELECT * FROM users WHERE role = 'owner' LIMIT 1");
    if (owner) {
      mutate(
        "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?",
        hashPassword(config.appPassword),
        nowIso(),
        owner.id,
      );
      log("[auth] Owner password reset from APP_PASSWORD.");
    }
  }

  const expired = mutate("DELETE FROM sessions WHERE expires_at < ?", nowIso());
  void expired;
}

export interface AuthContext {
  user: UserRow;
  session: SessionRow;
}

export function readAuth(req: Request): AuthContext | null {
  const raw = req.cookies?.[SESSION_COOKIE] as string | undefined;
  if (!raw) return null;
  const tokenHash = crypto.createHash("sha256").update(raw).digest("hex");
  const row = one<SessionRow & { user_id: string; display_name: string; role: string }>(
    `SELECT s.id, s.user_id, s.csrf_token, s.expires_at,
            u.display_name, u.role
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?`,
    tokenHash,
  );
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    mutate("DELETE FROM sessions WHERE id = ?", row.id);
    return null;
  }
  return {
    user: {
      id: row.user_id,
      display_name: row.display_name,
      role: row.role as UserRow["role"],
      created_at: "",
      updated_at: "",
    },
    session: {
      id: row.id,
      user_id: row.user_id,
      csrf_token: row.csrf_token,
      expires_at: row.expires_at,
    },
  };
}

export function createSession(userId: string): { token: string; csrfToken: string } {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const csrfToken = crypto.randomBytes(24).toString("base64url");
  const now = new Date();
  const expires = new Date(now.getTime() + config.sessionTtlDays * 24 * 60 * 60 * 1000);
  mutate(
    `INSERT INTO sessions (id, user_id, token_hash, csrf_token, expires_at, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    crypto.randomUUID(),
    userId,
    tokenHash,
    csrfToken,
    expires.toISOString(),
    now.toISOString(),
    now.toISOString(),
  );
  return { token, csrfToken };
}

export function destroySession(sessionId: string): void {
  mutate("DELETE FROM sessions WHERE id = ?", sessionId);
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.nodeEnv === "production",
    path: "/",
    maxAge: config.sessionTtlDays * 24 * 60 * 60 * 1000,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const auth = readAuth(req);
  if (!auth) {
    next(unauthorized());
    return;
  }
  req.auth = auth;
  next();
}

export function requireCsrf(req: Request, _res: Response, next: NextFunction): void {
  const auth = req.auth;
  if (!auth) {
    next(unauthorized());
    return;
  }
  const header = req.get("x-csrf-token") ?? "";
  const expected = auth.session.csrf_token;
  if (header.length !== expected.length) {
    next(forbidden("Invalid CSRF token"));
    return;
  }
  const ok = crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected));
  if (!ok) {
    next(forbidden("Invalid CSRF token"));
    return;
  }
  next();
}

export function requireRole(...roles: UserRow["role"][]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(unauthorized());
      return;
    }
    if (!roles.includes(req.auth.user.role)) {
      next(forbidden("Insufficient permissions"));
      return;
    }
    next();
  };
}

export function listSessionsForUser(userId: string): SessionRow[] {
  return all<SessionRow>("SELECT * FROM sessions WHERE user_id = ?", userId);
}

export function recordLogin(userId: string, ip: string | undefined): void {
  audit(userId, "auth.login", "user", userId, { ip: ip ?? null });
}
