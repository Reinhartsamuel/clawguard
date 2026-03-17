interface StatCardProps {
  label: string;
  value: string;
  sub?: string;
  accent?: "guard" | "ember" | "amber" | "rose" | "dim";
  pulse?: boolean;
}

const accentStyles = {
  guard: "text-guard border-guard/20 bg-guard/5",
  ember: "text-ember border-ember/20 bg-ember/5",
  amber: "text-amber border-amber/20 bg-amber/5",
  rose: "text-rose border-rose/20 bg-rose/5",
  dim: "text-dim border-border bg-surface",
};

export default function StatCard({ label, value, sub, accent = "dim", pulse }: StatCardProps) {
  return (
    <div className={`rounded-lg border p-3 sm:p-4 fade-in ${accentStyles[accent]}`}>
      <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-ghost mb-1.5 sm:mb-2 truncate">{label}</p>
      <p className={`font-mono text-lg sm:text-2xl font-semibold tabular-nums leading-none truncate ${pulse ? "alert-pulse" : ""}`}>
        {value}
      </p>
      {sub && <p className="mt-1 sm:mt-1.5 text-[10px] sm:text-[11px] font-mono text-ghost truncate">{sub}</p>}
    </div>
  );
}
