# Proposal: Native App Login MCP

## Why

Basebuild Desktop should be useful without an account, but logged-in users should get first-party MCP sync with basebuild.net without manually creating or pasting API keys. The app already can read local OMP usage through Tauri commands; it needs a native account connection that opens the browser for approval, returns a user profile/avatar, and uses a scoped website-issued native token behind the scenes.

## What Changes

- Add optional account connection to the desktop shell: guest state by default, encouraged Sign in, logged-in avatar at the top right, and Settings > Account controls.
- Start website device authorization by calling `basebuild-dotnet` `/api/auth/device/start`, open the system browser to `verificationUriComplete`, show the short code/progress in-app, and poll until Allow/Deny/expiry.
- Store native app account metadata locally and persist the website-issued native token securely enough for beta; never ask the user for an API key and never render website login boxes inside the app.
- Add native MCP usage sync that collects `omp stats --json` and `omp usage --json` via existing commands, then calls website `/api/mcp` `sync_raw_usage` with the native token.
- Keep all website/backend behavior in `C:/Users/user/Documents/repos/basebuild-dotnet/openspec/changes/native-app-login-mcp/`; this repo only implements desktop UI, local storage, Tauri commands, and native calls.

## Capabilities

### New Capabilities
- `desktop-account-connection`: browser-based sign-in, local account state, top-right avatar/guest UI, and sign-out.
- `native-mcp-sync`: first-party MCP usage sync from desktop using a website native token, not a user-managed API key.

### Modified Capabilities
- (none canonical; this repo has no archived OpenSpec specs yet.)

## Impact

- **Rust services/commands:** add `src-tauri/src/services/auth_service.rs`, `src-tauri/src/commands/auth.rs`, `src-tauri/src/models/auth.rs`; register modules and Tauri commands in `src-tauri/src/lib.rs`.
- **Local storage:** extend `StorageService` with account metadata/token persistence or add a dedicated auth storage helper under `~/.basebuild`; token storage must be isolated from project `.basebuild/` data.
- **Frontend lib/state:** add `src/lib/auth.ts` and `src/state/account.ts` for typed command wrappers and cross-component account state.
- **UI:** add account chip/avatar to the shell top-right and Settings > Account; use only `src/styles/globals.css`, 0px radius, black/white/orange tokens, and `title` on every interactive element.
- **MCP/OMP:** use existing `ompStats()` and `ompUsage()` outputs; send a JSON-RPC `tools/call` request for `sync_raw_usage` to the website MCP endpoint with `Authorization: Bearer <native token>`.
- **Tests/verification:** targeted TypeScript build, Rust check, and manual smoke through website approval, avatar state, native sync, and revoke.
