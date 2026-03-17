import { useState } from "react";
import type { KeysResponse, StatusResponse, ApiKey, KeyPolicy } from "../types.js";

interface Props {
  keys: KeysResponse | null;
  status: StatusResponse | null;
  onRefetch: () => void;
}

function fmt(n: number): string {
  if (n >= 1) return n.toFixed(2);
  if (n >= 0.01) return n.toFixed(4);
  return n.toFixed(6);
}

function StatusBadge({ frozen }: { frozen: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded border ${
      frozen
        ? "text-rose border-rose/30 bg-rose/5"
        : "text-guard border-guard/30 bg-guard/5"
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${frozen ? "bg-rose" : "bg-guard"}`} />
      {frozen ? "FROZEN" : "ACTIVE"}
    </span>
  );
}

interface PolicyEditorProps {
  keyHash: string;
  existing: KeyPolicy | null;
  onSave: () => void;
  onClose: () => void;
}

function PolicyEditor({ keyHash, existing, onSave, onClose }: PolicyEditorProps) {
  const [label, setLabel] = useState(existing?.label ?? "");
  const [hourly, setHourly] = useState(existing?.budget?.hourly?.toString() ?? "");
  const [daily, setDaily] = useState(existing?.budget?.daily?.toString() ?? "");
  const [monthly, setMonthly] = useState(existing?.budget?.monthly?.toString() ?? "");
  const [warnMult, setWarnMult] = useState(existing?.anomaly?.warnMultiplier?.toString() ?? "");
  const [pauseMult, setPauseMult] = useState(existing?.anomaly?.pauseMultiplier?.toString() ?? "");
  const [killMult, setKillMult] = useState(existing?.anomaly?.killMultiplier?.toString() ?? "");
  const [loopEnabled, setLoopEnabled] = useState(existing?.loopEnabled ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const body: Partial<KeyPolicy> = {};
      if (label) body.label = label;
      if (hourly || daily || monthly) {
        body.budget = {};
        if (hourly) body.budget.hourly = parseFloat(hourly);
        if (daily) body.budget.daily = parseFloat(daily);
        if (monthly) body.budget.monthly = parseFloat(monthly);
      }
      if (warnMult || pauseMult || killMult) {
        body.anomaly = {};
        if (warnMult) body.anomaly.warnMultiplier = parseFloat(warnMult);
        if (pauseMult) body.anomaly.pauseMultiplier = parseFloat(pauseMult);
        if (killMult) body.anomaly.killMultiplier = parseFloat(killMult);
      }
      body.loopEnabled = loopEnabled;

      const res = await fetch(`/api/keys/${keyHash}/policy`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      onSave();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Remove per-key policy? The key will revert to global defaults.")) return;
    await fetch(`/api/keys/${keyHash}/policy`, { method: "DELETE" });
    onSave();
  };

  const inputCls = "w-full bg-void border border-border rounded px-2.5 py-1.5 text-xs font-mono text-text placeholder-muted focus:outline-none focus:border-guard/50 transition-colors";
  const labelCls = "text-[10px] font-mono uppercase tracking-widest text-ghost";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-start justify-center bg-void/80 backdrop-blur-sm">
      <div className="w-full sm:max-w-md sm:mt-16 rounded-t-2xl sm:rounded-xl border border-border bg-panel p-5 shadow-2xl fade-in max-h-[calc(100vh-3rem)] sm:max-h-[calc(100vh-5rem)] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="font-mono text-sm font-medium text-bright">Per-Key Policy</h2>
            <p className="text-[10px] font-mono text-ghost mt-0.5">{keyHash.slice(0, 16)}…</p>
          </div>
          <button onClick={onClose} className="text-ghost hover:text-dim text-xs font-mono">✕ close</button>
        </div>

        <div className="space-y-4">
          <div>
            <label className={labelCls}>Label</label>
            <input className={`${inputCls} mt-1`} placeholder="e.g. production-bot" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>

          <div>
            <p className={`${labelCls} mb-2`}>Budget Caps (USD) — overrides global</p>
            <div className="grid grid-cols-3 gap-2">
              {[["Hourly", hourly, setHourly], ["Daily", daily, setDaily], ["Monthly", monthly, setMonthly]].map(([name, val, set]) => (
                <div key={name as string}>
                  <p className="text-[9px] font-mono text-ghost mb-1">{name as string}</p>
                  <input className={inputCls} placeholder="—" value={val as string} onChange={(e) => (set as (v: string) => void)(e.target.value)} />
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className={`${labelCls} mb-2`}>Anomaly Thresholds (σ) — overrides global</p>
            <div className="grid grid-cols-3 gap-2">
              {[["Warn", warnMult, setWarnMult], ["Pause", pauseMult, setPauseMult], ["Kill", killMult, setKillMult]].map(([name, val, set]) => (
                <div key={name as string}>
                  <p className="text-[9px] font-mono text-ghost mb-1">{name as string}</p>
                  <input className={inputCls} placeholder="—" value={val as string} onChange={(e) => (set as (v: string) => void)(e.target.value)} />
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between py-2 border-t border-border">
            <span className={labelCls}>Loop Detection</span>
            <button
              onClick={() => setLoopEnabled((v) => !v)}
              className={`relative w-10 h-5 rounded-full transition-colors ${loopEnabled ? "bg-guard/30" : "bg-muted"}`}
            >
              <span className={`absolute top-0.5 w-4 h-4 rounded-full transition-transform ${loopEnabled ? "translate-x-5 bg-guard" : "translate-x-0.5 bg-ghost"}`} />
            </button>
          </div>
        </div>

        {error && <p className="mt-3 text-xs font-mono text-rose">{error}</p>}

        <div className="flex gap-2 mt-5">
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className="flex-1 py-2 rounded-lg bg-guard/15 border border-guard/30 text-guard text-xs font-mono hover:bg-guard/25 transition-colors disabled:opacity-50"
          >
            {saving ? "saving…" : "save policy"}
          </button>
          {existing && (
            <button
              onClick={() => void handleDelete()}
              className="px-3 py-2 rounded-lg border border-rose/30 text-rose text-xs font-mono hover:bg-rose/10 transition-colors"
            >
              remove
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

interface KeyRowProps {
  k: ApiKey;
  budget: StatusResponse["budget"];
  onRefetch: () => void;
}

function KeyRow({ k, budget, onRefetch }: KeyRowProps) {
  const [editingPolicy, setEditingPolicy] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const daily = k.spend.daily?.cost ?? 0;
  const hourly = k.spend.hourly?.cost ?? 0;
  const requests = k.spend.daily?.requests ?? 0;

  const effectiveDailyCap = k.policy?.budget?.daily ?? budget.daily;
  const pct = effectiveDailyCap ? (daily / effectiveDailyCap) * 100 : null;

  const handleFreezeToggle = async () => {
    setActionLoading(true);
    const endpoint = k.frozen ? "/api/unfreeze" : "/api/freeze";
    await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyHash: k.keyHash, reason: "manual via dashboard" }),
    });
    onRefetch();
    setActionLoading(false);
  };

  const actions = (
    <div className="flex items-center gap-2">
      <button
        onClick={() => setEditingPolicy(true)}
        className="text-[10px] font-mono text-ghost hover:text-dim px-2 py-1 rounded border border-border hover:border-muted transition-colors"
      >
        policy
      </button>
      <button
        onClick={() => void handleFreezeToggle()}
        disabled={actionLoading}
        className={`text-[10px] font-mono px-2 py-1 rounded border transition-colors ${
          k.frozen
            ? "text-guard border-guard/30 hover:bg-guard/10"
            : "text-rose border-rose/30 hover:bg-rose/10"
        }`}
      >
        {actionLoading ? "…" : k.frozen ? "unfreeze" : "freeze"}
      </button>
    </div>
  );

  return (
    <>
      {/* Desktop row */}
      <tr className="border-t border-border hover:bg-surface/50 transition-colors group hidden sm:table-row">
        <td className="py-3 px-3">
          <StatusBadge frozen={k.frozen} />
        </td>
        <td className="py-3 px-3">
          {k.policy?.label && <p className="text-xs font-mono text-text">{k.policy.label}</p>}
          <p className="text-[10px] font-mono text-ghost">{k.keyHash.slice(0, 16)}…</p>
        </td>
        <td className="py-3 px-3 text-right">
          <p className="text-xs font-mono text-guard">${fmt(daily)}</p>
          {pct !== null && <p className="text-[10px] font-mono text-ghost">{pct.toFixed(0)}% of cap</p>}
        </td>
        <td className="py-3 px-3 text-right">
          <p className="text-xs font-mono text-dim">${fmt(hourly)}/hr</p>
        </td>
        <td className="py-3 px-3 text-right">
          <p className="text-xs font-mono text-dim tabular-nums">{requests.toLocaleString()}</p>
        </td>
        <td className="py-3 px-3 text-right">
          <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            {actions}
          </div>
        </td>
      </tr>

      {/* Mobile card */}
      <tr className="border-t border-border sm:hidden">
        <td colSpan={6} className="p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1">
                <StatusBadge frozen={k.frozen} />
                {k.policy?.label && <span className="text-xs font-mono text-text truncate">{k.policy.label}</span>}
              </div>
              <p className="text-[10px] font-mono text-ghost mb-2">{k.keyHash.slice(0, 16)}…</p>
              <div className="flex items-center gap-4">
                <div>
                  <p className="text-[9px] font-mono text-ghost uppercase">Daily</p>
                  <p className="text-xs font-mono text-guard">${fmt(daily)}{pct !== null ? ` · ${pct.toFixed(0)}%` : ""}</p>
                </div>
                <div>
                  <p className="text-[9px] font-mono text-ghost uppercase">Hourly</p>
                  <p className="text-xs font-mono text-dim">${fmt(hourly)}</p>
                </div>
                <div>
                  <p className="text-[9px] font-mono text-ghost uppercase">Reqs</p>
                  <p className="text-xs font-mono text-dim">{requests.toLocaleString()}</p>
                </div>
              </div>
            </div>
            <div className="flex-shrink-0">{actions}</div>
          </div>
        </td>
      </tr>

      {editingPolicy && (
        <PolicyEditor
          keyHash={k.keyHash}
          existing={k.policy}
          onSave={() => { setEditingPolicy(false); onRefetch(); }}
          onClose={() => setEditingPolicy(false)}
        />
      )}
    </>
  );
}

const PROVIDERS: { prefix: string; name: string; hint: string }[] = [
  { prefix: "sk-ant-", name: "Anthropic", hint: "sk-ant-…" },
  { prefix: "sk-", name: "OpenAI", hint: "sk-…" },
  { prefix: "AI", name: "Google Gemini", hint: "AI…" },
];

function detectProvider(key: string): typeof PROVIDERS[number] | null {
  return PROVIDERS.find((p) => key.startsWith(p.prefix)) ?? null;
}

function RegisterKeyModal({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const [apiKey, setApiKey] = useState("");
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ keyHash: string } | null>(null);

  const detected = detectProvider(apiKey.trim());
  const unrecognized = apiKey.trim().length > 3 && !detected;

  const handleRegister = async () => {
    if (!apiKey.trim()) { setError("API key is required"); return; }
    if (!detected) { setError("Unrecognized key format. Must start with sk-ant-, sk-, or AI."); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/keys/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim(), label: label.trim() || undefined }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json() as { keyHash: string };
      setDone(data);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to register key");
    } finally {
      setLoading(false);
    }
  };

  const inputCls = "w-full bg-void border border-border rounded px-2.5 py-1.5 text-xs font-mono text-text placeholder-muted focus:outline-none focus:border-guard/50 transition-colors";
  const labelCls = "text-[10px] font-mono uppercase tracking-widest text-ghost";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-start justify-center bg-void/80 backdrop-blur-sm">
      <div className="w-full sm:max-w-md sm:mt-16 rounded-t-2xl sm:rounded-xl border border-border bg-panel p-5 shadow-2xl fade-in max-h-[calc(100vh-3rem)] sm:max-h-[calc(100vh-5rem)] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="font-mono text-sm font-medium text-bright">Register API Key</h2>
            <p className="text-[10px] font-mono text-ghost mt-0.5">Hashed by proxy — raw key never stored</p>
          </div>
          <button onClick={onClose} className="text-ghost hover:text-dim text-xs font-mono p-1">✕</button>
        </div>

        {done ? (
          <div className="space-y-3">
            <p className="text-xs font-mono text-guard">Key registered successfully.</p>
            <div className="bg-surface rounded border border-border px-3 py-2">
              <p className="text-[9px] font-mono text-ghost mb-1 uppercase tracking-widest">Hash</p>
              <p className="text-[10px] font-mono text-text break-all">{done.keyHash}</p>
            </div>
            <p className="text-[10px] font-mono text-ghost">Policy can now be configured from the keys table. The key will also appear automatically after its first proxied request.</p>
            <button onClick={onClose} className="w-full py-2 rounded-lg bg-guard/15 border border-guard/30 text-guard text-xs font-mono hover:bg-guard/25 transition-colors">
              done
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className={labelCls}>API Key</label>
              <input
                className={`${inputCls} mt-1 ${unrecognized ? "border-rose/50" : detected ? "border-guard/40" : ""}`}
                placeholder="sk-… / sk-ant-… / AI…"
                type="password"
                value={apiKey}
                onChange={(e) => { setApiKey(e.target.value); setError(null); }}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
              />
              {/* Provider detection feedback */}
              <div className="mt-1.5 h-4">
                {detected && (
                  <p className="text-[10px] font-mono text-guard flex items-center gap-1">
                    <span>●</span> {detected.name} detected
                  </p>
                )}
                {unrecognized && (
                  <p className="text-[10px] font-mono text-rose flex items-center gap-1">
                    <span>●</span> unrecognized prefix
                  </p>
                )}
              </div>
              <p className="text-[9px] font-mono text-muted mt-0.5">Sent to proxy over localhost. The proxy hashes it with SHA-256 and discards the raw key immediately.</p>
            </div>

            {/* Provider selector — read-only display, auto-filled */}
            <div>
              <p className={`${labelCls} mb-1.5`}>Provider</p>
              <div className="grid grid-cols-3 gap-1.5">
                {PROVIDERS.map((p) => (
                  <div
                    key={p.prefix}
                    className={`px-2 py-1.5 rounded border text-center transition-colors ${
                      detected?.prefix === p.prefix
                        ? "border-guard/50 bg-guard/10 text-guard"
                        : "border-border bg-surface/50 text-ghost"
                    }`}
                  >
                    <p className="text-[10px] font-mono font-medium">{p.name}</p>
                    <p className="text-[9px] font-mono opacity-60 mt-0.5">{p.hint}</p>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label className={labelCls}>Label (optional)</label>
              <input
                className={`${inputCls} mt-1`}
                placeholder="e.g. production-bot"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>

            {error && <p className="text-xs font-mono text-rose">{error}</p>}
            <button
              onClick={() => void handleRegister()}
              disabled={loading || !detected}
              className="w-full py-2 rounded-lg bg-guard/15 border border-guard/30 text-guard text-xs font-mono hover:bg-guard/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? "registering…" : "register key"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Keys({ keys, status, onRefetch }: Props) {
  const [showRegister, setShowRegister] = useState(false);
  const allKeys = keys?.keys ?? [];
  const budget = status?.budget ?? { hourly: null, daily: null, monthly: null };

  return (
    <div className="fade-in space-y-4">
      {showRegister && (
        <RegisterKeyModal
          onDone={onRefetch}
          onClose={() => setShowRegister(false)}
        />
      )}
      <div className="flex items-center justify-between">
        <h2 className="text-[10px] font-mono uppercase tracking-[0.15em] text-ghost">
          API Keys — {allKeys.length} tracked
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowRegister(true)}
            className="text-[10px] font-mono text-guard hover:text-bright px-2 py-1 rounded border border-guard/30 hover:border-guard/60 transition-colors"
          >
            + register key
          </button>
          <button
            onClick={onRefetch}
            className="text-[10px] font-mono text-ghost hover:text-dim px-2 py-1 rounded border border-border hover:border-muted transition-colors"
          >
            ↻ refresh
          </button>
        </div>
      </div>

      {allKeys.length === 0 ? (
        <div className="rounded-lg border border-border bg-panel p-12 text-center">
          <p className="text-ghost font-mono text-xs">No keys tracked yet</p>
          <p className="text-[10px] font-mono text-muted mt-1">Keys appear here after their first request through the proxy</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-panel overflow-hidden">
          <table className="w-full">
            <thead className="hidden sm:table-header-group">
              <tr className="bg-surface">
                {["Status", "Key", "Daily Spend", "Hourly Rate", "Requests", "Actions"].map((h) => (
                  <th key={h} className={`py-2.5 px-3 text-[10px] font-mono uppercase tracking-widest text-ghost ${h !== "Status" && h !== "Key" ? "text-right" : ""}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {allKeys.map((k) => (
                <KeyRow key={k.keyHash} k={k} budget={budget} onRefetch={onRefetch} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Global budget summary */}
      <div className="rounded-lg border border-border bg-panel p-4">
        <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-ghost mb-3">Global Budget Defaults</p>
        <div className="grid grid-cols-3 gap-3">
          {[["Hourly", budget.hourly], ["Daily", budget.daily], ["Monthly", budget.monthly]].map(([label, cap]) => (
            <div key={label as string} className="text-center">
              <p className="text-[10px] font-mono text-ghost uppercase">{label as string}</p>
              <p className="text-sm font-mono text-dim mt-1">
                {cap ? `$${cap}` : <span className="text-muted">—</span>}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
