const DEFAULT_PORT = 4100;

/** Format a dollar amount with enough precision to be meaningful */
function fmt(n: number): string {
  if (n >= 1) return n.toFixed(2);
  if (n >= 0.01) return n.toFixed(4);
  return n.toFixed(6);
}

export async function status(args: string[]): Promise<void> {
  const port = args.includes("--port")
    ? parseInt(args[args.indexOf("--port") + 1] ?? String(DEFAULT_PORT))
    : Number(process.env["PORT"] ?? DEFAULT_PORT);

  const url = `http://localhost:${port}/api/status`;

  let data: StatusResponse;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`Proxy returned ${res.status}. Is ClawGuard running on port ${port}?`);
      process.exit(1);
    }
    data = (await res.json()) as StatusResponse;
  } catch {
    console.error(`Cannot connect to ClawGuard on port ${port}. Run: clawguard start`);
    process.exit(1);
  }

  console.log(`\nClawGuard Status — ${data.timestamp}`);
  console.log(`─────────────────────────────────────────`);

  if (data.budget.daily || data.budget.hourly || data.budget.monthly) {
    console.log(`\nBudget caps:`);
    if (data.budget.hourly) console.log(`  hourly:  $${fmt(data.budget.hourly)}`);
    if (data.budget.daily) console.log(`  daily:   $${fmt(data.budget.daily)}`);
    if (data.budget.monthly) console.log(`  monthly: $${fmt(data.budget.monthly)}`);
  } else {
    console.log(`\nBudget caps: none`);
  }

  if (data.keys.length === 0) {
    console.log(`\nNo spend recorded yet.\n`);
    return;
  }

  console.log(`\nKeys (${data.keys.length}):\n`);
  for (const key of data.keys) {
    const frozenTag = key.frozen ? " [FROZEN]" : "";
    console.log(`  ${key.keyHash}${frozenTag}`);
    for (const [window, s] of Object.entries(key.spend)) {
      const cap = data.budget[window as keyof typeof data.budget];
      const pct = cap ? ` (${((s.cost / cap) * 100).toFixed(1)}% of $${fmt(cap)})` : "";
      console.log(`    ${window.padEnd(8)} $${s.cost.toFixed(6)}${pct}  ${s.requests} req`);
    }
  }

  if (data.frozen.length > 0) {
    console.log(`\nFrozen keys:`);
    for (const f of data.frozen) {
      console.log(`  ${f.keyHash}  reason: ${f.reason}  since: ${new Date(f.frozenAt).toISOString()}`);
    }
  }

  console.log();
}

interface StatusResponse {
  timestamp: string;
  budget: { hourly: number | null; daily: number | null; monthly: number | null };
  keys: Array<{
    keyHash: string;
    frozen: boolean;
    spend: Record<string, { cost: number; requests: number }>;
  }>;
  frozen: Array<{ keyHash: string; frozenAt: number; reason: string }>;
}
