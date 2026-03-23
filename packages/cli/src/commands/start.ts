import { resolve, dirname } from "node:path";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { homedir } from "node:os";

export const CLAWGUARD_DIR = resolve(homedir(), ".clawguard");
export const PID_FILE = resolve(CLAWGUARD_DIR, "clawguard.pid");
export const LOG_FILE = resolve(CLAWGUARD_DIR, "clawguard.log");

function checkBun(): boolean {
  const result = spawnSync("bun", ["--version"], { stdio: "pipe" });
  return result.status === 0;
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function getRunningPid(): number | null {
  if (!existsSync(PID_FILE)) return null;
  try {
    const pid = parseInt(readFileSync(PID_FILE, "utf8").trim(), 10);
    if (isNaN(pid)) return null;
    return isRunning(pid) ? pid : null;
  } catch {
    return null;
  }
}

export async function start(args: string[]): Promise<void> {
  const noDashboard = args.includes("--no-dashboard");

  const existingPid = getRunningPid();
  if (existingPid) {
    console.log(`ClawGuard is already running (pid ${existingPid})`);
    console.log(`  Dashboard: http://localhost:4100/dashboard`);
    console.log(`  Logs:      clawguard logs`);
    console.log(`  Stop:      clawguard stop`);
    return;
  }

  mkdirSync(CLAWGUARD_DIR, { recursive: true });

  // Detect compiled single-binary mode:
  // - import.meta.url starts with /$bunfs/ (bun compiled binary virtual fs)
  // - OR process.execPath does not contain "bun" (i.e. the binary IS clawguard, not bun)
  const isBinary = import.meta.url.startsWith("/$bunfs/") || !process.execPath.includes("bun");

  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) {
    console.warn("No .env found in current directory. Run: clawguard init");
  }

  if (isBinary) {
    const logFd = require("node:fs").openSync(LOG_FILE, "a");
    const proxy = spawn(process.execPath, ["_proxy"], {
      stdio: ["ignore", logFd, logFd],
      detached: true,
      env: process.env,
    });
    proxy.unref();
    writeFileSync(PID_FILE, String(proxy.pid));
    console.log(`🛡️  ClawGuard started (pid ${proxy.pid})`);
    if (!noDashboard) console.log(`🖥️  Dashboard: http://localhost:4100/dashboard`);
    console.log(`📋  Logs:      clawguard logs`);
    console.log(`🛑  Stop:      clawguard stop`);
    return;
  }

  if (!checkBun()) {
    console.error("ClawGuard requires Bun runtime. Install it at https://bun.sh");
    console.error("  curl -fsSL https://bun.sh/install | bash");
    process.exit(1);
  }

  const cliDir = dirname(fileURLToPath(import.meta.url));

  // Detect whether we're running from inside the monorepo (dev) or a packaged install.
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

  if (isMonorepo) {
    // Dev mode: run in foreground so Vite + proxy output is visible
    console.log("🛡️  Starting ClawGuard proxy (dev mode)...");
    const proxy = spawn("bun", ["run", proxyEntry], { stdio: "inherit", env: process.env });
    proxy.on("exit", (code) => { process.exit(code ?? 0); });

    if (!noDashboard) {
      const dashboardDir = resolve(cliDir, "../../../dashboard");
      setTimeout(() => {
        console.log("🖥️  Starting dashboard dev server on http://localhost:4200 ...");
        const dashboard = spawn("bun", ["run", "dev"], {
          cwd: dashboardDir,
          stdio: "inherit",
          env: process.env,
        });
        dashboard.on("exit", () => { /* dashboard exit doesn't kill proxy */ });
        for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => dashboard.kill(sig));
      }, 500);
    }

    for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => proxy.kill(sig));
    return;
  }

  // Packaged npm install: daemonize
  const logFd = require("node:fs").openSync(LOG_FILE, "a");
  const proxy = spawn("bun", ["run", proxyEntry], {
    stdio: ["ignore", logFd, logFd],
    detached: true,
    env: process.env,
  });
  proxy.unref();
  writeFileSync(PID_FILE, String(proxy.pid));
  console.log(`🛡️  ClawGuard started (pid ${proxy.pid})`);
  if (!noDashboard) console.log(`🖥️  Dashboard: http://localhost:4100/dashboard`);
  console.log(`📋  Logs:      clawguard logs`);
  console.log(`🛑  Stop:      clawguard stop`);
}
