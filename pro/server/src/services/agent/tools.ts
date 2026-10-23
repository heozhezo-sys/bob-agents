import { z } from "zod";
import { createClipSchema } from "@ai-video-agent-studio/shared";
import { audit, mutate, nowIso } from "../../db/index.js";
import { AppError, badRequest } from "../../lib/errors.js";
import { parse } from "../../lib/validate.js";
import {
  createClip,
  deleteClip,
  splitClip,
  updateClip,
} from "../clipEdits.js";
import { createRenderJob } from "../renderService.js";
import { buildAgentState, type AgentProjectState } from "./state.js";
import type { AgentToolDef } from "./provider.js";

export interface ToolContext {
  userId: string;
  projectId: string;
  createdAssetIds: string[];
}

export interface ToolOutcome {
  ok: boolean;
  summary: string;
  state: AgentProjectState;
  thumbnailUrl?: string | null;
}

export const MUTATING_TOOLS = new Set([
  "update_clip",
  "split_clip",
  "delete_clip",
  "add_clip",
  "rename_project",
]);

export const TOOL_DEFS: AgentToolDef[] = [
  {
    type: "function",
    function: {
      name: "get_project",
      description: "Read the current project state: tracks, clips, assets and duration.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "update_clip",
      description:
        "Move or trim an existing clip. Times are integer milliseconds on the project timeline. durationMs is the visible length; inMs is the source offset.",
      parameters: {
        type: "object",
        properties: {
          clipId: { type: "string", description: "Clip id from the project state." },
          startMs: { type: "integer", minimum: 0 },
          durationMs: { type: "integer", minimum: 100 },
          inMs: { type: "integer", minimum: 0 },
        },
        required: ["clipId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "split_clip",
      description:
        "Split a clip at an absolute timeline position in milliseconds, leaving two clips.",
      parameters: {
        type: "object",
        properties: {
          clipId: { type: "string" },
          atMs: { type: "integer", minimum: 0 },
        },
        required: ["clipId", "atMs"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_clip",
      description: "Delete one clip from the timeline. The source file is kept.",
      parameters: {
        type: "object",
        properties: { clipId: { type: "string" } },
        required: ["clipId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_clip",
      description:
        "Add a stored source to the timeline. Without startMs it appends after the last clip on a compatible track.",
      parameters: {
        type: "object",
        properties: {
          assetId: { type: "string", description: "Asset id from the project state." },
          startMs: { type: "integer", minimum: 0 },
        },
        required: ["assetId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "rename_project",
      description: "Rename the project. The name is 1-120 characters.",
      parameters: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "start_export",
      description: "Queue a render of the current timeline through the real FFmpeg queue.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
];

function failure(message: string, projectId: string): ToolOutcome {
  return { ok: false, summary: message, state: buildAgentState(projectId) };
}

function describeAppError(error: AppError): string {
  const details = error.details ? ` ${JSON.stringify(error.details)}` : "";
  return `${error.message}${details}`.slice(0, 600);
}

export async function runAgentTool(
  name: string,
  rawArguments: string,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  let args: unknown;
  try {
    args = rawArguments.trim() ? JSON.parse(rawArguments) : {};
  } catch {
    return failure("The tool arguments were not valid JSON.", ctx.projectId);
  }

  try {
    switch (name) {
      case "get_project": {
        return {
          ok: true,
          summary: "Read the project state.",
          state: buildAgentState(ctx.projectId),
        };
      }
      case "update_clip": {
        const input = parse(
          z.object({
            clipId: z.string().uuid(),
            startMs: z.number().int().min(0).optional(),
            durationMs: z.number().int().min(100).optional(),
            inMs: z.number().int().min(0).optional(),
          }),
          args,
        );
        const patch: { startMs?: number; durationMs?: number; inMs?: number } = {};
        if (input.startMs !== undefined) patch.startMs = input.startMs;
        if (input.durationMs !== undefined) patch.durationMs = input.durationMs;
        if (input.inMs !== undefined) patch.inMs = input.inMs;

        const before = buildAgentState(ctx.projectId).clips.find(
          (clip) => clip.id === input.clipId,
        );
        updateClip(ctx.userId, ctx.projectId, input.clipId, patch);
        const state = buildAgentState(ctx.projectId);
        const after = state.clips.find((clip) => clip.id === input.clipId);
        const label = before?.assetName ?? "clip";
        return {
          ok: true,
          summary: `Updated "${label}" - start ${after?.startMs ?? 0} ms, length ${after?.durationMs ?? 0} ms.`,
          state,
        };
      }
      case "split_clip": {
        const input = parse(
          z.object({
            clipId: z.string().uuid(),
            atMs: z.number().int().min(0).max(6 * 60 * 60 * 1000),
          }),
          args,
        );
        splitClip(ctx.userId, ctx.projectId, input.clipId, { atMs: input.atMs });
        return {
          ok: true,
          summary: `Split the clip at ${input.atMs} ms.`,
          state: buildAgentState(ctx.projectId),
        };
      }
      case "delete_clip": {
        const input = parse(z.object({ clipId: z.string().uuid() }), args);
        const before = buildAgentState(ctx.projectId).clips.find(
          (clip) => clip.id === input.clipId,
        );
        deleteClip(ctx.userId, ctx.projectId, input.clipId);
        return {
          ok: true,
          summary: `Deleted "${before?.assetName ?? "clip"}". The source is kept.`,
          state: buildAgentState(ctx.projectId),
        };
      }
      case "add_clip": {
        const input = parse(createClipSchema, args);
        createClip(ctx.userId, ctx.projectId, input);
        const state = buildAgentState(ctx.projectId);
        const asset = state.assets.find((item) => item.id === input.assetId);
        return {
          ok: true,
          summary: `Added "${asset?.name ?? "source"}" to the timeline.`,
          state,
        };
      }
      case "rename_project": {
        const input = parse(
          z.object({ name: z.string().trim().min(1).max(120) }),
          args,
        );
        mutate(
          "UPDATE projects SET name = ?, updated_at = ? WHERE id = ?",
          input.name,
          nowIso(),
          ctx.projectId,
        );
        audit(ctx.userId, "project.rename", "project", ctx.projectId, {
          name: input.name,
        });
        return {
          ok: true,
          summary: `Renamed the project to "${input.name}".`,
          state: buildAgentState(ctx.projectId),
        };
      }
      case "start_export": {
        const { job } = createRenderJob(ctx.projectId, ctx.userId);
        return {
          ok: true,
          summary: `Queued export ${job.id.slice(0, 8)}.`,
          state: buildAgentState(ctx.projectId),
        };
      }
      default:
        throw badRequest(`Unknown tool "${name}"`);
    }
  } catch (error) {
    if (error instanceof AppError) return failure(describeAppError(error), ctx.projectId);
    throw error;
  }
}
