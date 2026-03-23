import { existsSync, createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { watch } from "node:fs";
import { LOG_FILE } from "./start.js";

const TAIL_LINES = 50;

export async function logs(args: string[]): Promise<void> {
  const follow = args.includes("-f") || args.includes("--follow");

  if (!existsSync(LOG_FILE)) {
    console.log("No log file found. Start ClawGuard first: clawguard start");
    return;
  }

  // Print last N lines
  const lines: string[] = [];
  await new Promise<void>((resolve) => {
    const rl = createInterface({ input: createReadStream(LOG_FILE) });
    rl.on("line", (line) => {
      lines.push(line);
      if (lines.length > TAIL_LINES) lines.shift();
    });
    rl.on("close", resolve);
  });
  console.log(lines.join("\n"));

  if (!follow) return;

  // Follow mode: watch for new content
  let fileSize = 0;
  try { fileSize = (await import("node:fs")).statSync(LOG_FILE).size; } catch { /* ignore */ }

  const { createReadStream: crs } = await import("node:fs");
  watch(LOG_FILE, () => {
    try {
      const stat = (require("node:fs") as typeof import("node:fs")).statSync(LOG_FILE);
      if (stat.size <= fileSize) return;
      const stream = crs(LOG_FILE, { start: fileSize, end: stat.size });
      stream.on("data", (chunk) => process.stdout.write(chunk as Buffer));
      stream.on("end", () => { fileSize = stat.size; });
    } catch { /* ignore */ }
  });

  process.on("SIGINT", () => process.exit(0));
  // Keep alive
  await new Promise<void>(() => {});
}
