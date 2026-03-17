import { useState, useCallback, useRef } from "react";
import { Routes, Route, Navigate, NavLink, Link } from "react-router-dom";
import { useWebSocket } from "./hooks/useWebSocket.js";
import { useStatus } from "./hooks/useStatus.js";
import Overview from "./pages/Overview.js";
import Keys from "./pages/Keys.js";
import Alerts from "./pages/Alerts.js";
import type { Alert, WsEvent } from "./types.js";

// ── Dashboard layout (WS + nav, only for /dashboard/*) ────────────

let alertSeq = 0;

function DashboardLayout() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const { status, keys, refetch } = useStatus(8000);

  const addAlert = useCallback((alert: Alert) => {
    setAlerts((prev) => [alert, ...prev].slice(0, 200));
  }, []);

  const lastRefetch = useRef(0);

  useWebSocket(
    useCallback(
      (event: WsEvent) => {
        if (event.type === "connected") {
          setWsConnected(true);
          return;
        }

        const now = Date.now();
        if (now - lastRefetch.current > 2000) {
          lastRefetch.current = now;
          void refetch();
        }

        const p = event.payload;

        if (event.type === "budget_exceeded") {
          addAlert({
            id: `${++alertSeq}`,
            type: "budget_exceeded",
            severity: "critical",
            keyHash: String(p["keyHash"] ?? ""),
            message: `Budget exceeded: $${Number(p["currentSpend"]).toFixed(4)} / $${p["cap"]} (${p["windowType"]})`,
            ts: event.ts,
            payload: p,
          });
        } else if (event.type === "budget_warning") {
          addAlert({
            id: `${++alertSeq}`,
            type: "budget_warning",
            severity: "warn",
            keyHash: String(p["keyHash"] ?? ""),
            message: `Budget at ${Number(p["percentUsed"]).toFixed(0)}%: $${Number(p["currentSpend"]).toFixed(4)} / $${p["cap"]} (${p["windowType"]})`,
            ts: event.ts,
            payload: p,
          });
        } else if (event.type === "anomaly_spike") {
          addAlert({
            id: `${++alertSeq}`,
            type: "anomaly_spike",
            severity: p["verdict"] === "DENY" ? "critical" : "warn",
            keyHash: String(p["keyHash"] ?? ""),
            message: String(p["message"] ?? "Anomaly spike detected"),
            ts: event.ts,
            payload: p,
          });
        } else if (event.type === "loop_detected") {
          addAlert({
            id: `${++alertSeq}`,
            type: "loop_detected",
            severity: "critical",
            keyHash: String(p["keyHash"] ?? ""),
            message: String(p["message"] ?? "Loop detected"),
            ts: event.ts,
            payload: p,
          });
        }
      },
      [addAlert, refetch]
    )
  );

  const unreadAlerts = alerts.filter((a) => a.severity === "critical").length;

  const navItems: Array<{ to: string; label: string }> = [
    { to: "/dashboard/overview", label: "overview" },
    { to: "/dashboard/keys",     label: "keys" },
    { to: "/dashboard/alerts",   label: "alerts" },
  ];

  return (
    <div className="scanline min-h-screen bg-void bg-grid">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-void/90 backdrop-blur-sm">
        <div className="mx-auto max-w-7xl flex items-center h-12 px-3 sm:px-4 gap-2 sm:gap-0">
          {/* Logo */}
          <Link
            to="/dashboard/overview"
            className="flex items-center gap-2 sm:pr-6 sm:border-r sm:border-border sm:mr-5 shrink-0 group"
          >
            <div className="relative">
              <div className="w-6 h-6 rounded border border-guard/50 flex items-center justify-center bg-guard/10 group-hover:bg-guard/20 transition-colors">
                <span className="text-guard text-xs font-mono font-bold">CG</span>
              </div>
              <div
                className={`absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full ${
                  wsConnected ? "bg-guard" : "bg-rose"
                }`}
              />
            </div>
            <span className="font-mono text-sm font-medium text-bright tracking-wide hidden sm:block">
              CLAWGUARD
            </span>
          </Link>

          {/* Nav */}
          <nav className="flex items-center gap-0.5 sm:gap-1 flex-1 sm:flex-none overflow-x-auto no-scrollbar">
            {navItems.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `relative px-2.5 sm:px-3 py-1.5 text-[10px] sm:text-xs font-mono uppercase tracking-widest transition-colors whitespace-nowrap ${
                    isActive ? "text-guard" : "text-ghost hover:text-dim"
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    {label}
                    {label === "alerts" && unreadAlerts > 0 && (
                      <span className="ml-1 inline-flex items-center justify-center w-4 h-4 rounded-full bg-rose text-void text-[10px] font-bold font-mono">
                        {unreadAlerts > 9 ? "9+" : unreadAlerts}
                      </span>
                    )}
                    {isActive && (
                      <span className="absolute bottom-0 left-0 right-0 h-px bg-guard" />
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3 shrink-0">
            <span
              className={`text-[10px] font-mono ${
                wsConnected ? "text-guard" : "text-rose alert-pulse"
              }`}
            >
              {wsConnected ? "● LIVE" : "● OFFLINE"}
            </span>
          </div>
        </div>
      </header>

      {/* Page content */}
      <Routes>
        <Route index element={<Navigate to="overview" replace />} />
        <Route
          path="overview"
          element={
            <main className="mx-auto max-w-7xl px-4 py-6">
              <Overview status={status} keys={keys} alerts={alerts} />
            </main>
          }
        />
        <Route
          path="keys"
          element={
            <main className="mx-auto max-w-7xl px-4 py-6">
              <Keys keys={keys} status={status} onRefetch={refetch} />
            </main>
          }
        />
        <Route
          path="alerts"
          element={
            <main className="mx-auto max-w-7xl px-4 py-6">
              <Alerts alerts={alerts} onRefetch={refetch} />
            </main>
          }
        />
<Route path="*" element={<Navigate to="overview" replace />} />
      </Routes>
    </div>
  );
}

// ── Root router ────────────────────────────────────────────────────

export default function App() {
  return (
    <Routes>
      <Route path="/dashboard/*" element={<DashboardLayout />} />
      <Route path="*" element={<Navigate to="/dashboard/overview" replace />} />
    </Routes>
  );
}
