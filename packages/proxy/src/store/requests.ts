import type { Database } from "bun:sqlite";

export interface RequestRecord {
  requestId: string;
  keyHash: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  estimatedCost: number;
  isEstimated: boolean;
  createdAt: number; // unix ms
}

export function logRequest(db: Database, record: RequestRecord): void {
  const stmt = db.prepare(`
    INSERT INTO requests (request_id, key_hash, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, total_tokens, estimated_cost, is_estimated, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    record.requestId,
    record.keyHash,
    record.model,
    record.inputTokens,
    record.outputTokens,
    record.cacheReadTokens,
    record.cacheCreationTokens,
    record.totalTokens,
    record.estimatedCost,
    record.isEstimated ? 1 : 0,
    record.createdAt,
  );
}

export function pruneRequests(
  db: Database,
  keyHash: string,
  maxPerKey = 10_000,
): number {
  const countStmt = db.prepare(
    "SELECT COUNT(*) as cnt FROM requests WHERE key_hash = ?",
  );
  const row = countStmt.get(keyHash) as { cnt: number };

  if (row.cnt <= maxPerKey) return 0;

  const deleteCount = row.cnt - maxPerKey;
  const deleteStmt = db.prepare(`
    DELETE FROM requests WHERE id IN (
      SELECT id FROM requests WHERE key_hash = ? ORDER BY created_at ASC LIMIT ?
    )
  `);
  deleteStmt.run(keyHash, deleteCount);

  // bun:sqlite .run() doesn't return changes, so compute it
  const newRow = countStmt.get(keyHash) as { cnt: number };
  return row.cnt - newRow.cnt;
}

export function getRecentRequests(
  db: Database,
  keyHash: string,
  limit = 100,
): RequestRecord[] {
  const stmt = db.prepare(`
    SELECT request_id, key_hash, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, total_tokens, estimated_cost, is_estimated, created_at
    FROM requests WHERE key_hash = ? ORDER BY created_at DESC LIMIT ?
  `);

  const rows = stmt.all(keyHash, limit) as Array<{
    request_id: string;
    key_hash: string;
    model: string;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
    total_tokens: number;
    estimated_cost: number;
    is_estimated: number;
    created_at: number;
  }>;

  return rows.map((r) => ({
    requestId: r.request_id,
    keyHash: r.key_hash,
    model: r.model,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    cacheReadTokens: r.cache_read_tokens ?? 0,
    cacheCreationTokens: r.cache_creation_tokens ?? 0,
    totalTokens: r.total_tokens,
    estimatedCost: r.estimated_cost,
    isEstimated: r.is_estimated === 1,
    createdAt: r.created_at,
  }));
}
