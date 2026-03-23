#!/usr/bin/env node
import { createRequire } from "node:module";
import { init } from "./commands/init.js";
import { start } from "./commands/start.js";
import { stop } from "./commands/stop.js";
import { logs } from "./commands/logs.js";
import { status } from "./commands/status.js";
import { freeze } from "./commands/freeze.js";
import { _proxy } from "./commands/proxy.js";

const [, , command, ...args] = process.argv;

const commands: Record<string, (args: string[]) => Promise<void>> = {
  init,
  start,
  stop,
  logs,
  status,
  freeze,
  _proxy,
};

function getVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require("../package.json") as { version: string };
    return pkg.version;
  } catch {
    return "unknown";
  }
}

function printHelp(): void {
  console.log(`
clawguard — API spending firewall

USAGE
  clawguard <command> [options]

COMMANDS
  init      Generate a .env config file with budget and alert settings
  start     Start the ClawGuard proxy (runs in background)
  stop      Stop the running proxy
  logs      Show proxy logs (use -f to follow)
  status    Show current spend across all tracked keys
  freeze    Freeze a key (block all requests)

Run 'clawguard <command> --help' for command-specific help.
`);
}

if (!command || command === "--help" || command === "-h") {
  printHelp();
  process.exit(0);
}

if (command === "--version" || command === "-v") {
  console.log(`clawguard v${getVersion()}`);
  process.exit(0);
}

const fn = commands[command];
if (!fn) {
  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(1);
}

fn(args).catch((err: unknown) => {
  console.error("Error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
