#!/usr/bin/env node
import { init } from "./commands/init.js";
import { start } from "./commands/start.js";
import { status } from "./commands/status.js";
import { freeze } from "./commands/freeze.js";
import { _proxy } from "./commands/proxy.js";

const [, , command, ...args] = process.argv;

const commands: Record<string, (args: string[]) => Promise<void>> = {
  init,
  start,
  status,
  freeze,
  _proxy,
};

function printHelp(): void {
  console.log(`
clawguard — API spending firewall

USAGE
  clawguard <command> [options]

COMMANDS
  init      Generate a .env config file with budget and alert settings
  start     Start the ClawGuard proxy
  status    Show current spend across all tracked keys
  freeze    Freeze a key (block all requests)

Run 'clawguard <command> --help' for command-specific help.
`);
}

if (!command || command === "--help" || command === "-h") {
  printHelp();
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
