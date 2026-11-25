import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const proxy = { "/api": { target: "http://127.0.0.1:3000" } };
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: "0.0.0.0", port: 3000, allowedHosts: true, proxy },
  preview: { host: "0.0.0.0", port: 3000, proxy },
  test: { environment: "jsdom", setupFiles: "./src/test-setup.ts" },
});
