import { Router } from "express";
import { agentChatSchema } from "@ai-video-agent-studio/shared";
import { requireAuth, requireCsrf } from "../lib/auth.js";
import { param } from "../lib/http.js";
import { parse } from "../lib/validate.js";
import { projectDetail } from "../services/clipEdits.js";
import { loadConversation } from "../services/agent/conversation.js";
import { runAgentTurn } from "../services/agent/run.js";
import { undoTurn } from "../services/agent/undo.js";

export const agentRouter = Router();

agentRouter.get("/projects/:id", requireAuth, (req, res) => {
  const project = projectDetail(req.auth!.user.id, param(req, "id"));
  res.json({ project, conversation: loadConversation(project.id) });
});

agentRouter.post("/chat", requireAuth, requireCsrf, async (req, res) => {
  const input = parse(agentChatSchema, req.body);
  const result = await runAgentTurn(
    req.auth!.user.id,
    input.projectId,
    input.message,
  );
  res.json(result);
});

agentRouter.post("/turns/:turnId/undo", requireAuth, requireCsrf, async (req, res) => {
  const project = await undoTurn(req.auth!.user.id, param(req, "turnId"));
  res.json({ project, conversation: loadConversation(project.id) });
});
