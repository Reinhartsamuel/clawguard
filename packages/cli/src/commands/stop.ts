import { unlinkSync } from "node:fs";
import { PID_FILE, getRunningPid } from "./start.js";

export async function stop(_args: string[]): Promise<void> {
  const pid = getRunningPid();
  if (!pid) {
    console.log("ClawGuard is not running.");
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
    // Wait up to 3s for the process to exit
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 100));
      try {
        process.kill(pid, 0);
      } catch {
        break; // process is gone
      }
    }
    console.log(`🛑  ClawGuard stopped (pid ${pid})`);
  } catch (err) {
    console.error(`Failed to stop ClawGuard: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    try { unlinkSync(PID_FILE); } catch { /* already gone */ }
  }
}
