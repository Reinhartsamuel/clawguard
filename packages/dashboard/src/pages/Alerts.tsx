import { useState } from "react";
import AlertItem from "../components/AlertItem.js";
import type { Alert, AlertSeverity } from "../types.js";

interface Props {
  alerts: Alert[];
  onRefetch: () => void;
}

type Filter = "all" | AlertSeverity | Alert["type"];

export default function Alerts({ alerts, onRefetch }: Props) {
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = alerts.filter((a) => {
    if (filter === "all") return true;
    if (filter === "warn" || filter === "critical") return a.severity === filter;
    return a.type === filter;
  });

  const criticals = alerts.filter((a) => a.severity === "critical").length;
  const warns = alerts.filter((a) => a.severity === "warn").length;

  const filters: Array<{ id: Filter; label: string; count?: number }> = [
    { id: "all", label: "All", count: alerts.length },
    { id: "critical", label: "Critical", count: criticals },
    { id: "warn", label: "Warn", count: warns },
    { id: "budget_exceeded", label: "Budget" },
    { id: "anomaly_spike", label: "Anomaly" },
    { id: "loop_detected", label: "Loop" },
  ];

  return (
    <div className="fade-in space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[10px] font-mono uppercase tracking-[0.15em] text-ghost">
          Alert Timeline — {alerts.length} events
        </h2>
        <button
          onClick={onRefetch}
          className="text-[10px] font-mono text-ghost hover:text-dim px-2 py-1 rounded border border-border hover:border-muted transition-colors"
        >
          ↻ refresh
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-1.5">
        {filters.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`px-2.5 py-1 rounded text-[10px] font-mono border transition-colors ${
              filter === f.id
                ? "bg-guard/15 border-guard/30 text-guard"
                : "border-border text-ghost hover:text-dim hover:border-muted"
            }`}
          >
            {f.label}
            {f.count !== undefined && f.count > 0 && (
              <span className="ml-1.5 opacity-70">{f.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Stats row */}
      {alerts.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-rose/20 bg-rose/5 p-3 text-center">
            <p className="text-lg font-mono text-rose font-semibold">{criticals}</p>
            <p className="text-[10px] font-mono text-ghost mt-0.5">critical</p>
          </div>
          <div className="rounded-lg border border-amber/20 bg-amber/5 p-3 text-center">
            <p className="text-lg font-mono text-amber font-semibold">{warns}</p>
            <p className="text-[10px] font-mono text-ghost mt-0.5">warnings</p>
          </div>
          <div className="rounded-lg border border-border bg-panel p-3 text-center">
            <p className="text-lg font-mono text-dim font-semibold">{alerts.length}</p>
            <p className="text-[10px] font-mono text-ghost mt-0.5">total</p>
          </div>
        </div>
      )}

      {/* Alert list */}
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-border bg-panel p-10 sm:p-16 text-center">
          <p className="text-guard font-mono text-sm">✓ All clear</p>
          <p className="text-[10px] font-mono text-ghost mt-2">
            {filter === "all" ? "No alerts yet — proxy is running normally" : `No ${filter} alerts`}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((a) => <AlertItem key={a.id} alert={a} />)}
        </div>
      )}

      {/* Freeze action helper */}
      {criticals > 0 && (
        <div className="rounded-lg border border-rose/20 bg-rose/5 p-3 sm:p-4">
          <p className="text-xs font-mono text-rose mb-2">Runaway spend detected</p>
          <p className="text-[10px] font-mono text-ghost leading-relaxed">
            Use <span className="font-medium text-dim">Keys → freeze</span> to immediately block a key, or run{" "}
            <code className="text-guard bg-guard/10 px-1 rounded break-all">clawguard freeze &lt;hash&gt;</code> from the CLI.
          </p>
        </div>
      )}
    </div>
  );
}
