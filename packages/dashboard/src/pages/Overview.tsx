import { useMemo } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from "recharts";
import StatCard from "../components/StatCard.js";
import AlertItem from "../components/AlertItem.js";
import BudgetBar from "../components/BudgetBar.js";
import type { StatusResponse, KeysResponse, Alert } from "../types.js";

interface Props {
  status: StatusResponse | null;
  keys: KeysResponse | null;
  alerts: Alert[];
}

function fmt(n: number): string {
  if (n >= 1) return n.toFixed(2);
  if (n >= 0.01) return n.toFixed(4);
  return n.toFixed(6);
}

// Generate mock time-series from current spend (real data would come from SQLite history)
function buildSpendSeries(totalToday: number) {
  const now = Date.now();
  const points = [];
  for (let i = 23; i >= 0; i--) {
    const h = new Date(now - i * 3600_000);
    const label = h.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    // Distribute spend roughly across hours with recency weighting
    const weight = i === 0 ? 0.4 : Math.max(0, (24 - i) / 24) * 0.05;
    points.push({ time: label, cost: totalToday * weight, requests: Math.round(totalToday * weight * 500) });
  }
  return points;
}

const PIE_COLORS = ["#00d4aa", "#ff6b35", "#f5a623", "#ff4466", "#6b7280"];

export default function Overview({ status, keys, alerts }: Props) {
  const allKeys = keys?.keys ?? [];

  const totalDaily = useMemo(() =>
    allKeys.reduce((sum, k) => sum + (k.spend.daily?.cost ?? 0), 0), [allKeys]);

  const totalHourly = useMemo(() =>
    allKeys.reduce((sum, k) => sum + (k.spend.hourly?.cost ?? 0), 0), [allKeys]);

  const totalRequests = useMemo(() =>
    allKeys.reduce((sum, k) => sum + (k.spend.daily?.requests ?? 0), 0), [allKeys]);

  const frozenCount = useMemo(() =>
    allKeys.filter((k) => k.frozen).length, [allKeys]);

  const criticalAlerts = alerts.filter((a) => a.severity === "critical").length;

  const spendSeries = useMemo(() => buildSpendSeries(totalDaily), [totalDaily]);

  const budget = status?.budget;
  const dailyCap = budget?.daily;
  const hourlyCap = budget?.hourly;
  const monthlyCap = budget?.monthly;

  const totalMonthly = useMemo(() =>
    allKeys.reduce((sum, k) => sum + (k.spend.monthly?.cost ?? 0), 0), [allKeys]);

  // Model breakdown from keys (placeholder — would need real model data)
  const modelData = [
    { name: "gpt-4o-mini", value: 60 },
    { name: "gpt-4o", value: 25 },
    { name: "claude-3", value: 10 },
    { name: "other", value: 5 },
  ];

  return (
    <div className="space-y-4 fade-in">
      {/* Stat cards — 2 cols on mobile, 4 on desktop */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        <StatCard
          label="Spend Today"
          value={`$${fmt(totalDaily)}`}
          sub={dailyCap ? `of $${dailyCap} cap` : "no daily cap"}
          accent={dailyCap && totalDaily / dailyCap >= 0.9 ? "rose" : "guard"}
        />
        <StatCard
          label="Active Keys"
          value={String(allKeys.length)}
          sub={frozenCount > 0 ? `${frozenCount} frozen` : "all active"}
          accent={frozenCount > 0 ? "amber" : "dim"}
        />
        <StatCard
          label="Alerts"
          value={String(alerts.length)}
          sub={criticalAlerts > 0 ? `${criticalAlerts} critical` : "all clear"}
          accent={criticalAlerts > 0 ? "rose" : "dim"}
          pulse={criticalAlerts > 0}
        />
        <StatCard
          label="Burn Rate"
          value={`$${fmt(totalHourly)}/hr`}
          sub={`${totalRequests} req today`}
          accent="ember"
        />
      </div>

      {/* Budget bars */}
      {(dailyCap || hourlyCap || monthlyCap) && (
        <div className="rounded-lg border border-border bg-panel p-3 sm:p-4 space-y-3">
          <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-ghost mb-3">Budget Caps</p>
          {hourlyCap && <BudgetBar label="Hourly" spent={totalHourly} cap={hourlyCap} />}
          {dailyCap && <BudgetBar label="Daily" spent={totalDaily} cap={dailyCap} />}
          {monthlyCap && <BudgetBar label="Monthly" spent={totalMonthly} cap={monthlyCap} />}
        </div>
      )}

      {/* Spend chart + model mix */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2 rounded-lg border border-border bg-panel p-3 sm:p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-ghost">Spend — Last 24h</p>
            <span className="text-[10px] font-mono text-guard">${fmt(totalDaily)} total</span>
          </div>
          <ResponsiveContainer width="100%" height={140}>
            <AreaChart data={spendSeries} margin={{ top: 0, right: 0, left: -24, bottom: 0 }}>
              <defs>
                <linearGradient id="guardGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#00d4aa" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#00d4aa" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2635" vertical={false} />
              <XAxis dataKey="time" tick={{ fill: "#4a5568", fontSize: 9, fontFamily: "Geist Mono" }} axisLine={false} tickLine={false} interval={5} />
              <YAxis tick={{ fill: "#4a5568", fontSize: 9, fontFamily: "Geist Mono" }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `$${v.toFixed(3)}`} />
              <Tooltip
                contentStyle={{ background: "#121820", border: "1px solid #1e2635", borderRadius: 6, fontFamily: "Geist Mono", fontSize: 11 }}
                labelStyle={{ color: "#6b7280" }}
                itemStyle={{ color: "#00d4aa" }}
                formatter={(v: number) => [`$${v.toFixed(6)}`, "cost"]}
              />
              <Area type="monotone" dataKey="cost" stroke="#00d4aa" strokeWidth={1.5} fill="url(#guardGrad)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Model breakdown — pie left, legend right on mobile; stacked on lg */}
        <div className="rounded-lg border border-border bg-panel p-3 sm:p-4">
          <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-ghost mb-3">Model Mix</p>
          <div className="flex lg:block items-center gap-3">
            <div className="shrink-0 lg:w-full">
              <ResponsiveContainer width={100} height={100} className="lg:w-full lg:h-auto">
                <PieChart width={100} height={100}>
                  <Pie data={modelData} cx="50%" cy="50%" innerRadius={28} outerRadius={46} paddingAngle={2} dataKey="value">
                    {modelData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} strokeWidth={0} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: "#121820", border: "1px solid #1e2635", borderRadius: 6, fontFamily: "Geist Mono", fontSize: 11 }}
                    formatter={(v: number) => [`${v}%`, ""]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex-1 space-y-1.5">
              {modelData.map((d, i) => (
                <div key={d.name} className="flex items-center justify-between text-[10px] font-mono">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: PIE_COLORS[i] }} />
                    <span className="text-ghost truncate">{d.name}</span>
                  </div>
                  <span className="text-dim ml-1 shrink-0">{d.value}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Alert feed */}
      <div className="rounded-lg border border-border bg-panel p-3 sm:p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-ghost">Live Alert Feed</p>
          {alerts.length > 0 && (
            <span className="text-[10px] font-mono text-ghost">{alerts.length} events</span>
          )}
        </div>
        {alerts.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-ghost font-mono text-xs">No alerts — all systems nominal</p>
            <p className="text-[10px] font-mono text-muted mt-1">Alerts appear here in real-time</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {alerts.slice(0, 20).map((a) => <AlertItem key={a.id} alert={a} />)}
          </div>
        )}
      </div>
    </div>
  );
}
