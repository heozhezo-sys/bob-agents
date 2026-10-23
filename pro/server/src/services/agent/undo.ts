import { type ProjectDetail } from "@ai-video-agent-studio/shared";
import { audit, getDb, mutate, nowIso, one } from "../../db/index.js";
import { conflict, notFound } from "../../lib/errors.js";
import {
  ownedProject,
  projectDetail,
  type ProjectSnapshot,
} from "../clipEdits.js";
import { deleteAssetFiles, type MediaRow } from "../mediaService.js";

interface AgentTurnRow {
  id: string;
  project_id: string;
  snapshot_json: string;
  created_asset_ids_json: string;
  project_updated_at: string;
  created_at: string;
  undone_at: string | null;
}

export async function undoTurn(
  userId: string,
  turnId: string,
): Promise<ProjectDetail> {
  const turn = one<AgentTurnRow>("SELECT * FROM agent_turns WHERE id = ?", turnId);
  if (!turn) throw notFound("Agent turn not found");

  const project = ownedProject(userId, turn.project_id);
  if (turn.undone_at) throw conflict("That turn was already undone.");

  const latest = one<{ id: string }>(
    `SELECT id FROM agent_turns
      WHERE project_id = ? AND undone_at IS NULL
      ORDER BY created_at DESC, rowid DESC
      LIMIT 1`,
    project.id,
  );
  if (latest?.id !== turn.id) {
    throw conflict("Only the latest agent turn can be undone.");
  }
  if (project.updated_at !== turn.project_updated_at) {
    throw conflict("The project changed after that turn, so undo is unavailable.");
  }

  const snapshot: ProjectSnapshot = JSON.parse(turn.snapshot_json);
  const createdAssetIds: string[] = JSON.parse(turn.created_asset_ids_json);
  const db = getDb();

  db.exec("BEGIN IMMEDIATE");
  try {
    mutate(
      "DELETE FROM clips WHERE track_id IN (SELECT id FROM tracks WHERE project_id = ?)",
      project.id,
    );
    for (const clip of snapshot.clips) {
      mutate(
        `INSERT INTO clips
          (id, track_id, asset_id, kind, start_ms, duration_ms, in_ms, out_ms,
           x, y, scale, rotation, opacity, text, style_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        clip.id,
        clip.track_id,
        clip.asset_id,
        clip.kind,
        clip.start_ms,
        clip.duration_ms,
        clip.in_ms,
        clip.out_ms,
        clip.x,
        clip.y,
        clip.scale,
        clip.rotation,
        clip.opacity,
        clip.text,
        clip.style_json,
        clip.created_at,
      );
    }
    mutate(
      "UPDATE projects SET name = ?, updated_at = ? WHERE id = ?",
      snapshot.name,
      nowIso(),
      project.id,
    );
    mutate("UPDATE agent_turns SET undone_at = ? WHERE id = ?", nowIso(), turn.id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  audit(userId, "agent.undo", "agent_turn", turn.id, {});

  for (const assetId of createdAssetIds) {
    const referenced = one<{ id: string }>(
      "SELECT id FROM clips WHERE asset_id = ? LIMIT 1",
      assetId,
    );
    if (referenced) continue;
    const asset = one<MediaRow>(
      "SELECT * FROM media_assets WHERE id = ? AND project_id = ?",
      assetId,
      project.id,
    );
    if (!asset) continue;
    mutate("DELETE FROM media_assets WHERE id = ?", assetId);
    await deleteAssetFiles(asset).catch((error: unknown) => {
      console.error("[agent] could not remove generated asset files:", error);
    });
  }

  return projectDetail(userId, project.id);
}
