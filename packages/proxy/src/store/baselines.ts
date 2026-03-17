import type { Database } from "bun:sqlite";

export type BaselineMetric = "hourly_cost" | "daily_cost";

export interface Baseline {
  keyHash: string;
  metric: BaselineMetric;
  emaValue: number;
  emaVariance: number;
  sampleCount: number;
  updatedAt: number;
}

type BaselineRow = {
  key_hash: string;
  metric: string;
  ema_value: number;
  ema_variance: number;
  sample_count: number;
  updated_at: number;
};

export function getBaseline(
  db: Database,
  keyHash: string,
  metric: BaselineMetric,
): Baseline | null {
  const row = db
    .prepare(
      `SELECT key_hash, metric, ema_value, ema_variance, sample_count, updated_at
       FROM baselines WHERE key_hash = ? AND metric = ?`,
    )
    .get(keyHash, metric) as BaselineRow | undefined;

  if (!row) return null;

  return {
    keyHash: row.key_hash,
    metric: row.metric as BaselineMetric,
    emaValue: row.ema_value,
    emaVariance: row.ema_variance,
    sampleCount: row.sample_count,
    updatedAt: row.updated_at,
  };
}

/**
 * Update EMA and EMA-variance (Welford-style) for the given metric.
 * alpha controls how fast the EMA adapts (higher = more reactive).
 */
export function updateBaseline(
  db: Database,
  keyHash: string,
  metric: BaselineMetric,
  newValue: number,
  alpha: number,
  now: number,
): Baseline {
  const existing = getBaseline(db, keyHash, metric);

  let emaValue: number;
  let emaVariance: number;
  let sampleCount: number;

  if (!existing || existing.sampleCount === 0) {
    // First sample — seed the baseline
    emaValue = newValue;
    emaVariance = 0;
    sampleCount = 1;
  } else {
    const diff = newValue - existing.emaValue;
    emaValue = alpha * newValue + (1 - alpha) * existing.emaValue;
    // Exponentially weighted variance
    emaVariance = (1 - alpha) * (existing.emaVariance + alpha * diff * diff);
    sampleCount = existing.sampleCount + 1;
  }

  db.prepare(
    `INSERT INTO baselines (key_hash, metric, ema_value, ema_variance, sample_count, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (key_hash, metric)
     DO UPDATE SET ema_value = excluded.ema_value,
                   ema_variance = excluded.ema_variance,
                   sample_count = excluded.sample_count,
                   updated_at = excluded.updated_at`,
  ).run(keyHash, metric, emaValue, emaVariance, sampleCount, now);

  return { keyHash, metric, emaValue, emaVariance, sampleCount, updatedAt: now };
}
