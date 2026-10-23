import {
  type AgentAction,
  type AgentConversation,
} from "@ai-video-agent-studio/shared";
import { config } from "../../config.js";
import { all, one } from "../../db/index.js";
import type { ProjectRow } from "../serializers.js";

export interface AgentMessageRow {
  id: string;
  project_id: string;
  role: "user" | "assistant";
  content: string;
  actions_json: string;
  turn_id: string | null;
  created_at: string;
}

interface AgentTurnRow {
  id: string;
  project_id: string;
  snapshot_json: string;
  created_asset_ids_json: string;
  project_updated_at: string;
  created_at: string;
  undone_at: string | null;
}

function parseActions(value: string): AgentAction[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as AgentAction[]) : [];
  } catch {
    return [];
  }
}

export function loadConversation(projectId: string): AgentConversation {
  const rows = all<AgentMessageRow>(
    `SELECT * FROM agent_messages
      WHERE project_id = ?
      ORDER BY created_at DESC, rowid DESC
      LIMIT 50`,
    projectId,
  ).reverse();

  const project = one<ProjectRow>("SELECT * FROM projects WHERE id = ?", projectId);
  const latestTurn = one<AgentTurnRow>(
    `SELECT * FROM agent_turns
      WHERE project_id = ? AND undone_at IS NULL
      ORDER BY created_at DESC, rowid DESC
      LIMIT 1`,
    projectId,
  );
  const canUndo = Boolean(
    latestTurn && project && latestTurn.project_updated_at === project.updated_at,
  );

  return {
    messages: rows.map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      actions: parseActions(row.actions_json),
      turnId: row.turn_id,
      createdAt: row.created_at,
    })),
    canUndo,
    undoBlockedReason:
      latestTurn && !canUndo
        ? "The project changed after this turn, so undo is unavailable."
        : null,
    turnId: latestTurn?.id ?? null,
    provider: {
      name: config.agentProvider,
      model: config.openCodeModel,
      configured: config.agentProvider === "mock" || Boolean(config.openCodeApiKey),
    },
  };
}
