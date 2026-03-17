import type { Database } from "bun:sqlite";

export type WindowType = "hourly" | "daily" | "monthly";

export interface WindowInfo {
  type: WindowType;
  start: number; // unix ms
}

export interface SpendCounter {
  keyHash: string;
  windowType: WindowType;
  windowStart: number;
  totalCost: number;
  requestCount: number;
}

/**
 * Compute the start timestamp (unix ms) for each window type.
 * All windows use UTC boundaries.
 */
export function getCurrentWindows(timestamp: number): WindowInfo[] {
  const date = new Date(timestamp);

  // Hourly: floor to current hour
  const hourly = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
  );

  // Daily: floor to current day
  const daily = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );

  // Monthly: floor to first of month
  const monthly = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    1,
  );

  return [
    { type: "hourly", start: hourly },
    { type: "daily", start: daily },
    { type: "monthly", start: monthly },
  ];
}

/**
 * Increment spend counters for all active windows (hourly, daily, monthly).
 * Uses UPSERT to atomically create or update the counter.
 */
export function incrementSpend(
  db: Database,
  keyHash: string,
  cost: number,
  timestamp: number,
): void {
  const windows = getCurrentWindows(timestamp);
  const stmt = db.prepare(`
    INSERT INTO spend_counters (key_hash, window_type, window_start, total_cost, request_count)
    VALUES (?, ?, ?, ?, 1)
    ON CONFLICT (key_hash, window_type, window_start)
    DO UPDATE SET total_cost = total_cost + excluded.total_cost, request_count = request_count + 1
  `);

  db.exec("BEGIN");
  try {
    for (const window of windows) {
      stmt.run(keyHash, window.type, window.start, cost);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/**
 * Get current spend for a specific key and window.
 */
export function getSpend(
  db: Database,
  keyHash: string,
  windowType: WindowType,
  windowStart: number,
): SpendCounter | null {
  const stmt = db.prepare(`
    SELECT key_hash, window_type, window_start, total_cost, request_count
    FROM spend_counters WHERE key_hash = ? AND window_type = ? AND window_start = ?
  `);

  const row = stmt.get(keyHash, windowType, windowStart) as {
    key_hash: string;
    window_type: string;
    window_start: number;
    total_cost: number;
    request_count: number;
  } | undefined;

  if (!row) return null;

  return {
    keyHash: row.key_hash,
    windowType: row.window_type as WindowType,
    windowStart: row.window_start,
    totalCost: row.total_cost,
    requestCount: row.request_count,
  };
}

/**
 * Get all spend counters for a key across all active windows.
 */
export function getAllSpend(
  db: Database,
  keyHash: string,
  timestamp: number,
): SpendCounter[] {
  const windows = getCurrentWindows(timestamp);
  const results: SpendCounter[] = [];

  for (const window of windows) {
    const counter = getSpend(db, keyHash, window.type, window.start);
    if (counter) {
      results.push(counter);
    }
  }

  return results;
}
