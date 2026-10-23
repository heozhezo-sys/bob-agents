import { Router } from "express";
import { requireAuth, requireCsrf } from "../lib/auth.js";
import { param } from "../lib/http.js";
import {
  createClip,
  deleteClip,
  splitClip,
  updateClip,
} from "../services/clipEdits.js";

export const clipsRouter = Router();

clipsRouter.patch("/:id/clips/:clipId", requireAuth, requireCsrf, (req, res) => {
  res.json({
    project: updateClip(
      req.auth!.user.id,
      param(req, "id"),
      param(req, "clipId"),
      req.body,
    ),
  });
});

clipsRouter.post("/:id/clips/:clipId/split", requireAuth, requireCsrf, (req, res) => {
  res.status(201).json({
    project: splitClip(
      req.auth!.user.id,
      param(req, "id"),
      param(req, "clipId"),
      req.body,
    ),
  });
});

clipsRouter.delete("/:id/clips/:clipId", requireAuth, requireCsrf, (req, res) => {
  res.json({
    project: deleteClip(req.auth!.user.id, param(req, "id"), param(req, "clipId")),
  });
});

clipsRouter.post("/:id/clips", requireAuth, requireCsrf, (req, res) => {
  res.status(201).json({
    project: createClip(req.auth!.user.id, param(req, "id"), req.body),
  });
});
