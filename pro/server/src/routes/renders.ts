import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { all, one } from "../db/index.js";
import { requireAuth, requireCsrf } from "../lib/auth.js";
import { AppError, notFound } from "../lib/errors.js";
import { param } from "../lib/http.js";
import {
  createRenderJob,
  serializeRenderJob,
  type RenderJobRow,
} from "../services/renderService.js";

export const rendersRouter = Router();

const renderLimiter = rateLimit({
  windowMs: 60_000,
  limit: 6,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "rate_limited",
      message: "Too many render requests. Wait a minute and try again.",
    },
  },
});

interface OwnedProjectRow {
  id: string;
  name: string;
}

function ownedProject(userId: string, projectId: string): OwnedProjectRow {
  const row = one<OwnedProjectRow>(
    "SELECT id, name FROM projects WHERE id = ? AND owner_id = ?",
    projectId,
    userId,
  );
  if (!row) throw notFound("Project not found");
  return row;
}

interface OwnedRenderRow extends RenderJobRow {
  owner_id: string;
  project_name: string;
}

function ownedRender(userId: string, renderId: string): OwnedRenderRow {
  const row = one<OwnedRenderRow>(
    `SELECT r.*, p.owner_id, p.name AS project_name
       FROM render_jobs r
       JOIN projects p ON p.id = r.project_id
      WHERE r.id = ? AND p.owner_id = ?`,
    renderId,
    userId,
  );
  if (!row) throw notFound("Render not found");
  return row;
}

rendersRouter.post(
  "/projects/:id/renders",
  renderLimiter,
  requireAuth,
  requireCsrf,
  (req, res) => {
    const project = ownedProject(req.auth!.user.id, param(req, "id"));
    const { job } = createRenderJob(project.id, req.auth!.user.id);
    res.status(202).json({ job: serializeRenderJob(job) });
  },
);

rendersRouter.get("/projects/:id/renders", requireAuth, (req, res) => {
  const project = ownedProject(req.auth!.user.id, param(req, "id"));
  const rows = all<RenderJobRow>(
    "SELECT * FROM render_jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT 50",
    project.id,
  );
  res.json({ jobs: rows.map(serializeRenderJob) });
});

rendersRouter.get("/renders/:id", requireAuth, (req, res) => {
  const row = ownedRender(req.auth!.user.id, param(req, "id"));
  res.json({ job: serializeRenderJob(row) });
});

function parseRange(
  header: string,
  size: number,
): { start: number; end: number } | null {
  if (!header.startsWith("bytes=")) return null;
  const [rawStart, rawEnd] = header.slice(6).split("-");
  const start = rawStart ? Number.parseInt(rawStart, 10) : 0;
  const end = rawEnd ? Number.parseInt(rawEnd, 10) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start > end || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

function downloadName(projectName: string): string {
  const base = projectName.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return `${base || "render"}.mp4`;
}

rendersRouter.get("/renders/:id/file", requireAuth, async (req, res) => {
  const row = ownedRender(req.auth!.user.id, param(req, "id"));
  if (row.status !== "succeeded" || !row.output_path) {
    throw new AppError(409, "render_not_ready", "This render has not finished yet");
  }
  let stat: Awaited<ReturnType<typeof fsp.stat>>;
  try {
    stat = await fsp.stat(row.output_path);
  } catch {
    throw notFound("The rendered file is missing from disk");
  }

  const filename = downloadName(row.project_name);
  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
  res.setHeader(
    "Content-Disposition",
    `${req.query.download ? "attachment" : "inline"}; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  );

  const rangeHeader = req.headers.range;
  if (rangeHeader) {
    const range = parseRange(rangeHeader, stat.size);
    if (!range) {
      res.status(416).setHeader("Content-Range", `bytes */${stat.size}`);
      res.end();
      return;
    }
    res.status(206);
    res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${stat.size}`);
    res.setHeader("Content-Length", String(range.end - range.start + 1));
    fs.createReadStream(row.output_path, range).pipe(res);
    return;
  }

  res.setHeader("Content-Length", String(stat.size));
  fs.createReadStream(path.resolve(row.output_path)).pipe(res);
});
