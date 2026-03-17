const DEFAULT_PORT = 4100;

export async function freeze(args: string[]): Promise<void> {
  const keyHash = args[0];
  if (!keyHash || keyHash === "--help") {
    console.log(`
clawguard freeze <keyHash> [--reason <reason>] [--unfreeze] [--port <port>]

Examples:
  clawguard freeze 2171aa6494357da9
  clawguard freeze 2171aa6494357da9 --reason "suspected leak"
  clawguard freeze 2171aa6494357da9 --unfreeze
`);
    process.exit(keyHash ? 0 : 1);
  }

  const unfreeze = args.includes("--unfreeze");
  const reasonIdx = args.indexOf("--reason");
  const reason = reasonIdx !== -1 ? (args[reasonIdx + 1] ?? "manual") : "manual";
  const portIdx = args.indexOf("--port");
  const port = portIdx !== -1
    ? parseInt(args[portIdx + 1] ?? String(DEFAULT_PORT))
    : Number(process.env["PORT"] ?? DEFAULT_PORT);

  const endpoint = unfreeze ? "unfreeze" : "freeze";
  const url = `http://localhost:${port}/api/${endpoint}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyHash, reason }),
    });
  } catch {
    console.error(`Cannot connect to ClawGuard on port ${port}. Run: clawguard start`);
    process.exit(1);
  }

  if (!res.ok) {
    const text = await res.text();
    console.error(`Error ${res.status}: ${text}`);
    process.exit(1);
  }

  const action = unfreeze ? "Unfrozen" : "Frozen";
  console.log(`${action}: ${keyHash}${unfreeze ? "" : `  (reason: ${reason})`}`);
  console.log(`Run 'clawguard status' to verify.`);
}
