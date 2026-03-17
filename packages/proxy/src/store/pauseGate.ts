/**
 * In-memory HITL pause gate.
 *
 * When the anomaly detector returns PAUSE, the proxy calls waitForGate()
 * instead of immediately returning 429. The HTTP connection is held open
 * while we wait for the owner to tap Approve or Deny in Telegram.
 *
 * Multiple concurrent requests for the same keyHash coalesce onto the same
 * gate entry — one Approve releases all of them, one Deny blocks all.
 *
 * State resets on restart (acceptable — pause is a live human action).
 */

export type GateState = "pending" | "approved" | "denied";

interface PendingEntry {
  state: GateState;
  resolvers: Array<(state: GateState) => void>;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
}

const gates = new Map<string, PendingEntry>();

/**
 * Called when a PAUSE verdict fires.
 * Holds the HTTP connection open until the gate is resolved or times out.
 * Returns the final GateState ("approved" or "denied").
 */
export function waitForGate(keyHash: string, timeoutMs: number): Promise<GateState> {
  return new Promise<GateState>((resolve) => {
    const existing = gates.get(keyHash);

    if (existing && existing.state === "pending") {
      // Coalesce: join the existing gate
      existing.resolvers.push(resolve);
      return;
    }

    // Create a new gate entry
    const entry: PendingEntry = {
      state: "pending",
      resolvers: [resolve],
      expiresAt: Date.now() + timeoutMs,
      timer: setTimeout(() => {
        _settle(keyHash, "denied");
      }, timeoutMs),
    };

    gates.set(keyHash, entry);
  });
}

/**
 * Called by the Telegram webhook handler when the owner taps a button.
 */
export function resolveGate(keyHash: string, decision: "approved" | "denied"): void {
  _settle(keyHash, decision);
}

/**
 * Returns the current state of the gate for a given key, or null if no gate exists.
 */
export function getGateState(keyHash: string): GateState | null {
  return gates.get(keyHash)?.state ?? null;
}

/**
 * Returns the list of key hashes currently waiting for a decision.
 */
export function listPendingGates(): string[] {
  const pending: string[] = [];
  for (const [keyHash, entry] of gates) {
    if (entry.state === "pending") pending.push(keyHash);
  }
  return pending;
}

function _settle(keyHash: string, state: "approved" | "denied"): void {
  const entry = gates.get(keyHash);
  if (!entry || entry.state !== "pending") return;

  clearTimeout(entry.timer);
  entry.state = state;

  for (const resolve of entry.resolvers) {
    try { resolve(state); } catch { /* ignore */ }
  }
  entry.resolvers = [];

  // Clean up after a short delay so getGateState() can still be queried briefly after resolution
  setTimeout(() => gates.delete(keyHash), 5_000);
}
