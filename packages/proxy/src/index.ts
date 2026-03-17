import { createApp } from "./server.js";
import { getDb } from "./store/db.js";
import { defaults } from "./config/defaults.js";
import { subscribe } from "./ws/events.js";
import type { WsEvent } from "./ws/events.js";
import { loadLivePricing } from "./tokens/pricing.js";
import { loadConfig } from "./config/schema.js";
import { registerWebhook } from "./alert/telegram.js";

const port = Number(process.env["PORT"]) || defaults.port;
const db = getDb();
const app = createApp(db);

// ── WebSocket client tracking ───────────────────────────────────────────────
const wsClients = new Set<{ send: (data: string) => void; readyState: number }>();

function broadcast(event: WsEvent): void {
  const msg = JSON.stringify(event);
  for (const ws of wsClients) {
    if (ws.readyState === 1 /* OPEN */) {
      try { ws.send(msg); } catch { wsClients.delete(ws); }
    }
  }
}

// Subscribe to the in-process event bus and fan out to all WS clients
subscribe(broadcast);

// ── Start server ────────────────────────────────────────────────────────────
Bun.serve({
  port,
  fetch: async (req, server) => {
    // Upgrade WebSocket connections on /ws path
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      const upgraded = server.upgrade(req);
      if (upgraded) return undefined as unknown as Response;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }
    return app.fetch(req);
  },
  websocket: {
    open(ws) {
      wsClients.add(ws);
      // Send a snapshot on connect so the dashboard has immediate data
      ws.send(JSON.stringify({
        type: "connected",
        ts: Date.now(),
        payload: { message: "ClawGuard WebSocket connected" },
      }));
    },
    message(_ws, _message) {
      // Dashboard doesn't send messages (read-only feed)
    },
    close(ws) {
      wsClients.delete(ws);
    },
  },
});

// Load live pricing from LiteLLM (non-blocking — falls back to hardcoded table if it fails)
void loadLivePricing({ info: (m) => console.log(`[pricing] ${m}`), warn: (m) => console.warn(`[pricing] ${m}`) });

// Register Telegram webhook for HITL pause gate (non-blocking)
const config = loadConfig();
if (config.alerts.telegram && config.alerts.telegramWebhookUrl) {
  void registerWebhook(config.alerts.telegram, config.alerts.telegramWebhookUrl)
    .then(() => console.log(`   Telegram webhook: ${config.alerts.telegramWebhookUrl}`))
    .catch((err: unknown) => console.warn(`[telegram] setWebhook failed: ${String(err)}`));
}

console.log(`🛡️  ClawGuard proxy listening on http://localhost:${port}`);
console.log(`   Health check: http://localhost:${port}/health`);
console.log(`   WebSocket:    ws://localhost:${port}/ws`);
console.log(`   Database:     ${process.env["CLAWGUARD_DB_PATH"] ?? "data/clawguard.db"}`);
