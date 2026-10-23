import crypto from "node:crypto";
import { config } from "../../config.js";
import { AppError } from "../../lib/errors.js";
import type { AgentProjectState } from "./state.js";

export interface WireToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: WireToolCall[];
  tool_call_id?: string;
}

export interface AgentToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface AgentToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ProviderReply {
  content: string;
  toolCalls: AgentToolCall[];
}

export interface ProviderInput {
  messages: ChatMessage[];
  tools: AgentToolDef[];
  state: AgentProjectState;
}

interface WireResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
}

export async function completeWithProvider(
  input: ProviderInput,
): Promise<ProviderReply> {
  if (!config.openCodeApiKey) {
    throw new AppError(
      503,
      "provider_not_configured",
      "The agent has no model key. Add OPENCODE_API_KEY to pro/.env, or run the server with AGENT_PROVIDER=mock.",
    );
  }

  const baseUrl = config.openCodeBaseUrl.replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.openCodeApiKey}`,
    },
    body: JSON.stringify({
      model: config.openCodeModel,
      messages: input.messages,
      tools: input.tools,
      tool_choice: "auto",
    }),
    signal: AbortSignal.timeout(90_000),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 400);
    throw new AppError(
      502,
      "provider_error",
      `The model provider returned ${response.status}. ${detail}`,
    );
  }

  const data = (await response.json()) as WireResponse;
  const message = data.choices?.[0]?.message;
  if (!message) {
    throw new AppError(502, "provider_error", "The model provider returned no message.");
  }

  return {
    content: typeof message.content === "string" ? message.content : "",
    toolCalls: (message.tool_calls ?? []).flatMap((call) => {
      const name = call.function?.name;
      if (!name) return [];
      return [
        {
          id: call.id ?? crypto.randomUUID(),
          name,
          arguments: call.function?.arguments ?? "{}",
        },
      ];
    }),
  };
}
