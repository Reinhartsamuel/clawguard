import { djb2 } from "../utils/hash.js";
import { getSpend, getCurrentWindows } from "../store/counters.js";
import type { Database } from "bun:sqlite";

export interface LoopConfig {
  enabled: boolean;
  /** Deny when the same content hash appears this many times within the window */
  duplicateThreshold: number;
  duplicateWindowSeconds: number;
  /** Deny when this much cost accumulates within the cost spiral window */
  costSpiralAmount: number;
  costSpiralWindowSeconds: number;
  /** Deny when this many requests arrive within the heartbeat window */
  heartbeatThreshold: number;
  heartbeatWindowSeconds: number;
}

export type LoopVerdict = "ALLOW" | "DENY";

export interface LoopCheckResult {
  verdict: LoopVerdict;
  trigger?: "duplicate" | "heartbeat" | "cost_spiral";
  reason?: string;
}

// ── In-memory ring buffers (per keyHash) ─────────────────────────────────────
// These are intentionally in-memory: they reset on restart, which is fine —
// loop detection cares about recent patterns, not historical data.

interface RecentEntry {
  hash: number;
  ts: number;  // unix ms
}

// Map<keyHash, circular buffer of recent request hashes+timestamps>
const recentRequests = new Map<string, RecentEntry[]>();

function getRecent(keyHash: string): RecentEntry[] {
  if (!recentRequests.has(keyHash)) {
    recentRequests.set(keyHash, []);
  }
  return recentRequests.get(keyHash)!;
}

function pruneOld(entries: RecentEntry[], windowMs: number, now: number): RecentEntry[] {
  const cutoff = now - windowMs;
  return entries.filter((e) => e.ts >= cutoff);
}

/**
 * Record a request and check for loop patterns.
 * Call this PRE-request (before forwarding to provider).
 *
 * @param content  The first 200 chars of the request body (prompt text), used for fingerprinting.
 */
export function checkLoop(
  db: Database,
  keyHash: string,
  content: string,
  config: LoopConfig,
  now: number,
): LoopCheckResult {
  if (!config.enabled) return { verdict: "ALLOW" };

  const hash = djb2(content);
  const dupWindowMs = config.duplicateWindowSeconds * 1000;
  const heartbeatWindowMs = config.heartbeatWindowSeconds * 1000;

  // Prune stale entries to the longest relevant window
  const maxWindowMs = Math.max(dupWindowMs, heartbeatWindowMs);
  let recent = pruneOld(getRecent(keyHash), maxWindowMs, now);

  // ── 1. Heartbeat storm: too many requests in window ─────────────────────
  const inHeartbeatWindow = recent.filter((e) => e.ts >= now - heartbeatWindowMs);
  if (inHeartbeatWindow.length >= config.heartbeatThreshold) {
    return {
      verdict: "DENY",
      trigger: "heartbeat",
      reason: `Heartbeat storm: ${inHeartbeatWindow.length} requests in ${config.heartbeatWindowSeconds}s (threshold: ${config.heartbeatThreshold})`,
    };
  }

  // ── 2. Duplicate content: same hash too many times in window ────────────
  const inDupWindow = recent.filter((e) => e.ts >= now - dupWindowMs && e.hash === hash);
  if (inDupWindow.length >= config.duplicateThreshold) {
    return {
      verdict: "DENY",
      trigger: "duplicate",
      reason: `Duplicate request: same content hash seen ${inDupWindow.length + 1} times in ${config.duplicateWindowSeconds}s (threshold: ${config.duplicateThreshold})`,
    };
  }

  // ── 3. Cost spiral: too much spend in a short window ────────────────────
  const costSpiralWindowMs = config.costSpiralWindowSeconds * 1000;
  const costSpiralStart = now - costSpiralWindowMs;

  // Use SQLite hourly counter as the best available spend proxy.
  // This isn't perfect (hourly window != spiral window) but avoids extra tables.
  const windows = getCurrentWindows(now);
  const hourlyWindow = windows.find((w) => w.type === "hourly")!;
  // Only apply cost spiral if the hourly window started within the spiral window
  if (hourlyWindow.start >= costSpiralStart) {
    const counter = getSpend(db, keyHash, "hourly", hourlyWindow.start);
    const hourlySpend = counter?.totalCost ?? 0;
    if (hourlySpend >= config.costSpiralAmount) {
      return {
        verdict: "DENY",
        trigger: "cost_spiral",
        reason: `Cost spiral: $${hourlySpend.toFixed(4)} in current hour >= $${config.costSpiralAmount} threshold`,
      };
    }
  }

  // Record this request
  recent.push({ hash, ts: now });
  recentRequests.set(keyHash, recent);

  return { verdict: "ALLOW" };
}

/** Reset in-memory state for a key (e.g. after unfreeze). Exported for tests. */
export function resetLoopState(keyHash: string): void {
  recentRequests.delete(keyHash);
}
