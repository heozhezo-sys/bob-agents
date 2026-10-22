import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { loginSchema } from "@ai-video-agent-studio/shared";
import { one, mutate, nowIso } from "../db/index.js";
import {
  clearSessionCookie,
  createSession,
  destroySession,
  hashPassword,
  recordLogin,
  requireAuth,
  requireCsrf,
  setSessionCookie,
  verifyPassword,
  type UserRow,
} from "../lib/auth.js";
import { badRequest, unauthorized } from "../lib/errors.js";
import { parse } from "../lib/validate.js";

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 60_000,
  limit: 8,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: { code: "rate_limited", message: "Too many login attempts. Wait a minute." } },
});

function publicUser(row: UserRow) {
  return {
    id: row.id,
    displayName: row.display_name,
    role: row.role,
  };
}

authRouter.post("/login", loginLimiter, async (req, res) => {
  const { password } = parse(loginSchema, req.body);
  const user = one<UserRow & { password_hash: string }>(
    "SELECT * FROM users ORDER BY created_at ASC LIMIT 1",
  );
  if (!user || !verifyPassword(password, user.password_hash)) {
    throw unauthorized("Incorrect password");
  }
  const session = createSession(user.id);
  setSessionCookie(res, session.token);
  recordLogin(user.id, req.ip);
  res.json({ user: publicUser(user), csrfToken: session.csrfToken });
});

authRouter.get("/me", requireAuth, (req, res) => {
  const auth = req.auth!;
  res.json({ user: publicUser(auth.user), csrfToken: auth.session.csrf_token });
});

authRouter.post("/logout", requireAuth, requireCsrf, (req, res) => {
  destroySession(req.auth!.session.id);
  clearSessionCookie(res);
  res.json({ ok: true });
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "Use at least 8 characters").max(500),
});

authRouter.post("/password", requireAuth, requireCsrf, (req, res) => {
  const { currentPassword, newPassword } = parse(changePasswordSchema, req.body);
  const auth = req.auth!;
  const user = one<UserRow & { password_hash: string }>(
    "SELECT * FROM users WHERE id = ?",
    auth.user.id,
  );
  if (!user || !verifyPassword(currentPassword, user.password_hash)) {
    throw badRequest("Current password is incorrect");
  }
  mutate(
    "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?",
    hashPassword(newPassword),
    nowIso(),
    user.id,
  );
  mutate("DELETE FROM sessions WHERE user_id = ? AND id <> ?", user.id, auth.session.id);
  res.json({ ok: true });
});

const updateProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
});

authRouter.patch("/profile", requireAuth, requireCsrf, (req, res) => {
  const { displayName } = parse(updateProfileSchema, req.body);
  const auth = req.auth!;
  mutate(
    "UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?",
    displayName,
    nowIso(),
    auth.user.id,
  );
  res.json({ ok: true, displayName });
});
