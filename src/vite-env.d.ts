/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Compile-time e2e flag injected by vite.config.ts `define` (Playwright runs only). */
  readonly BASEBUILD_E2E: boolean;
}
