import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { paths, ensureDataDirs } from "../config.js";
import { migrations } from "./migrations.js";

let instance: DatabaseSync | null = null;

export function nowIso(): string {
  return new Date().toISOString();
}

export function initDb(file: string = paths.db): DatabaseSync {
  if (instance) return instance;
  if (file !== ":memory:") {
    ensureDataDirs();
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  runMigrations(db);
  instance = db;
  return db;
}

export function getDb(): DatabaseSync {
  if (!instance) return initDb();
  return instance;
}

export function closeDb(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}

export function runMigrations(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
  const applied = new Set(
    db.prepare("SELECT id FROM schema_migrations").all().map((row) => String(row.id)),
  );
  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(
        migration.id,
        nowIso(),
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}

export function one<T>(sql: string, ...params: unknown[]): T | null {
  const row = getDb().prepare(sql).get(...(params as never[]));
  return (row as T | undefined) ?? null;
}

export function all<T>(sql: string, ...params: unknown[]): T[] {
  return getDb()
    .prepare(sql)
    .all(...(params as never[])) as T[];
}

export function mutate(sql: string, ...params: unknown[]): void {
  getDb().prepare(sql).run(...(params as never[]));
}

export function audit(
  userId: string | null,
  action: string,
  entityType?: string,
  entityId?: string,
  detail?: unknown,
): void {
  mutate(
    `INSERT INTO audit_events (id, user_id, action, entity_type, entity_id, detail_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    crypto.randomUUID(),
    userId,
    action,
    entityType ?? null,
    entityId ?? null,
    detail === undefined ? null : JSON.stringify(detail),
    nowIso(),
  );
}
