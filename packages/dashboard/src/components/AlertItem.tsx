import type { Alert } from "../types.js";

function fmt(n: number): string {
  if (n >= 1) return n.toFixed(2);
  if (n >= 0.01) return n.toFixed(4);
  return n.toFixed(6);
}

const iconMap = {
  budget_exceeded: "⬛",
  budget_warning: "▲",
  anomaly_spike: "◆",
  loop_detected: "↺",
  key_frozen: "⬡",
};

const colorMap = {
  budget_exceeded: "border-rose/30 bg-rose/5 text-rose",
  budget_warning: "border-amber/30 bg-amber/5 text-amber",
  anomaly_spike: "border-ember/30 bg-ember/5 text-ember",
  loop_detected: "border-rose/30 bg-rose/5 text-rose",
  key_frozen: "border-amber/30 bg-amber/5 text-amber",
};

interface AlertItemProps {
  alert: Alert;
}

export default function AlertItem({ alert }: AlertItemProps) {
  const time = new Date(alert.ts).toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });

  const color = colorMap[alert.type];

  return (
    <div className={`flex gap-3 rounded border p-3 fade-in ${color}`}>
      <span className="shrink-0 mt-0.5 font-mono text-sm">{iconMap[alert.type]}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[10px] font-mono uppercase tracking-widest opacity-70">
            {alert.type.replace(/_/g, " ")}
          </span>
          <span className="text-[10px] font-mono text-ghost ml-auto">{time}</span>
        </div>
        <p className="text-xs font-mono text-text leading-relaxed">{alert.message}</p>
        <p className="mt-1 text-[10px] font-mono text-ghost truncate">
          key: {alert.keyHash.slice(0, 16)}…
        </p>
        {alert.type === "anomaly_spike" && (
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] font-mono text-ghost">
            <span>z={fmt(Number(alert.payload["zScore"] ?? 0))}σ</span>
            <span>base=${fmt(Number(alert.payload["emaValue"] ?? 0))}/hr</span>
            <span>now=${fmt(Number(alert.payload["currentValue"] ?? 0))}/hr</span>
          </div>
        )}
      </div>
    </div>
  );
}
