// Internal command used when ClawGuard is compiled as a single binary via `bun build --compile`.
// The `start` command re-execs the same binary with `_proxy` to run the proxy server
// in a subprocess — no separate proxy artifact needed at runtime.
//
// This imports from @clawguard/proxy so bun build --compile bundles all proxy code
// into the single binary at compile time.

import { createApp } from "@clawguard/proxy/src/server.js";
import { getDb } from "@clawguard/proxy/src/store/db.js";
import { defaults } from "@clawguard/proxy/src/config/defaults.js";
import { subscribe } from "@clawguard/proxy/src/ws/events.js";
import type { WsEvent } from "@clawguard/proxy/src/ws/events.js";
import { loadLivePricing } from "@clawguard/proxy/src/tokens/pricing.js";

export async function _proxy(_args: string[]): Promise<void> {
  const port = Number(process.env["PORT"]) || defaults.port;
  const db = getDb();
  const app = createApp(db);

  const wsClients = new Set<{ send: (data: string) => void; readyState: number }>();
  subscribe((event: WsEvent) => {
    const msg = JSON.stringify(event);
    for (const ws of wsClients) {
      if (ws.readyState === 1) {
        try { ws.send(msg); } catch { wsClients.delete(ws); }
      }
    }
  });

  Bun.serve({
    port,
    fetch: async (req, server) => {
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
        ws.send(JSON.stringify({
          type: "connected",
          ts: Date.now(),
          payload: { message: "ClawGuard WebSocket connected" },
        }));
      },
      message() {},
      close(ws) { wsClients.delete(ws); },
    },
  });

  void loadLivePricing({
    info: (m: string) => console.log(`[pricing] ${m}`),
    warn: (m: string) => console.warn(`[pricing] ${m}`),
  });
  console.log(`🛡️  ClawGuard proxy listening on http://localhost:${port}`);
}
