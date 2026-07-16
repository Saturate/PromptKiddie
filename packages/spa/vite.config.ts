import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:3200",
      "/ws": {
        target: "http://localhost:3200",
        ws: true,
      },
      "/engagements": "http://localhost:3200",
      "/targets": "http://localhost:3200",
      "/findings": "http://localhost:3200",
      "/services": "http://localhost:3200",
      "/playbooks": "http://localhost:3200",
      "/knowledge": "http://localhost:3200",
      "/messages": "http://localhost:3200",
      "/agents": "http://localhost:3200",
      "/objectives": "http://localhost:3200",
      "/ports": "http://localhost:3200",
    },
  },
});
