import type { WindowType } from "../store/counters.js";

export type AlertSeverity = "warn" | "critical";
export type AlertReason =
  | "budget_exceeded"
  | "budget_warning"
  | "spend_update"
  | "anomaly_spike"
  | "loop_detected"
  | "pause_gate_opened"
  | "pause_gate_resolved";

export interface BudgetExceededEvent {
  reason: "budget_exceeded";
  severity: "critical";
  keyHash: string;
  windowType: WindowType;
  currentSpend: number;
  cap: number;
  requestId: string;
  timestamp: number;
}

export interface BudgetWarningEvent {
  reason: "budget_warning";
  severity: "warn";
  keyHash: string;
  windowType: WindowType;
  currentSpend: number;
  cap: number;
  percentUsed: number;
  timestamp: number;
}

export interface AnomalySpikeEvent {
  reason: "anomaly_spike";
  severity: AlertSeverity;
  keyHash: string;
  currentValue: number;
  emaValue: number;
  stdDev: number;
  zScore: number;
  verdict: "WARN" | "PAUSE" | "DENY";
  message: string;
  timestamp: number;
}

export interface PauseGateOpenedEvent {
  reason: "pause_gate_opened";
  severity: "critical";
  keyHash: string;
  zScore: number;
  timeoutSeconds: number;
  callbackData: string;
  timestamp: number;
}

export interface PauseGateResolvedEvent {
  reason: "pause_gate_resolved";
  severity: "warn";
  keyHash: string;
  decision: "approved" | "denied" | "timeout";
  timestamp: number;
}

export interface LoopDetectedEvent {
  reason: "loop_detected";
  severity: "critical";
  keyHash: string;
  trigger: "duplicate" | "heartbeat" | "cost_spiral";
  message: string;
  timestamp: number;
}

export type AlertEvent =
  | BudgetExceededEvent
  | BudgetWarningEvent
  | AnomalySpikeEvent
  | LoopDetectedEvent
  | PauseGateOpenedEvent
  | PauseGateResolvedEvent;
