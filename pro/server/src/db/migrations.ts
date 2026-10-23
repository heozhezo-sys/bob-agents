export interface Migration {
  id: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    id: "001_init",
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'owner',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        csrf_token TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_seen_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        name TEXT NOT NULL,
        width INTEGER NOT NULL DEFAULT 1920,
        height INTEGER NOT NULL DEFAULT 1080,
        fps INTEGER NOT NULL DEFAULT 30,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS media_assets (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        original_name TEXT NOT NULL,
        storage_path TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        duration_ms INTEGER,
        width INTEGER,
        height INTEGER,
        fps REAL,
        video_codec TEXT,
        audio_codec TEXT,
        sample_rate INTEGER,
        channels INTEGER,
        bitrate INTEGER,
        thumbnail_path TEXT,
        waveform_path TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_media_project ON media_assets(project_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS tracks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        locked INTEGER NOT NULL DEFAULT 0,
        hidden INTEGER NOT NULL DEFAULT 0,
        muted INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_tracks_project ON tracks(project_id, position);

      CREATE TABLE IF NOT EXISTS clips (
        id TEXT PRIMARY KEY,
        track_id TEXT NOT NULL,
        asset_id TEXT,
        kind TEXT NOT NULL,
        start_ms INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        in_ms INTEGER NOT NULL DEFAULT 0,
        out_ms INTEGER,
        x REAL,
        y REAL,
        scale REAL,
        rotation REAL,
        opacity REAL,
        text TEXT,
        style_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE,
        FOREIGN KEY (asset_id) REFERENCES media_assets(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_clips_track ON clips(track_id, start_ms);

      CREATE TABLE IF NOT EXISTS keyframes (
        id TEXT PRIMARY KEY,
        clip_id TEXT NOT NULL,
        property TEXT NOT NULL,
        time_ms INTEGER NOT NULL,
        value REAL NOT NULL,
        easing TEXT NOT NULL DEFAULT 'linear',
        FOREIGN KEY (clip_id) REFERENCES clips(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_keyframes_clip ON keyframes(clip_id, property, time_ms);

      CREATE TABLE IF NOT EXISTS transcripts (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL,
        language TEXT,
        provider TEXT NOT NULL,
        model TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (asset_id) REFERENCES media_assets(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS transcript_segments (
        id TEXT PRIMARY KEY,
        transcript_id TEXT NOT NULL,
        idx INTEGER NOT NULL,
        start_ms INTEGER NOT NULL,
        end_ms INTEGER NOT NULL,
        text TEXT NOT NULL,
        speaker TEXT,
        words_json TEXT,
        FOREIGN KEY (transcript_id) REFERENCES transcripts(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_segments_transcript ON transcript_segments(transcript_id, idx);

      CREATE TABLE IF NOT EXISTS render_jobs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        progress REAL NOT NULL DEFAULT 0,
        output_path TEXT,
        error TEXT,
        log TEXT,
        plan_json TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_render_project ON render_jobs(project_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        action TEXT NOT NULL,
        entity_type TEXT,
        entity_id TEXT,
        detail_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_events(created_at DESC);

      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
  {
    id: "002_agent",
    sql: `
      CREATE TABLE IF NOT EXISTS agent_messages (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        actions_json TEXT NOT NULL DEFAULT '[]',
        turn_id TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_agent_messages_project
        ON agent_messages(project_id, created_at);

      CREATE TABLE IF NOT EXISTS agent_turns (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        created_asset_ids_json TEXT NOT NULL DEFAULT '[]',
        project_updated_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        undone_at TEXT,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_agent_turns_project
        ON agent_turns(project_id, created_at DESC);
    `,
  },
];
