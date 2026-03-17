import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4200,
    historyApiFallback: true,
    proxy: {
      "/api": "http://localhost:4100",
      "/cg-ws": { target: "ws://localhost:4100", ws: true, rewrite: (path) => path.replace(/^\/cg-ws/, "/ws") },
    },
  },
  build: {
    // Output to proxy package so it can be served as static files in packaged installs.
    // The proxy checks for this directory at startup and serves it at /dashboard/*.
    // In dev mode, Vite's own dev server handles the dashboard instead.
    outDir: "../proxy/dist/dashboard",
    emptyOutDir: true,
  },
});
