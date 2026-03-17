import type { Database } from "bun:sqlite";

export interface FrozenKey {
  keyHash: string;
  frozenAt: number;
  reason: string;
}

export function freezeKey(db: Database, keyHash: string, reason = "manual"): void {
  db.prepare(`
    INSERT INTO frozen_keys (key_hash, frozen_at, reason)
    VALUES (?, ?, ?)
    ON CONFLICT (key_hash) DO UPDATE SET frozen_at = excluded.frozen_at, reason = excluded.reason
  `).run(keyHash, Date.now(), reason);
}

export function unfreezeKey(db: Database, keyHash: string): void {
  db.prepare(`DELETE FROM frozen_keys WHERE key_hash = ?`).run(keyHash);
}

export function isKeyFrozen(db: Database, keyHash: string): boolean {
  const row = db.prepare(`SELECT 1 FROM frozen_keys WHERE key_hash = ?`).get(keyHash);
  return row != null;
}

export function listFrozenKeys(db: Database): FrozenKey[] {
  const rows = db.prepare(`SELECT key_hash, frozen_at, reason FROM frozen_keys`).all() as {
    key_hash: string;
    frozen_at: number;
    reason: string;
  }[];
  return rows.map((r) => ({ keyHash: r.key_hash, frozenAt: r.frozen_at, reason: r.reason }));
}
