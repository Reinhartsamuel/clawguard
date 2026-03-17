import type { Database } from "bun:sqlite";
import { getBaseline, updateBaseline, type BaselineMetric } from "../store/baselines.js";
import { getSpend, getCurrentWindows } from "../store/counters.js";

export interface AnomalyConfig {
  /** Minimum number of baseline samples before anomaly detection activates */
  minSamples: number;
  /** Alert at this many std-deviations above baseline */
  warnMultiplier: number;
  /** Pause/queue at this many std-deviations above baseline */
  pauseMultiplier: number;
  /** Deny at this many std-deviations above baseline */
  killMultiplier: number;
  /** EMA decay window in days — longer = slower to adapt */
  baselineWindowDays: number;
}

export type AnomalyVerdict = "ALLOW" | "WARN" | "PAUSE" | "DENY";

export interface AnomalyCheckResult {
  verdict: AnomalyVerdict;
  metric?: BaselineMetric;
  currentValue?: number;
  emaValue?: number;
  stdDev?: number;
  zScore?: number;
  reason?: string;
}

/**
 * Check the current spend rate against the EMA baseline and return a verdict.
 * Call this PRE-request (before forwarding to provider).
 */
export function checkAnomaly(
  db: Database,
  keyHash: string,
  config: AnomalyConfig,
): AnomalyCheckResult {
  const now = Date.now();
  const windows = getCurrentWindows(now);

  // Use hourly spend as the primary signal — most sensitive to spikes
  const hourlyWindow = windows.find((w) => w.type === "hourly")!;
  const counter = getSpend(db, keyHash, "hourly", hourlyWindow.start);
  const currentValue = counter?.totalCost ?? 0;

  const metric: BaselineMetric = "hourly_cost";
  const baseline = getBaseline(db, keyHash, metric);

  // Not enough samples yet — allow but don't penalise
  if (!baseline || baseline.sampleCount < config.minSamples) {
    return { verdict: "ALLOW" };
  }

  const stdDev = Math.sqrt(baseline.emaVariance);

  // If std-dev is ~0 (perfectly steady spend), use 10% of EMA as floor
  const effectiveStdDev = stdDev < baseline.emaValue * 0.1
    ? baseline.emaValue * 0.1
    : stdDev;

  // Avoid division by zero on a totally cold baseline
  if (effectiveStdDev === 0) return { verdict: "ALLOW" };

  const zScore = (currentValue - baseline.emaValue) / effectiveStdDev;

  const base: Omit<AnomalyCheckResult, "verdict"> = {
    metric,
    currentValue,
    emaValue: baseline.emaValue,
    stdDev: effectiveStdDev,
    zScore,
  };

  if (zScore >= config.killMultiplier) {
    return {
      ...base,
      verdict: "DENY",
      reason: `Spend spike ${zScore.toFixed(1)}σ above baseline (kill threshold: ${config.killMultiplier}σ)`,
    };
  }

  if (zScore >= config.pauseMultiplier) {
    return {
      ...base,
      verdict: "PAUSE",
      reason: `Spend spike ${zScore.toFixed(1)}σ above baseline (pause threshold: ${config.pauseMultiplier}σ)`,
    };
  }

  if (zScore >= config.warnMultiplier) {
    return {
      ...base,
      verdict: "WARN",
      reason: `Spend spike ${zScore.toFixed(1)}σ above baseline (warn threshold: ${config.warnMultiplier}σ)`,
    };
  }

  return { ...base, verdict: "ALLOW" };
}

/**
 * Update the EMA baseline after a completed request.
 * Call this POST-request (after usage is known).
 */
export function recordAnomalyBaseline(
  db: Database,
  keyHash: string,
  config: AnomalyConfig,
  now: number,
): void {
  const windows = getCurrentWindows(now);
  const hourlyWindow = windows.find((w) => w.type === "hourly")!;
  const counter = getSpend(db, keyHash, "hourly", hourlyWindow.start);
  const currentValue = counter?.totalCost ?? 0;

  // alpha derived from window in days: shorter window = faster adaptation
  const alpha = 2 / (config.baselineWindowDays * 24 + 1);

  updateBaseline(db, keyHash, "hourly_cost", currentValue, alpha, now);
}
