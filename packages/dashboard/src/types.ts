export interface SpendWindow {
  cost: number;
  requests: number;
}

export interface KeyPolicy {
  keyHash: string;
  label?: string;
  budget?: { hourly?: number; daily?: number; monthly?: number };
  anomaly?: { warnMultiplier?: number; pauseMultiplier?: number; killMultiplier?: number };
  loopEnabled?: boolean;
  updatedAt: number;
}

export interface ApiKey {
  keyHash: string;
  frozen: boolean;
  policy: KeyPolicy | null;
  spend: {
    hourly?: SpendWindow;
    daily?: SpendWindow;
    monthly?: SpendWindow;
  };
}

export interface StatusResponse {
  timestamp: string;
  budget: { hourly: number | null; daily: number | null; monthly: number | null };
  keys: ApiKey[];
  frozen: Array<{ keyHash: string; frozenAt: number; reason: string }>;
}

export interface KeysResponse {
  keys: ApiKey[];
  timestamp: string;
}

export type AlertSeverity = "warn" | "critical";

export interface Alert {
  id: string;
  type: "budget_exceeded" | "budget_warning" | "anomaly_spike" | "loop_detected" | "key_frozen";
  severity: AlertSeverity;
  keyHash: string;
  message: string;
  ts: number;
  payload: Record<string, unknown>;
}

export interface WsEvent {
  type: string;
  ts: number;
  payload: Record<string, unknown>;
}

export interface SpendPoint {
  time: string;
  cost: number;
  requests: number;
}
