import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const e2eAliases =
  process.env.BASEBUILD_E2E === "1"
    ? {
        "@tauri-apps/api/core": "/src/test-support/tauri-core.ts",
        "@tauri-apps/api/event": "/src/test-support/tauri-event.ts",
        "@tauri-apps/api/window": "/src/test-support/tauri-window.ts",
      }
    : {};

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  resolve: {
    alias: e2eAliases,
  },
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
