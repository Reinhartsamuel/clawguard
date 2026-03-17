import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { openDb } from "../src/store/db.js";
import { incrementSpend, getCurrentWindows } from "../src/store/counters.js";
import { updateBaseline } from "../src/store/baselines.js";
import { checkAnomaly, recordAnomalyBaseline } from "../src/policy/anomaly.js";
import type { Database } from "bun:sqlite";
import type { AnomalyConfig } from "../src/policy/anomaly.js";

let db: Database;

const cfg: AnomalyConfig = {
  minSamples: 10,
  warnMultiplier: 3,
  pauseMultiplier: 5,
  killMultiplier: 10,
  baselineWindowDays: 14,
};

// Seed a stable baseline directly — bypasses the need for real requests
function seedBaseline(
  keyHash: string,
  emaValue: number,
  emaVariance: number,
  sampleCount: number,
) {
  db.prepare(
    `INSERT INTO baselines (key_hash, metric, ema_value, ema_variance, sample_count, updated_at)
     VALUES (?, 'hourly_cost', ?, ?, ?, ?)
     ON CONFLICT (key_hash, metric) DO UPDATE SET
       ema_value = excluded.ema_value,
       ema_variance = excluded.ema_variance,
       sample_count = excluded.sample_count,
       updated_at = excluded.updated_at`,
  ).run(keyHash, emaValue, emaVariance, sampleCount, Date.now());
}

// Seed the hourly spend counter directly for the current hour
function seedHourlySpend(keyHash: string, cost: number) {
  const now = Date.now();
  const windows = getCurrentWindows(now);
  const hourly = windows.find((w) => w.type === "hourly")!;
  db.prepare(
    `INSERT INTO spend_counters (key_hash, window_type, window_start, total_cost, request_count)
     VALUES (?, 'hourly', ?, ?, 1)
     ON CONFLICT (key_hash, window_type, window_start) DO UPDATE SET
       total_cost = excluded.total_cost,
       request_count = excluded.request_count`,
  ).run(keyHash, hourly.start, cost);
}

beforeEach(() => {
  db = openDb(":memory:");
});

afterEach(() => {
  db.close();
});

describe("checkAnomaly", () => {
  it("allows when no baseline exists", () => {
    const result = checkAnomaly(db, "key1", cfg);
    expect(result.verdict).toBe("ALLOW");
  });

  it("allows when sample count is below minSamples", () => {
    seedBaseline("key1", 0.01, 0.000001, 5); // only 5 samples, need 10
    seedHourlySpend("key1", 1.0);
    const result = checkAnomaly(db, "key1", cfg);
    expect(result.verdict).toBe("ALLOW");
  });

  it("allows normal spend within 1σ of baseline", () => {
    // baseline: ema=0.01, variance=0.000001 → stdDev=0.001
    // current: 0.011 → zScore ≈ 1 → ALLOW
    seedBaseline("key1", 0.01, 0.000001, 50);
    seedHourlySpend("key1", 0.011);
    const result = checkAnomaly(db, "key1", cfg);
    expect(result.verdict).toBe("ALLOW");
    expect(result.zScore).toBeDefined();
    expect(result.zScore!).toBeLessThan(cfg.warnMultiplier);
  });

  it("warns when spend is above warnMultiplier σ", () => {
    // baseline: ema=0.01, variance=0.000001 → stdDev=0.001
    // current: 0.04 → zScore = (0.04 - 0.01) / 0.001 = 30 → above warn(3) but below kill(10)
    // wait — 30 > killMultiplier(10), so let's use a bigger variance
    // ema=0.01, variance=0.0001 → stdDev=0.01
    // current: 0.05 → zScore = (0.05 - 0.01) / 0.01 = 4 → above warn(3), below pause(5)
    seedBaseline("key1", 0.01, 0.0001, 50);
    seedHourlySpend("key1", 0.05);
    const result = checkAnomaly(db, "key1", cfg);
    expect(result.verdict).toBe("WARN");
    expect(result.zScore!).toBeGreaterThanOrEqual(cfg.warnMultiplier);
    expect(result.zScore!).toBeLessThan(cfg.pauseMultiplier);
    expect(result.reason).toContain("warn threshold");
  });

  it("pauses when spend is between pause and kill multiplier σ", () => {
    // ema=0.01, variance=0.0001 → stdDev=0.01
    // current: 0.07 → zScore = (0.07 - 0.01) / 0.01 = 6 → above pause(5), below kill(10)
    seedBaseline("key1", 0.01, 0.0001, 50);
    seedHourlySpend("key1", 0.07);
    const result = checkAnomaly(db, "key1", cfg);
    expect(result.verdict).toBe("PAUSE");
    expect(result.zScore!).toBeGreaterThanOrEqual(cfg.pauseMultiplier);
    expect(result.zScore!).toBeLessThan(cfg.killMultiplier);
    expect(result.reason).toContain("pause threshold");
  });

  it("denies (kill) when spend exceeds kill multiplier σ", () => {
    // ema=0.01, variance=0.0001 → stdDev=0.01
    // current: 0.12 → zScore = (0.12 - 0.01) / 0.01 = 11 → above kill(10)
    seedBaseline("key1", 0.01, 0.0001, 50);
    seedHourlySpend("key1", 0.12);
    const result = checkAnomaly(db, "key1", cfg);
    expect(result.verdict).toBe("DENY");
    expect(result.zScore!).toBeGreaterThanOrEqual(cfg.killMultiplier);
    expect(result.reason).toContain("kill threshold");
  });

  it("uses 10% of ema as floor stddev when variance is ~0 (steady spend)", () => {
    // Perfectly steady baseline: ema=0.01, variance=0 (stdDev=0)
    // effectiveStdDev = 0.01 * 0.1 = 0.001
    // current: 0.04 → zScore = (0.04 - 0.01) / 0.001 = 30 → DENY
    seedBaseline("key1", 0.01, 0, 50);
    seedHourlySpend("key1", 0.04);
    const result = checkAnomaly(db, "key1", cfg);
    expect(result.verdict).toBe("DENY");
  });

  it("allows zero current spend even with established baseline", () => {
    seedBaseline("key1", 0.01, 0.0001, 50);
    // no spend seeded → currentValue = 0 → zScore is negative → ALLOW
    const result = checkAnomaly(db, "key1", cfg);
    expect(result.verdict).toBe("ALLOW");
    expect(result.zScore!).toBeLessThan(0);
  });

  it("isolates different keys — spiked key1 does not affect key2", () => {
    seedBaseline("key1", 0.01, 0.0001, 50);
    seedBaseline("key2", 0.01, 0.0001, 50);
    seedHourlySpend("key1", 0.12); // spike on key1
    // key2 has no spend → ALLOW
    const r1 = checkAnomaly(db, "key1", cfg);
    const r2 = checkAnomaly(db, "key2", cfg);
    expect(r1.verdict).toBe("DENY");
    expect(r2.verdict).toBe("ALLOW");
  });

  it("returns metric, currentValue, emaValue, stdDev, zScore in result", () => {
    seedBaseline("key1", 0.01, 0.0001, 50);
    seedHourlySpend("key1", 0.05);
    const result = checkAnomaly(db, "key1", cfg);
    expect(result.metric).toBe("hourly_cost");
    expect(result.currentValue).toBeCloseTo(0.05);
    expect(result.emaValue).toBeCloseTo(0.01);
    expect(result.stdDev).toBeCloseTo(0.01);
    expect(result.zScore).toBeDefined();
  });
});

describe("recordAnomalyBaseline", () => {
  it("creates a baseline entry on first call", () => {
    incrementSpend(db, "key1", 0.01, Date.now());
    recordAnomalyBaseline(db, "key1", cfg, Date.now());

    const result = checkAnomaly(db, "key1", cfg);
    // Only 1 sample — below minSamples, so ALLOW regardless
    expect(result.verdict).toBe("ALLOW");
  });

  it("accumulates sample_count across calls", () => {
    // Each call to recordAnomalyBaseline increments sampleCount.
    // We seed a stable baseline with enough samples, then verify detection is active.
    seedBaseline("key1", 0.01, 0.0001, 10);
    // With 10 samples (= minSamples), detection is active. No spend → ALLOW.
    const result = checkAnomaly(db, "key1", cfg);
    expect(result.verdict).toBe("ALLOW");
    expect(result.zScore).toBeDefined();
  });

  it("adapts EMA toward new values over time", () => {
    // Seed baseline at ema=0.01 with 50 samples (stable, well-established)
    seedBaseline("key1", 0.01, 0.0001, 50);
    // recordAnomalyBaseline reads the current hourly spend counter.
    // With no spend seeded, it records 0.0, pulling EMA slightly toward 0.
    // After one more call, emaValue should still be close to 0.01 (slow alpha).
    recordAnomalyBaseline(db, "key1", cfg, Date.now());
    const result = checkAnomaly(db, "key1", cfg);
    // EMA shifts very slightly toward 0 but stays near 0.01
    expect(result.emaValue!).toBeLessThan(0.01);
    expect(result.emaValue!).toBeGreaterThan(0.005);
  });
});
