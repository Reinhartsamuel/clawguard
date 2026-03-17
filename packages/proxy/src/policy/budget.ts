import type { Database } from "bun:sqlite";
import type { BudgetConfig } from "../config/schema.js";
import { getSpend, getCurrentWindows, type WindowType } from "../store/counters.js";

export interface BudgetCheckResult {
  allowed: boolean;
  reason?: string;
  windowType?: WindowType;
  currentSpend?: number;
  cap?: number;
}

/**
 * Check if a request should be allowed based on budget caps.
 * Returns DENY if any active cap is exceeded.
 */
export function checkBudget(
  db: Database,
  keyHash: string,
  config: BudgetConfig,
): BudgetCheckResult {
  const now = Date.now();
  const windows = getCurrentWindows(now);

  const caps: Array<{ type: WindowType; cap: number }> = [];
  if (config.hourly != null) caps.push({ type: "hourly", cap: config.hourly });
  if (config.daily != null) caps.push({ type: "daily", cap: config.daily });
  if (config.monthly != null) caps.push({ type: "monthly", cap: config.monthly });

  // No caps configured — allow everything
  if (caps.length === 0) return { allowed: true };

  for (const { type, cap } of caps) {
    const window = windows.find((w) => w.type === type);
    if (!window) continue;

    const counter = getSpend(db, keyHash, type, window.start);
    const currentSpend = counter?.totalCost ?? 0;

    if (currentSpend >= cap) {
      return {
        allowed: false,
        reason: `${type} budget cap exceeded: $${currentSpend.toFixed(4)} >= $${cap.toFixed(2)} limit`,
        windowType: type,
        currentSpend,
        cap,
      };
    }
  }

  return { allowed: true };
}
