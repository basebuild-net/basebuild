# Tasks: Native App Login MCP

## 1. Rust Auth Foundation

- [ ] 1.1 Add `src-tauri/src/models/auth.rs` with `AccountProfile`, `AccountStatus`, `DeviceFlow`, and `NativeSyncResult` serializable models.
- [ ] 1.2 Add `src-tauri/src/services/auth_service.rs` for website base URL resolution, device-flow start/poll, profile refresh, sign-out/revoke, token persistence, and native MCP sync.
- [ ] 1.3 Extend global storage so account metadata and last sync live under `~/.basebuild` and token material is isolated behind `AuthService`.
- [ ] 1.4 Add `src-tauri/src/commands/auth.rs` and register auth commands/modules in `src-tauri/src/lib.rs`, `src-tauri/src/commands/mod.rs`, and `src-tauri/src/models/mod.rs`.

## 2. Frontend Account State

- [ ] 2.1 Add `src/lib/auth.ts` typed Tauri wrappers for `authStatus`, `authStartDeviceFlow`, `authPollDeviceFlow`, `authRefreshProfile`, `authSignOut`, and `authSyncRawUsage`.
- [ ] 2.2 Add `src/state/account.ts` hook/provider for guest/authenticating/authenticated/error state, polling lifecycle, refresh, sync, and sign-out.
- [ ] 2.3 Wire the account provider at the app shell root so shell chrome, settings, and sync controls read one account state.

## 3. Desktop Account UI

- [ ] 3.1 Add a compact top-right account chip/avatar to the shell header using existing layout conventions and `title` tooltips.
- [ ] 3.2 Add an `Account` tab to `SettingsModal.tsx` with guest prompt, browser sign-in start, visible `userCode` during polling, connected profile, token expiry, Sync now, and Sign out.
- [ ] 3.3 Add any required reusable classes to `src/styles/globals.css` only, preserving 0px radius and documenting design-token intent in implementation comments where needed.
- [ ] 3.4 Ensure no website login/password/magic-link fields render inside the desktop app.

## 4. Native MCP Usage Sync

- [ ] 4.1 Implement `auth_sync_raw_usage` to collect `omp stats --json` and `omp usage --json` through existing OMP service behavior.
- [ ] 4.2 POST JSON-RPC `tools/call` for `sync_raw_usage` to the website `/api/mcp` endpoint with the native bearer token, never exposing the token to React.
- [ ] 4.3 Surface success timestamp, summary, warnings, and auth/OMP/network errors in Settings > Account.
- [ ] 4.4 On MCP unauthorized/profile unauthorized, delete local token material and transition to guest state.

## 5. Cross-Repo Verification

- [ ] 5.1 Run `npm run build` for desktop TypeScript/Vite validation.
- [ ] 5.2 Run `cargo check` in `src-tauri` for Rust command/service validation.
- [ ] 5.3 With the website running, manually smoke Sign in → browser approval → avatar appears in desktop → Sync now calls MCP without API key.
- [ ] 5.4 Revoke the connected desktop from website settings and verify desktop returns to guest/reauthorization state.
- [ ] 5.5 Capture desktop screenshots for guest chip, polling code state, logged-in avatar, and account sync result before yielding UI implementation.
