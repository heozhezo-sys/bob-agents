import crypto from "node:crypto";
import {
  type AgentAction,
  type AgentChatResult,
} from "@ai-video-agent-studio/shared";
import { config } from "../../config.js";
import { all, mutate, nowIso, one } from "../../db/index.js";
import { AppError } from "../../lib/errors.js";
import {
  ownedProject,
  projectDetail,
  snapshotProject,
  type ProjectSnapshot,
} from "../clipEdits.js";
import type { ProjectRow } from "../serializers.js";
import { loadConversation, type AgentMessageRow } from "./conversation.js";
import { mockProvider } from "./mock.js";
import { buildSystemPrompt } from "./prompt.js";
import { completeWithProvider, type ChatMessage } from "./provider.js";
import { MUTATING_TOOLS, TOOL_DEFS, runAgentTool } from "./tools.js";
import { buildAgentState } from "./state.js";

function insertMessage(
  projectId: string,
  role: "user" | "assistant",
  content: string,
  actions: AgentAction[],
  turnId: string | null,
) {
  const id = crypto.randomUUID();
  const createdAt = nowIso();
  mutate(
    `INSERT INTO agent_messages
      (id, project_id, role, content, actions_json, turn_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id,
    projectId,
    role,
    content,
    JSON.stringify(actions),
    turnId,
    createdAt,
  );
  return { id, role, content, actions, turnId, createdAt };
}

function describeFailure(error: unknown): string {
  if (error instanceof AppError) return error.message;
  return error instanceof Error ? error.message : "Unknown error";
}

export async function runAgentTurn(
  userId: string,
  projectId: string,
  message: string,
): Promise<AgentChatResult> {
  ownedProject(userId, projectId);
  if (config.agentProvider === "opencode" && !config.openCodeApiKey) {
    throw new AppError(
      503,
      "provider_not_configured",
      "The agent has no model key. Add OPENCODE_API_KEY to pro/.env, or run the server with AGENT_PROVIDER=mock.",
    );
  }

  const history = all<AgentMessageRow>(
    `SELECT * FROM agent_messages
      WHERE project_id = ? AND role IN ('user', 'assistant')
      ORDER BY created_at DESC, rowid DESC
      LIMIT 12`,
    projectId,
  ).reverse();

  insertMessage(projectId, "user", message, [], null);

  let state = buildAgentState(projectId);
  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(state) },
    ...history.map((row) => ({ role: row.role, content: row.content })),
    { role: "user", content: message },
  ];

  const actions: AgentAction[] = [];
  let snapshot: ProjectSnapshot | null = null;
  const createdAssetIds: string[] = [];
  let finalContent = "";
  const complete =
    config.agentProvider === "mock" ? mockProvider : completeWithProvider;

  try {
    for (let round = 0; round < 8; round += 1) {
      const reply = await complete({ messages, tools: TOOL_DEFS, state });

      if (reply.toolCalls.length === 0) {
        finalContent = reply.content.trim() || "Done.";
        break;
      }

      messages.push({
        role: "assistant",
        content: reply.content,
        tool_calls: reply.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: call.arguments },
        })),
      });

      for (const call of reply.toolCalls) {
        if (actions.length >= 12) {
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({
              ok: false,
              error: "The tool call limit for this turn was reached.",
            }),
          });
          continue;
        }

        if (MUTATING_TOOLS.has(call.name) && !snapshot) {
          snapshot = snapshotProject(projectId);
        }

        const outcome = await runAgentTool(call.name, call.arguments, {
          userId,
          projectId,
          createdAssetIds,
        });
        state = outcome.state;
        actions.push({
          tool: call.name,
          ok: outcome.ok,
          summary: outcome.summary,
          thumbnailUrl: outcome.thumbnailUrl,
        });
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(
            outcome.ok
              ? { ok: true, summary: outcome.summary, state }
              : { ok: false, error: outcome.summary, state },
          ).slice(0, 12_000),
        });
      }

      if (actions.length >= 12) break;
    }

    if (!finalContent) {
      finalContent = actions.length
        ? "I stopped after several steps. Tell me how to continue."
        : "I did not make a change. Tell me what to edit.";
    }
  } catch (error) {
    console.error("[agent] turn failed:", error);
    finalContent = actions.length
      ? `I made changes, then hit an error: ${describeFailure(error).slice(0, 300)}`
      : `I couldn't reach the model: ${describeFailure(error).slice(0, 300)}`;
  }

  const mutated = actions.some(
    (action) => action.ok && MUTATING_TOOLS.has(action.tool),
  );
  let turnId: string | null = null;
  if (mutated && snapshot) {
    turnId = crypto.randomUUID();
    const project = one<ProjectRow>(
      "SELECT * FROM projects WHERE id = ?",
      projectId,
    );
    mutate(
      `INSERT INTO agent_turns
        (id, project_id, snapshot_json, created_asset_ids_json, project_updated_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      turnId,
      projectId,
      JSON.stringify(snapshot),
      JSON.stringify(createdAssetIds),
      project?.updated_at ?? nowIso(),
      nowIso(),
    );
  }

  insertMessage(projectId, "assistant", finalContent, actions, turnId);

  return {
    project: projectDetail(userId, projectId),
    conversation: loadConversation(projectId),
  };
}
