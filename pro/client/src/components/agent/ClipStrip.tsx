import {
  formatDuration,
  type ProjectDetail,
} from "@ai-video-agent-studio/shared";

export function ClipStrip({ project }: { project: ProjectDetail }) {
  const total = Math.max(project.durationMs, 1);
  return (
    <div className="clip-strip" aria-label="Timeline overview">
      <div className="clip-strip-head">
        <span>Timeline</span>
        <span className="mono">{formatDuration(project.durationMs)}</span>
      </div>
      <div className="clip-strip-tracks">
        {project.tracks.map((track) => (
          <div className="clip-strip-track" key={track.id}>
            <span className="clip-strip-label">{track.name}</span>
            <div className="clip-strip-lane">
              {track.clips.map((clip) => {
                const asset = project.assets.find((item) => item.id === clip.assetId);
                const label = asset?.originalName ?? clip.text ?? clip.kind;
                return (
                  <span
                    key={clip.id}
                    className={`clip-strip-clip ${clip.kind}`}
                    style={{
                      left: `${(clip.startMs / total) * 100}%`,
                      width: `${Math.max((clip.durationMs / total) * 100, 1.5)}%`,
                    }}
                    title={`${label} · ${formatDuration(clip.durationMs)}`}
                  >
                    {label}
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
