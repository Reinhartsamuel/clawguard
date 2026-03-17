/**
 * WebSocket event bus for real-time dashboard updates.
 * Pure in-process pub/sub — no external broker needed.
 */

export type WsEventType =
  | "request_completed"
  | "budget_exceeded"
  | "budget_warning"
  | "anomaly_spike"
  | "loop_detected"
  | "key_frozen"
  | "key_unfrozen"
  | "status_snapshot"
  | "pause_gate_opened"
  | "pause_gate_resolved";

export interface WsEvent {
  type: WsEventType;
  ts: number;
  payload: Record<string, unknown>;
}

type Subscriber = (event: WsEvent) => void;

const subscribers = new Set<Subscriber>();

export function subscribe(fn: Subscriber): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

export function publish(type: WsEventType, payload: Record<string, unknown>): void {
  if (subscribers.size === 0) return;
  const event: WsEvent = { type, ts: Date.now(), payload };
  for (const fn of subscribers) {
    try { fn(event); } catch { /* never let one bad subscriber crash the proxy */ }
  }
}
