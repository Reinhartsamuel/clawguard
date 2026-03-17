import type { Database } from "bun:sqlite";
import type { BudgetConfig } from "../config/schema.js";
import type { AnomalyConfig } from "../policy/anomaly.js";

export interface KeyPolicy {
  keyHash: string;
  label?: string;
  budget?: Partial<BudgetConfig>;
  anomaly?: Partial<Pick<AnomalyConfig, "warnMultiplier" | "pauseMultiplier" | "killMultiplier">>;
  loopEnabled?: boolean;
  updatedAt: number;
}

type KeyPolicyRow = {
  key_hash: string;
  label: string | null;
  budget_hourly: number | null;
  budget_daily: number | null;
  budget_monthly: number | null;
  anomaly_warn_mult: number | null;
  anomaly_pause_mult: number | null;
  anomaly_kill_mult: number | null;
  loop_enabled: number | null;
  updated_at: number;
};

function rowToPolicy(r: KeyPolicyRow): KeyPolicy {
  const policy: KeyPolicy = { keyHash: r.key_hash, updatedAt: r.updated_at };
  if (r.label) policy.label = r.label;

  if (r.budget_hourly != null || r.budget_daily != null || r.budget_monthly != null) {
    policy.budget = {};
    if (r.budget_hourly != null) policy.budget.hourly = r.budget_hourly;
    if (r.budget_daily != null) policy.budget.daily = r.budget_daily;
    if (r.budget_monthly != null) policy.budget.monthly = r.budget_monthly;
  }

  if (r.anomaly_warn_mult != null || r.anomaly_pause_mult != null || r.anomaly_kill_mult != null) {
    policy.anomaly = {};
    if (r.anomaly_warn_mult != null) policy.anomaly.warnMultiplier = r.anomaly_warn_mult;
    if (r.anomaly_pause_mult != null) policy.anomaly.pauseMultiplier = r.anomaly_pause_mult;
    if (r.anomaly_kill_mult != null) policy.anomaly.killMultiplier = r.anomaly_kill_mult;
  }

  if (r.loop_enabled != null) policy.loopEnabled = r.loop_enabled === 1;

  return policy;
}

export function getKeyPolicy(db: Database, keyHash: string): KeyPolicy | null {
  const row = db.prepare(
    `SELECT * FROM key_policies WHERE key_hash = ?`,
  ).get(keyHash) as KeyPolicyRow | undefined;

  return row ? rowToPolicy(row) : null;
}

export function setKeyPolicy(db: Database, policy: KeyPolicy): void {
  db.prepare(`
    INSERT INTO key_policies (key_hash, label, budget_hourly, budget_daily, budget_monthly,
      anomaly_warn_mult, anomaly_pause_mult, anomaly_kill_mult, loop_enabled, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (key_hash) DO UPDATE SET
      label = excluded.label,
      budget_hourly = excluded.budget_hourly,
      budget_daily = excluded.budget_daily,
      budget_monthly = excluded.budget_monthly,
      anomaly_warn_mult = excluded.anomaly_warn_mult,
      anomaly_pause_mult = excluded.anomaly_pause_mult,
      anomaly_kill_mult = excluded.anomaly_kill_mult,
      loop_enabled = excluded.loop_enabled,
      updated_at = excluded.updated_at
  `).run(
    policy.keyHash,
    policy.label ?? null,
    policy.budget?.hourly ?? null,
    policy.budget?.daily ?? null,
    policy.budget?.monthly ?? null,
    policy.anomaly?.warnMultiplier ?? null,
    policy.anomaly?.pauseMultiplier ?? null,
    policy.anomaly?.killMultiplier ?? null,
    policy.loopEnabled != null ? (policy.loopEnabled ? 1 : 0) : null,
    policy.updatedAt,
  );
}

export function deleteKeyPolicy(db: Database, keyHash: string): void {
  db.prepare(`DELETE FROM key_policies WHERE key_hash = ?`).run(keyHash);
}

export function listKeyPolicies(db: Database): KeyPolicy[] {
  const rows = db.prepare(`SELECT * FROM key_policies ORDER BY updated_at DESC`).all() as KeyPolicyRow[];
  return rows.map(rowToPolicy);
}

/**
 * Merge a per-key policy on top of the global budget config.
 * Per-key values override globals where set.
 */
export function mergeKeyBudget(
  globalBudget: BudgetConfig,
  keyPolicy: KeyPolicy | null,
): BudgetConfig {
  if (!keyPolicy?.budget) return globalBudget;
  return {
    hourly: keyPolicy.budget.hourly !== undefined ? keyPolicy.budget.hourly : globalBudget.hourly,
    daily: keyPolicy.budget.daily !== undefined ? keyPolicy.budget.daily : globalBudget.daily,
    monthly: keyPolicy.budget.monthly !== undefined ? keyPolicy.budget.monthly : globalBudget.monthly,
  };
}

/**
 * Merge a per-key anomaly config on top of the global anomaly config.
 */
export function mergeKeyAnomaly(
  globalAnomaly: AnomalyConfig,
  keyPolicy: KeyPolicy | null,
): AnomalyConfig {
  if (!keyPolicy?.anomaly) return globalAnomaly;
  return {
    ...globalAnomaly,
    warnMultiplier: keyPolicy.anomaly.warnMultiplier ?? globalAnomaly.warnMultiplier,
    pauseMultiplier: keyPolicy.anomaly.pauseMultiplier ?? globalAnomaly.pauseMultiplier,
    killMultiplier: keyPolicy.anomaly.killMultiplier ?? globalAnomaly.killMultiplier,
  };
}
