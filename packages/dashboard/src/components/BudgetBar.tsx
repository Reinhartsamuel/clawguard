interface BudgetBarProps {
  label: string;
  spent: number;
  cap: number;
}

export default function BudgetBar({ label, spent, cap }: BudgetBarProps) {
  const pct = Math.min(100, (spent / cap) * 100);
  const color = pct >= 100 ? "bg-rose" : pct >= 80 ? "bg-amber" : "bg-guard";
  const textColor = pct >= 100 ? "text-rose" : pct >= 80 ? "text-amber" : "text-guard";

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px] font-mono">
        <span className="text-ghost uppercase tracking-widest">{label}</span>
        <span className={textColor}>${spent.toFixed(4)} / ${cap.toFixed(2)}</span>
      </div>
      <div className="h-1 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
