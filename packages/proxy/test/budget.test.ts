import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { openDb } from "../src/store/db.js";
import { incrementSpend } from "../src/store/counters.js";
import { checkBudget } from "../src/policy/budget.js";
import type { Database } from "bun:sqlite";

let db: Database;

beforeEach(() => {
  db = openDb(":memory:");
});

afterEach(() => {
  db.close();
});

describe("checkBudget", () => {
  it("allows when no caps configured", () => {
    const result = checkBudget(db, "key1", {
      hourly: null,
      daily: null,
      monthly: null,
    });
    expect(result.allowed).toBe(true);
  });

  it("allows when under daily cap", () => {
    incrementSpend(db, "key1", 0.005, Date.now());

    const result = checkBudget(db, "key1", {
      hourly: null,
      daily: 0.01,
      monthly: null,
    });
    expect(result.allowed).toBe(true);
  });

  it("denies when daily cap exceeded", () => {
    incrementSpend(db, "key1", 0.01, Date.now());

    const result = checkBudget(db, "key1", {
      hourly: null,
      daily: 0.01,
      monthly: null,
    });
    expect(result.allowed).toBe(false);
    expect(result.windowType).toBe("daily");
    expect(result.reason).toContain("daily budget cap exceeded");
  });

  it("denies when hourly cap exceeded", () => {
    incrementSpend(db, "key1", 0.50, Date.now());

    const result = checkBudget(db, "key1", {
      hourly: 0.25,
      daily: 10,
      monthly: null,
    });
    expect(result.allowed).toBe(false);
    expect(result.windowType).toBe("hourly");
  });

  it("denies when monthly cap exceeded", () => {
    incrementSpend(db, "key1", 100, Date.now());

    const result = checkBudget(db, "key1", {
      hourly: null,
      daily: null,
      monthly: 50,
    });
    expect(result.allowed).toBe(false);
    expect(result.windowType).toBe("monthly");
  });

  it("allows different key even when another is over cap", () => {
    incrementSpend(db, "key1", 1.00, Date.now());

    const result1 = checkBudget(db, "key1", {
      hourly: null,
      daily: 0.50,
      monthly: null,
    });
    expect(result1.allowed).toBe(false);

    const result2 = checkBudget(db, "key2", {
      hourly: null,
      daily: 0.50,
      monthly: null,
    });
    expect(result2.allowed).toBe(true);
  });

  it("reports current spend and cap in result", () => {
    incrementSpend(db, "key1", 5.50, Date.now());

    const result = checkBudget(db, "key1", {
      hourly: null,
      daily: 5.00,
      monthly: null,
    });
    expect(result.allowed).toBe(false);
    expect(result.currentSpend).toBeCloseTo(5.50);
    expect(result.cap).toBe(5.00);
  });
});
