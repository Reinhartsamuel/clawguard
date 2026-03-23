import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/commands/init.ts", "src/commands/start.ts", "src/commands/stop.ts", "src/commands/logs.ts", "src/commands/status.ts", "src/commands/freeze.ts", "src/commands/proxy.ts"],
  format: "esm",
  target: "esnext",
  outDir: "dist",
  splitting: false,
  external: ["bun:sqlite", "bun"],
  banner: {
    js: "#!/usr/bin/env node",
  },
});
