import { useEffect, useState } from "react";
import type { MediaAsset } from "@ai-video-agent-studio/shared";
import { getWaveform } from "../api";

export function useWaveforms(assets: MediaAsset[]): Record<string, number[]> {
  const [waveforms, setWaveforms] = useState<Record<string, number[]>>({});
  const key = assets.map((asset) => asset.id).join(",");

  useEffect(() => {
    let cancelled = false;
    const candidates = assets
      .filter((asset) => asset.kind === "audio" || asset.kind === "video")
      .slice(0, 24);
    void Promise.all(
      candidates.map(async (asset) => {
        const data = await getWaveform(asset.id);
        return [asset.id, data?.peaks ?? []] as const;
      }),
    ).then((entries) => {
      if (cancelled) return;
      const next: Record<string, number[]> = {};
      for (const [id, peaks] of entries) {
        if (peaks.length > 0) next[id] = peaks;
      }
      setWaveforms(next);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return waveforms;
}
