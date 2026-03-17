import { resolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

function checkBun(): boolean {
  const result = spawnSync("bun", ["--version"], { stdio: "pipe" });
  return result.status === 0;
}

export async function start(args: string[]): Promise<void> {
  const noDashboard = args.includes("--no-dashboard");

  if (!checkBun()) {
    console.error("ClawGuard requires Bun runtime. Install it at https://bun.sh");
    console.error("  curl -fsSL https://bun.sh/install | bash");
    process.exit(1);
  }

  const cliDir = dirname(fileURLToPath(import.meta.url));

  // Detect whether we're running from inside the monorepo (dev) or a packaged install.
  // Monorepo layout:  packages/cli/src/commands/ → up 3 levels → packages/ → proxy/src/index.ts
  // Packaged layout:  dist/commands/start.js     → up 1 level  → dist/     → proxy-runtime/index.js
  const monorepoProxyEntry = resolve(cliDir, "../../../proxy/src/index.ts");
  const monorepoDashboardPkg = resolve(cliDir, "../../../dashboard/package.json");
  const isMonorepo = existsSync(monorepoProxyEntry) && existsSync(monorepoDashboardPkg);

  const packagedProxyEntry = resolve(cliDir, "../proxy-runtime/index.js");
  const proxyEntry = isMonorepo ? monorepoProxyEntry : packagedProxyEntry;

  if (!existsSync(proxyEntry)) {
    console.error(`Cannot find proxy entry at: ${proxyEntry}`);
    console.error(isMonorepo
      ? "Make sure you are running from the clawguard repo root."
      : "This ClawGuard installation may be corrupted. Try reinstalling.");
    process.exit(1);
  }

  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) {
    console.warn("No .env found in current directory. Run: clawguard init");
  }

  console.log("🛡️  Starting ClawGuard proxy...");

  const proxy = spawn("bun", ["run", proxyEntry], {
    stdio: "inherit",
    env: process.env,
  });

  proxy.on("exit", (code) => {
    process.exit(code ?? 0);
  });

  if (!noDashboard) {
    if (isMonorepo) {
      // Dev mode: run Vite dev server from dashboard package source
      const dashboardDir = resolve(cliDir, "../../../dashboard");
      setTimeout(() => {
        console.log("🖥️  Starting dashboard dev server on http://localhost:4200 ...");
        const dashboard = spawn("bun", ["run", "dev"], {
          cwd: dashboardDir,
          stdio: "inherit",
          env: process.env,
        });
        dashboard.on("exit", () => { /* dashboard exit doesn't kill proxy */ });
        for (const sig of ["SIGINT", "SIGTERM"] as const) {
          process.on(sig, () => dashboard.kill(sig));
        }
      }, 500);
    } else {
      // Packaged mode: proxy serves the pre-built dashboard at /dashboard/
      console.log("🖥️  Dashboard: http://localhost:4100/dashboard");
    }
  }

  // Forward signals so Ctrl+C cleanly stops everything
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      proxy.kill(sig);
    });
  }
}
