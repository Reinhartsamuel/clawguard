import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type { Database } from "bun:sqlite";

let instance: Database | null = null;

const MIGRATIONS = `
  CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    cache_read_tokens INTEGER NOT NULL DEFAULT 0,
    cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL,
    estimated_cost REAL NOT NULL,
    is_estimated INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_requests_key_hash ON requests(key_hash);
  CREATE INDEX IF NOT EXISTS idx_requests_created_at ON requests(created_at);

  CREATE TABLE IF NOT EXISTS spend_counters (
    key_hash TEXT NOT NULL,
    window_type TEXT NOT NULL,
    window_start INTEGER NOT NULL,
    total_cost REAL NOT NULL DEFAULT 0,
    request_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (key_hash, window_type, window_start)
  );

  CREATE TABLE IF NOT EXISTS baselines (
    key_hash TEXT NOT NULL,
    metric TEXT NOT NULL,
    ema_value REAL NOT NULL DEFAULT 0,
    ema_variance REAL NOT NULL DEFAULT 0,
    sample_count INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (key_hash, metric)
  );

  CREATE TABLE IF NOT EXISTS frozen_keys (
    key_hash TEXT PRIMARY KEY,
    frozen_at INTEGER NOT NULL,
    reason TEXT NOT NULL DEFAULT 'manual'
  );

  CREATE TABLE IF NOT EXISTS key_policies (
    key_hash TEXT PRIMARY KEY,
    label TEXT,
    budget_hourly REAL,
    budget_daily REAL,
    budget_monthly REAL,
    anomaly_warn_mult REAL,
    anomaly_pause_mult REAL,
    anomaly_kill_mult REAL,
    loop_enabled INTEGER,
    updated_at INTEGER NOT NULL
  );
`;

export function openDb(dbPath?: string): Database {
  const path = dbPath ?? process.env["CLAWGUARD_DB_PATH"] ?? "data/clawguard.db";

  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new Database(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec(MIGRATIONS);

  // Idempotent column additions for existing databases
  for (const col of ["cache_read_tokens INTEGER NOT NULL DEFAULT 0", "cache_creation_tokens INTEGER NOT NULL DEFAULT 0"]) {
    try { db.exec(`ALTER TABLE requests ADD COLUMN ${col}`); } catch { /* already exists */ }
  }

  return db;
}

export function getDb(): Database {
  if (!instance) {
    instance = openDb();
  }
  return instance;
}

export function closeDb(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}
