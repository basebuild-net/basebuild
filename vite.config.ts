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
  define: {
    // Compile-time flag so runtime code can tell "Playwright e2e against the
    // dev server" apart from a developer's own `npm run dev` session. False
    // in every non-e2e build.
    "import.meta.env.BASEBUILD_E2E": JSON.stringify(process.env.BASEBUILD_E2E === "1"),
  },
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
