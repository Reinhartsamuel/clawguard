import type { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { logger as honoLogger } from "hono/logger";
import pino from "pino";
import { parseIngress, hashKey, ProxyError } from "./router/ingress.js";
import { forwardRequest } from "./router/egress.js";
import { logRequest } from "./store/requests.js";
import { incrementSpend, getSpend, getCurrentWindows } from "./store/counters.js";
import { pruneRequests } from "./store/requests.js";
import { checkBudget } from "./policy/budget.js";
import { checkAnomaly, recordAnomalyBaseline } from "./policy/anomaly.js";
import { checkLoop } from "./policy/loop.js";
import { loadConfig } from "./config/schema.js";
import { dispatchAlert } from "./alert/dispatcher.js";
import { sendPauseAlert, answerCallbackQuery } from "./alert/telegram.js";
import { waitForGate, resolveGate, listPendingGates } from "./store/pauseGate.js";
import { isKeyFrozen, freezeKey, unfreezeKey, listFrozenKeys } from "./store/freeze.js";
import { getAllSpend } from "./store/counters.js";
import { getKeyPolicy, setKeyPolicy, deleteKeyPolicy, listKeyPolicies, mergeKeyBudget, mergeKeyAnomaly } from "./store/keyPolicies.js";
import type { KeyPolicy } from "./store/keyPolicies.js";
import type { UsageResult } from "./tokens/counter.js";
import { publish } from "./ws/events.js";

const log = pino({ level: process.env["LOG_LEVEL"] ?? "info" });

let requestCounter = 0;

export function createApp(db?: Database) {
  const app = new Hono();
  const config = loadConfig();

  if (config.budget.hourly || config.budget.daily || config.budget.monthly) {
    log.info(
      {
        hourly: config.budget.hourly ? `$${config.budget.hourly}` : "none",
        daily: config.budget.daily ? `$${config.budget.daily}` : "none",
        monthly: config.budget.monthly ? `$${config.budget.monthly}` : "none",
      },
      "budget caps active",
    );
  }

  if (config.alerts.telegram) {
    log.info({ chatId: config.alerts.telegram.chatId }, "telegram alerts enabled");
  }

  // Request logging
  app.use(honoLogger());

  // Health check
  app.get("/health", (c) => c.json({ status: "ok" }));

  // ── Built dashboard static serving ───────────────────────────────────────
  // Serves pre-built dashboard files when running as a packaged install.
  // In dev mode, the Vite dev server handles the dashboard on port 4200 instead.
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const dashboardDist = resolve(__dirname, "../dashboard");
  if (existsSync(dashboardDist)) {
    app.get("/dashboard", (c) => c.redirect("/dashboard/"));
    app.get("/dashboard/*", async (c) => {
      const reqPath = c.req.path.replace(/^\/dashboard/, "") || "/";
      const filePath = resolve(dashboardDist, reqPath.replace(/^\//, ""));
      const indexPath = resolve(dashboardDist, "index.html");

      // Try exact file, fall back to index.html for SPA routing
      const target = existsSync(filePath) && !filePath.endsWith(dashboardDist) ? filePath : indexPath;
      if (!existsSync(target)) return c.notFound();

      const file = Bun.file(target);
      const contentType = target.endsWith(".js") ? "application/javascript"
        : target.endsWith(".css") ? "text/css"
        : target.endsWith(".html") ? "text/html"
        : target.endsWith(".svg") ? "image/svg+xml"
        : "application/octet-stream";

      return new Response(file, { headers: { "content-type": contentType } });
    });
    log.info({ path: dashboardDist }, "serving built dashboard at /dashboard/");
  }

  // ── Management API ────────────────────────────────────────────────────────

  // GET /api/status — current spend for all keys across active windows
  app.get("/api/status", (c) => {
    if (!db) return c.json({ error: "no database" }, { status: 503 });
    const now = Date.now();
    const frozen = listFrozenKeys(db);
    const frozenHashes = new Set(frozen.map((f) => f.keyHash));

    // Get all distinct key hashes from spend_counters
    const rows = db.prepare(
      `SELECT DISTINCT key_hash FROM spend_counters`,
    ).all() as { key_hash: string }[];

    const keys = rows.map(({ key_hash }) => {
      const spend = getAllSpend(db!, key_hash, now);
      return {
        keyHash: key_hash,
        frozen: frozenHashes.has(key_hash),
        spend: Object.fromEntries(spend.map((s) => [s.windowType, { cost: s.totalCost, requests: s.requestCount }])),
      };
    });

    return c.json({
      timestamp: new Date(now).toISOString(),
      budget: {
        hourly: config.budget.hourly,
        daily: config.budget.daily,
        monthly: config.budget.monthly,
      },
      keys,
      frozen,
    });
  });

  // POST /api/freeze — freeze a key hash
  app.post("/api/freeze", async (c) => {
    if (!db) return c.json({ error: "no database" }, { status: 503 });
    const body = await c.req.json<{ keyHash: string; reason?: string }>();
    if (!body.keyHash) return c.json({ error: "keyHash required" }, { status: 400 });
    freezeKey(db, body.keyHash, body.reason ?? "manual");
    log.warn({ keyHash: body.keyHash, reason: body.reason }, "key frozen via API");
    return c.json({ frozen: true, keyHash: body.keyHash });
  });

  // POST /api/unfreeze — unfreeze a key hash
  app.post("/api/unfreeze", async (c) => {
    if (!db) return c.json({ error: "no database" }, { status: 503 });
    const body = await c.req.json<{ keyHash: string }>();
    if (!body.keyHash) return c.json({ error: "keyHash required" }, { status: 400 });
    unfreezeKey(db, body.keyHash);
    log.info({ keyHash: body.keyHash }, "key unfrozen via API");
    return c.json({ frozen: false, keyHash: body.keyHash });
  });

  // GET /api/keys — list all keys with spend + policy
  app.get("/api/keys", (c) => {
    if (!db) return c.json({ error: "no database" }, { status: 503 });
    const now = Date.now();
    const frozen = listFrozenKeys(db);
    const frozenHashes = new Set(frozen.map((f) => f.keyHash));
    const policies = listKeyPolicies(db);
    const policyMap = new Map(policies.map((p) => [p.keyHash, p]));

    const rows = db.prepare(`SELECT DISTINCT key_hash FROM spend_counters`).all() as { key_hash: string }[];
    // Also include keys that have policies but no spend yet
    for (const p of policies) {
      if (!rows.find((r) => r.key_hash === p.keyHash)) rows.push({ key_hash: p.keyHash });
    }

    const keys = rows.map(({ key_hash }) => {
      const spend = getAllSpend(db!, key_hash, now);
      return {
        keyHash: key_hash,
        frozen: frozenHashes.has(key_hash),
        policy: policyMap.get(key_hash) ?? null,
        spend: Object.fromEntries(spend.map((s) => [s.windowType, { cost: s.totalCost, requests: s.requestCount }])),
      };
    });
    return c.json({ keys, timestamp: new Date(now).toISOString() });
  });

  // POST /api/keys/register — hash a raw API key and return its hash (key is never stored)
  app.post("/api/keys/register", async (c) => {
    const body = await c.req.json<{ apiKey: string; label?: string }>().catch(() => null);
    if (!body?.apiKey) return c.json({ error: "apiKey required" }, { status: 400 });
    const keyHash = hashKey(body.apiKey);
    // Optionally pre-create a policy with the label so the key shows up in the UI
    if (db && body.label) {
      const existing = getKeyPolicy(db, keyHash);
      const policy: KeyPolicy = { ...existing, keyHash, label: body.label, updatedAt: Date.now() };
      setKeyPolicy(db, policy);
    }
    return c.json({ keyHash });
  });

  // GET /api/keys/:hash/policy — get per-key policy
  app.get("/api/keys/:hash/policy", (c) => {
    if (!db) return c.json({ error: "no database" }, { status: 503 });
    const keyHash = c.req.param("hash");
    const policy = getKeyPolicy(db, keyHash);
    return c.json({ keyHash, policy });
  });

  // PUT /api/keys/:hash/policy — set/update per-key policy
  app.put("/api/keys/:hash/policy", async (c) => {
    if (!db) return c.json({ error: "no database" }, { status: 503 });
    const keyHash = c.req.param("hash");
    const body = await c.req.json<Omit<KeyPolicy, "keyHash" | "updatedAt">>();
    const policy: KeyPolicy = { ...body, keyHash, updatedAt: Date.now() };
    setKeyPolicy(db, policy);
    log.info({ keyHash }, "per-key policy updated");
    return c.json({ ok: true, policy });
  });

  // DELETE /api/keys/:hash/policy — remove per-key policy (revert to global)
  app.delete("/api/keys/:hash/policy", (c) => {
    if (!db) return c.json({ error: "no database" }, { status: 503 });
    const keyHash = c.req.param("hash");
    deleteKeyPolicy(db, keyHash);
    log.info({ keyHash }, "per-key policy removed");
    return c.json({ ok: true, keyHash });
  });

  // GET /api/pause-gates — list keys currently waiting for human approval
  app.get("/api/pause-gates", (c) => {
    return c.json({ pendingKeys: listPendingGates() });
  });

  // POST /telegram-webhook — receives callback_query updates from Telegram
  // Telegram requires a publicly reachable HTTPS URL (set CLAWGUARD_TELEGRAM_WEBHOOK_URL).
  // In local dev, expose via: npx cloudflared tunnel --url http://localhost:4100
  app.post("/telegram-webhook", async (c) => {
    const body = await c.req.json<{
      callback_query?: {
        id: string;
        data?: string;
      };
    }>().catch(() => null);

    const query = body?.callback_query;
    if (!query?.data) return c.json({ ok: true });

    const [action, keyHash] = query.data.split(":");
    if (!keyHash || (action !== "approve" && action !== "deny")) {
      return c.json({ ok: true });
    }

    const decision = action === "approve" ? "approved" : "denied";
    resolveGate(keyHash, decision);

    log.info({ keyHash, decision }, "pause gate resolved via Telegram");

    // Publish to dashboard
    publish("pause_gate_resolved", { keyHash, decision });

    // Dispatch resolution alert (non-blocking)
    void dispatchAlert(
      config.alerts,
      {
        reason: "pause_gate_resolved",
        severity: "warn",
        keyHash,
        decision,
        timestamp: Date.now(),
      },
      log,
    );

    // Answer the callback_query to remove the loading spinner on Telegram button
    if (config.alerts.telegram) {
      const label = decision === "approved" ? "✅ Approved" : "❌ Denied";
      void answerCallbackQuery(config.alerts.telegram, query.id, label).catch(() => {});
    }

    return c.json({ ok: true });
  });

  // Catch-all proxy route — handles both /v1/* and /* paths
  app.all("/*", async (c) => {
    const requestId = crypto.randomUUID();
    const startTime = performance.now();

    const onUsage = (usage: UsageResult, keyHash: string, effectiveBudget: ReturnType<typeof mergeKeyBudget>) => {
      const durationMs = Math.round(performance.now() - startTime);
      const now = Date.now();

      log.info(
        {
          requestId,
          keyHash,
          model: usage.model,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadTokens: usage.cacheReadTokens,
          cacheCreationTokens: usage.cacheCreationTokens,
          totalTokens: usage.totalTokens,
          estimatedCost: `$${usage.estimatedCost.toFixed(6)}`,
          isEstimated: usage.isEstimated,
          durationMs,
        },
        "request completed",
      );

      // Persist to SQLite
      if (db) {
        try {
          logRequest(db, {
            requestId,
            keyHash,
            model: usage.model,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cacheReadTokens: usage.cacheReadTokens,
            cacheCreationTokens: usage.cacheCreationTokens,
            totalTokens: usage.totalTokens,
            estimatedCost: usage.estimatedCost,
            isEstimated: usage.isEstimated,
            createdAt: now,
          });

          incrementSpend(db, keyHash, usage.estimatedCost, now);

          // Update EMA baseline after spend is recorded
          recordAnomalyBaseline(db, keyHash, config.anomaly, now);

          // Publish real-time event for dashboard
          publish("request_completed", {
            requestId,
            keyHash,
            model: usage.model,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            estimatedCost: usage.estimatedCost,
            isEstimated: usage.isEstimated,
            durationMs: Math.round(performance.now() - startTime),
          });

          requestCounter++;
          if (requestCounter % 1000 === 0) {
            pruneRequests(db, keyHash);
          }

          // Check if spend crossed the warn threshold on any capped window.
          // Collect all active caps: global + per-key (both checked independently, tighter wins).
          const windows = getCurrentWindows(now);
          const globalCaps: Array<{ type: "hourly" | "daily" | "monthly"; cap: number }> = [];
          if (config.budget.hourly != null) globalCaps.push({ type: "hourly", cap: config.budget.hourly });
          if (config.budget.daily != null) globalCaps.push({ type: "daily", cap: config.budget.daily });
          if (config.budget.monthly != null) globalCaps.push({ type: "monthly", cap: config.budget.monthly });
          const keyCaps: Array<{ type: "hourly" | "daily" | "monthly"; cap: number }> = [];
          if (effectiveBudget.hourly != null) keyCaps.push({ type: "hourly", cap: effectiveBudget.hourly });
          if (effectiveBudget.daily != null) keyCaps.push({ type: "daily", cap: effectiveBudget.daily });
          if (effectiveBudget.monthly != null) keyCaps.push({ type: "monthly", cap: effectiveBudget.monthly });
          // Merge: for each window type, use the tighter (lower) cap
          const capMap = new Map<string, number>();
          for (const { type, cap } of [...globalCaps, ...keyCaps]) {
            const existing = capMap.get(type);
            if (existing === undefined || cap < existing) capMap.set(type, cap);
          }
          const caps = Array.from(capMap.entries()).map(([type, cap]) => ({ type: type as "hourly" | "daily" | "monthly", cap }));

          for (const { type, cap } of caps) {
            const window = windows.find((w) => w.type === type);
            if (!window) continue;
            const counter = getSpend(db, keyHash, type, window.start);
            const currentSpend = counter?.totalCost ?? 0;
            const percentUsed = currentSpend / cap;

            if (percentUsed >= config.alerts.warnThreshold && percentUsed < 1) {
              void dispatchAlert(
                config.alerts,
                {
                  reason: "budget_warning",
                  severity: "warn",
                  keyHash,
                  windowType: type,
                  currentSpend,
                  cap,
                  percentUsed: percentUsed * 100,
                  timestamp: now,
                },
                log,
              );
            }
          }
        } catch (err) {
          log.error({ requestId, err }, "failed to persist request data");
        }
      }
    };

    try {
      const ingress = parseIngress(c);

      // Freeze check — BEFORE budget check
      if (db && isKeyFrozen(db, ingress.keyHash)) {
        log.warn({ requestId, keyHash: ingress.keyHash }, "request denied: key is frozen");
        return c.json(
          { error: { message: "This API key has been frozen by ClawGuard", type: "key_frozen", code: 429 } },
          { status: 429 },
        );
      }

      // Resolve per-key policy (merge over global config)
      const keyPolicy = db ? getKeyPolicy(db, ingress.keyHash) : null;
      const effectiveBudget = mergeKeyBudget(config.budget, keyPolicy);
      const effectiveAnomaly = mergeKeyAnomaly(config.anomaly, keyPolicy);
      const effectiveLoopEnabled = keyPolicy?.loopEnabled ?? config.loop.enabled;

      // Budget check — BEFORE forwarding to provider
      // Global and per-key caps are independent: deny if either is exceeded.
      if (db) {
        const globalBudgetResult = checkBudget(db, ingress.keyHash, config.budget);
        const keyBudgetResult = keyPolicy?.budget
          ? checkBudget(db, ingress.keyHash, {
              hourly: keyPolicy.budget.hourly ?? null,
              daily: keyPolicy.budget.daily ?? null,
              monthly: keyPolicy.budget.monthly ?? null,
            })
          : { allowed: true as const };
        const budgetResult = globalBudgetResult.allowed ? keyBudgetResult : globalBudgetResult;
        if (!budgetResult.allowed) {
          log.warn(
            {
              requestId,
              keyHash: ingress.keyHash,
              windowType: budgetResult.windowType,
              currentSpend: budgetResult.currentSpend,
              cap: budgetResult.cap,
            },
            "request denied: budget cap exceeded",
          );

          await dispatchAlert(
            config.alerts,
            {
              reason: "budget_exceeded",
              severity: "critical",
              keyHash: ingress.keyHash,
              windowType: budgetResult.windowType!,
              currentSpend: budgetResult.currentSpend!,
              cap: budgetResult.cap!,
              requestId,
              timestamp: Date.now(),
            },
            log,
          );

          return c.json(
            {
              error: {
                message: budgetResult.reason,
                type: "budget_exceeded",
                code: 429,
              },
            },
            { status: 429 },
          );
        }
      }

      // Read body once — shared by loop detection and forwarded to provider
      const rawBody = c.req.method === "GET" || c.req.method === "HEAD"
        ? ""
        : await c.req.raw.text().catch(() => "");

      // Loop detection — BEFORE forwarding to provider
      if (db) {
        const effectiveLoopConfig = { ...config.loop, enabled: effectiveLoopEnabled };
        const loopResult = checkLoop(db, ingress.keyHash, rawBody, effectiveLoopConfig, Date.now());
        if (loopResult.verdict === "DENY") {
          log.warn(
            { requestId, keyHash: ingress.keyHash, trigger: loopResult.trigger, reason: loopResult.reason },
            "request denied: loop detected",
          );
          await dispatchAlert(
            config.alerts,
            {
              reason: "loop_detected",
              severity: "critical",
              keyHash: ingress.keyHash,
              trigger: loopResult.trigger!,
              message: loopResult.reason!,
              timestamp: Date.now(),
            },
            log,
          );
          return c.json(
            { error: { message: loopResult.reason, type: "loop_detected", code: 429 } },
            { status: 429 },
          );
        }
      }

      // Anomaly detection — BEFORE forwarding to provider
      if (db) {
        const anomalyResult = checkAnomaly(db, ingress.keyHash, effectiveAnomaly);

        if (anomalyResult.verdict === "DENY") {
          log.warn(
            { requestId, keyHash: ingress.keyHash, zScore: anomalyResult.zScore, reason: anomalyResult.reason },
            "request denied: anomaly spike",
          );
          await dispatchAlert(
            config.alerts,
            {
              reason: "anomaly_spike",
              severity: "critical",
              keyHash: ingress.keyHash,
              currentValue: anomalyResult.currentValue!,
              emaValue: anomalyResult.emaValue!,
              stdDev: anomalyResult.stdDev!,
              zScore: anomalyResult.zScore!,
              verdict: "DENY",
              message: anomalyResult.reason!,
              timestamp: Date.now(),
            },
            log,
          );
          return c.json(
            { error: { message: anomalyResult.reason, type: "anomaly_spike", code: 429 } },
            { status: 429 },
          );
        }

        if (anomalyResult.verdict === "PAUSE") {
          log.warn(
            { requestId, keyHash: ingress.keyHash, zScore: anomalyResult.zScore },
            "request paused: awaiting human approval",
          );

          // Notify dashboard
          publish("pause_gate_opened", {
            keyHash: ingress.keyHash,
            zScore: anomalyResult.zScore ?? 0,
            timeoutSeconds: config.alerts.pauseTimeoutSeconds,
          });

          // Send Telegram message with Approve/Deny buttons (non-blocking fire-and-forget errors)
          if (config.alerts.telegram) {
            void sendPauseAlert(
              config.alerts.telegram,
              ingress.keyHash,
              anomalyResult.zScore ?? 0,
              config.alerts.pauseTimeoutSeconds,
            ).catch((err) => log.error({ err }, "failed to send pause Telegram alert"));
          }

          // Hold the HTTP connection open — resolves when owner taps button or timeout elapses
          const decision = await waitForGate(
            ingress.keyHash,
            config.alerts.pauseTimeoutSeconds * 1000,
          );

          log.info({ requestId, keyHash: ingress.keyHash, decision }, "pause gate resolved");

          if (decision !== "approved") {
            return c.json(
              { error: { message: "Request paused pending review — denied or timed out", type: "paused", code: 429 } },
              { status: 429 },
            );
          }
          // decision === "approved" — fall through to forwardRequest()
        }

        if (anomalyResult.verdict === "WARN") {
          log.warn(
            { requestId, keyHash: ingress.keyHash, zScore: anomalyResult.zScore, reason: anomalyResult.reason },
            "anomaly spike warning",
          );
          void dispatchAlert(
            config.alerts,
            {
              reason: "anomaly_spike",
              severity: "warn",
              keyHash: ingress.keyHash,
              currentValue: anomalyResult.currentValue!,
              emaValue: anomalyResult.emaValue!,
              stdDev: anomalyResult.stdDev!,
              zScore: anomalyResult.zScore!,
              verdict: "WARN",
              message: anomalyResult.reason!,
              timestamp: Date.now(),
            },
            log,
          );
        }
      }

      return await forwardRequest(c, ingress, requestId, (usage) =>
        onUsage(usage, ingress.keyHash, effectiveBudget),
        rawBody,
      );
    } catch (err) {
      if (err instanceof ProxyError) {
        return c.json(
          {
            error: {
              message: err.message,
              type: "proxy_error",
              code: err.status,
            },
          },
          err.status as 400 | 401 | 429 | 502,
        );
      }
      log.error({ requestId, err }, "unhandled proxy error");
      return c.json(
        {
          error: {
            message: "Internal proxy error",
            type: "proxy_error",
            code: 500,
          },
        },
        { status: 500 },
      );
    }
  });

  return app;
}
