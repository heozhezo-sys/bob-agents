import crypto from "node:crypto";
import type { ProviderInput, ProviderReply } from "./provider.js";

const CAPABILITIES =
  "I can trim, split, move or delete clips, add a source, generate a motion card, rename the project, or start an export.";

export function mockProvider(input: ProviderInput): ProviderReply {
  const last = input.messages[input.messages.length - 1];
  if (last?.role === "tool") {
    return { content: "Done. The timeline is updated.", toolCalls: [] };
  }

  const text =
    [...input.messages]
      .reverse()
      .find((message) => message.role === "user")
      ?.content.toLowerCase() ?? "";
  const { state } = input;
  const videoClips = state.clips.filter((clip) => clip.kind === "video");
  const clip = videoClips[0] ?? state.clips[0];
  const lastVideoClip = videoClips[videoClips.length - 1];

  const call = (name: string, args: unknown): ProviderReply => ({
    content: "",
    toolCalls: [
      {
        id: `mock-${crypto.randomUUID()}`,
        name,
        arguments: JSON.stringify(args),
      },
    ],
  });

  if (text.includes("trim")) {
    if (!clip) return { content: "This project has no clips to trim yet.", toolCalls: [] };
    return call("update_clip", {
      clipId: clip.id,
      durationMs: Math.max(100, clip.durationMs - 1000),
    });
  }
  if (text.includes("split")) {
    if (!clip) return { content: "This project has no clips to split yet.", toolCalls: [] };
    return call("split_clip", {
      clipId: clip.id,
      atMs: clip.startMs + Math.floor(clip.durationMs / 2),
    });
  }
  if (text.includes("delete")) {
    if (!lastVideoClip) {
      return { content: "This project has no video clip to delete.", toolCalls: [] };
    }
    return call("delete_clip", { clipId: lastVideoClip.id });
  }
  if (text.includes("motion") || text.includes("chart") || text.includes("title card")) {
    if (text.includes("bar") || text.includes("chart")) {
      return call("create_motion_graphic", {
        layout: "bars",
        title: "Weekly output",
        subtitle: "Renders per day",
        accent: "#ff8a3d",
        bars: [
          { label: "Mon", value: 4 },
          { label: "Tue", value: 7 },
          { label: "Wed", value: 5 },
          { label: "Thu", value: 9 },
        ],
      });
    }
    if (text.includes("bullet")) {
      return call("create_motion_graphic", {
        layout: "bullets",
        title: "Launch plan",
        subtitle: "Three steps to the first cut",
        bullets: [
          "Upload the source footage",
          "Generate the title cards",
          "Export the master",
        ],
      });
    }
    return call("create_motion_graphic", {
      layout: "title",
      title: "Agent cut",
      subtitle: "Made in CUTROOM",
    });
  }
  if (text.includes("add")) {
    const asset = state.assets.find((item) => item.kind === "video") ?? state.assets[0];
    if (!asset) return { content: "This project has no source to add.", toolCalls: [] };
    return call("add_clip", { assetId: asset.id });
  }
  if (text.includes("rename")) {
    return call("rename_project", { name: "Agent cut" });
  }
  if (text.includes("export")) {
    return call("start_export", {});
  }

  return { content: CAPABILITIES, toolCalls: [] };
}
