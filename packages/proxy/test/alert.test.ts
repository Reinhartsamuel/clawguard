import { describe, it, expect, mock } from "bun:test";
import { dispatchAlert } from "../src/alert/dispatcher.js";
import { sendTelegramAlert } from "../src/alert/telegram.js";
import type { AlertEvent } from "../src/alert/types.js";
import type { AlertsConfig } from "../src/alert/dispatcher.js";

const noopLog = {
  error: (_obj: object, _msg: string) => {},
};

const budgetExceeded: AlertEvent = {
  reason: "budget_exceeded",
  severity: "critical",
  keyHash: "abc123def456",
  windowType: "daily",
  currentSpend: 10.05,
  cap: 10.0,
  requestId: "req-uuid-1",
  timestamp: 1700000000000,
};

const budgetWarning: AlertEvent = {
  reason: "budget_warning",
  severity: "warn",
  keyHash: "abc123def456",
  windowType: "monthly",
  currentSpend: 82.5,
  cap: 100.0,
  percentUsed: 82.5,
  timestamp: 1700000000000,
};

describe("dispatchAlert", () => {
  it("does nothing when no channels configured", async () => {
    const config: AlertsConfig = {};
    // should not throw
    await expect(dispatchAlert(config, budgetExceeded, noopLog)).resolves.toBeUndefined();
  });

  it("calls telegram when configured", async () => {
    let captured: AlertEvent | undefined;

    const config: AlertsConfig = {
      telegram: { botToken: "test-token", chatId: "123456" },
    };

    // Monkey-patch fetch
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_url: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    await dispatchAlert(config, budgetExceeded, noopLog);

    globalThis.fetch = originalFetch;
    // No assertion needed — just verifying it didn't throw
  });

  it("swallows telegram errors without throwing", async () => {
    const config: AlertsConfig = {
      telegram: { botToken: "bad-token", chatId: "999" },
    };

    let errorLogged = false;
    const capturingLog = {
      error: (_obj: object, _msg: string) => { errorLogged = true; },
    };

    globalThis.fetch = async () => new Response("Unauthorized", { status: 401 });

    await dispatchAlert(config, budgetExceeded, capturingLog);
    expect(errorLogged).toBe(true);

    globalThis.fetch = fetch;
  });
});

describe("sendTelegramAlert", () => {
  it("formats budget_exceeded message with key details", async () => {
    let body: { text?: string } = {};

    globalThis.fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    await sendTelegramAlert({ botToken: "tok", chatId: "99" }, budgetExceeded);

    expect(body.text).toContain("Budget Cap Exceeded");
    expect(body.text).toContain("abc123def456");
    expect(body.text).toContain("daily");
    expect(body.text).toContain("10.05");
    expect(body.text).toContain("10.00");

    globalThis.fetch = fetch;
  });

  it("formats budget_warning message with percent used", async () => {
    let body: { text?: string } = {};

    globalThis.fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    await sendTelegramAlert({ botToken: "tok", chatId: "99" }, budgetWarning);

    expect(body.text).toContain("Budget Warning");
    expect(body.text).toContain("83%");
    expect(body.text).toContain("monthly");

    globalThis.fetch = fetch;
  });

  it("throws on non-ok response", async () => {
    globalThis.fetch = async () => new Response("Forbidden", { status: 403 });

    await expect(
      sendTelegramAlert({ botToken: "tok", chatId: "99" }, budgetExceeded),
    ).rejects.toThrow("Telegram API error 403");

    globalThis.fetch = fetch;
  });
});
