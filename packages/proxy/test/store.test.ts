import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { openDb } from "../src/store/db.js";
import { logRequest, pruneRequests, getRecentRequests } from "../src/store/requests.js";
import { incrementSpend, getSpend, getCurrentWindows } from "../src/store/counters.js";
import { hashKey } from "../src/router/ingress.js";
import type { Database } from "bun:sqlite";

let db: Database;

beforeEach(() => {
  db = openDb(":memory:");
});

afterEach(() => {
  db.close();
});

describe("hashKey", () => {
  it("returns a 16-char hex string", () => {
    const hash = hashKey("sk-test-key-123");
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("returns same hash for same key", () => {
    expect(hashKey("sk-test")).toBe(hashKey("sk-test"));
  });

  it("returns different hash for different keys", () => {
    expect(hashKey("sk-test-1")).not.toBe(hashKey("sk-test-2"));
  });
});

describe("getCurrentWindows", () => {
  it("computes correct UTC window starts", () => {
    const ts = Date.UTC(2025, 2, 15, 14, 30, 0);
    const windows = getCurrentWindows(ts);

    expect(windows).toHaveLength(3);

    const hourly = windows.find((w) => w.type === "hourly")!;
    expect(hourly.start).toBe(Date.UTC(2025, 2, 15, 14, 0, 0));

    const daily = windows.find((w) => w.type === "daily")!;
    expect(daily.start).toBe(Date.UTC(2025, 2, 15, 0, 0, 0));

    const monthly = windows.find((w) => w.type === "monthly")!;
    expect(monthly.start).toBe(Date.UTC(2025, 2, 1, 0, 0, 0));
  });
});

describe("logRequest", () => {
  it("inserts a request record", () => {
    logRequest(db, {
      requestId: "req-1",
      keyHash: "abc123",
      model: "gpt-4o-mini",
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalTokens: 30,
      estimatedCost: 0.001,
      isEstimated: false,
      createdAt: Date.now(),
    });

    const rows = getRecentRequests(db, "abc123");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.requestId).toBe("req-1");
    expect(rows[0]!.model).toBe("gpt-4o-mini");
    expect(rows[0]!.isEstimated).toBe(false);
  });
});

describe("pruneRequests", () => {
  it("prunes oldest requests beyond max", () => {
    for (let i = 0; i < 15; i++) {
      logRequest(db, {
        requestId: `req-${i}`,
        keyHash: "prune-test",
        model: "gpt-4o",
        inputTokens: 10,
        outputTokens: 10,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalTokens: 20,
        estimatedCost: 0.001,
        isEstimated: false,
        createdAt: Date.now() + i,
      });
    }

    const deleted = pruneRequests(db, "prune-test", 10);
    expect(deleted).toBe(5);

    const remaining = getRecentRequests(db, "prune-test", 100);
    expect(remaining).toHaveLength(10);
  });

  it("does nothing when under max", () => {
    logRequest(db, {
      requestId: "req-1",
      keyHash: "small-test",
      model: "gpt-4o",
      inputTokens: 10,
      outputTokens: 10,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalTokens: 20,
      estimatedCost: 0.001,
      isEstimated: false,
      createdAt: Date.now(),
    });

    const deleted = pruneRequests(db, "small-test", 10);
    expect(deleted).toBe(0);
  });
});

describe("incrementSpend", () => {
  it("creates counters for all windows", () => {
    const ts = Date.UTC(2025, 2, 15, 14, 30, 0);
    incrementSpend(db, "key1", 0.05, ts);

    const hourly = getSpend(db, "key1", "hourly", Date.UTC(2025, 2, 15, 14, 0, 0));
    expect(hourly).not.toBeNull();
    expect(hourly!.totalCost).toBeCloseTo(0.05);
    expect(hourly!.requestCount).toBe(1);

    const daily = getSpend(db, "key1", "daily", Date.UTC(2025, 2, 15, 0, 0, 0));
    expect(daily).not.toBeNull();
    expect(daily!.totalCost).toBeCloseTo(0.05);
  });

  it("accumulates spend across multiple requests", () => {
    const ts = Date.UTC(2025, 2, 15, 14, 30, 0);
    incrementSpend(db, "key2", 0.03, ts);
    incrementSpend(db, "key2", 0.07, ts);

    const hourly = getSpend(db, "key2", "hourly", Date.UTC(2025, 2, 15, 14, 0, 0));
    expect(hourly!.totalCost).toBeCloseTo(0.10);
    expect(hourly!.requestCount).toBe(2);
  });

  it("keeps separate counters for different keys", () => {
    const ts = Date.UTC(2025, 2, 15, 14, 30, 0);
    incrementSpend(db, "keyA", 0.10, ts);
    incrementSpend(db, "keyB", 0.20, ts);

    const hourlyA = getSpend(db, "keyA", "hourly", Date.UTC(2025, 2, 15, 14, 0, 0));
    const hourlyB = getSpend(db, "keyB", "hourly", Date.UTC(2025, 2, 15, 14, 0, 0));
    expect(hourlyA!.totalCost).toBeCloseTo(0.10);
    expect(hourlyB!.totalCost).toBeCloseTo(0.20);
  });

  it("returns null for non-existent spend", () => {
    const result = getSpend(db, "nonexistent", "hourly", Date.now());
    expect(result).toBeNull();
  });
});
