import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const proxy = { "/api": { target: "http://127.0.0.1:8000" } };
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true, proxy },
  preview: { port: 4173, strictPort: true, proxy },
  test: { environment: "jsdom", setupFiles: "./src/test-setup.ts" },
});
