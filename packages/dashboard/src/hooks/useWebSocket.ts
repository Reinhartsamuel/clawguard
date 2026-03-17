import { useEffect, useRef, useCallback } from "react";
import type { WsEvent } from "../types.js";

type Handler = (event: WsEvent) => void;

export function useWebSocket(onEvent: Handler) {
  const wsRef = useRef<WebSocket | null>(null);
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  const connect = useCallback(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/cg-ws`);

    ws.onopen = () => {
      console.log("[ClawGuard] WS connected");
    };

    ws.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data as string) as WsEvent;
        handlerRef.current(event);
      } catch { /* ignore malformed */ }
    };

    ws.onclose = () => {
      // Reconnect after 2s
      setTimeout(connect, 2000);
    };

    wsRef.current = ws;
    return ws;
  }, []);

  useEffect(() => {
    const ws = connect();
    return () => {
      ws.onclose = null; // prevent reconnect on intentional unmount
      ws.close();
    };
  }, [connect]);
}
