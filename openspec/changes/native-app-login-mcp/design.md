# Design: Native App Login MCP

## Context

The desktop app is a Tauri v2 shell with Rust services/commands and React UI. Existing OMP commands already return `omp stats --json` and `omp usage --json`. Existing storage is a global SQLite DB at `~/.basebuild/state.db`; project data lives under project `.basebuild/`. The website plan in `C:/Users/user/Documents/repos/basebuild-dotnet/openspec/changes/native-app-login-mcp/` owns the device authorization endpoints, native token records, and MCP auth resolver.

The desktop repo must not implement website sessions or backend behavior. It should consume the website contract and keep local UX compact, dense, and reversible.

## Goals / Non-Goals

**Goals**:
- Guest-first app with optional but encouraged sign-in.
- Browser-only login/approval; no in-app login boxes.
- Top-right account chip showing guest, avatar, or initials.
- Built-in native MCP sync without requiring users to create API keys.
- Clear sign-out/revoke behavior and token invalidation handling.

**Non-Goals**:
- Implementing basebuild.net auth, sessions, database schema, or MCP server logic in this repo.
- Cloud-syncing plans/projects.
- Exposing generic user API key management in the desktop UI.
- Adding a new side column or major shell layout change.

## Decisions

**Decision**: Put account state in a dedicated React state hook and Rust auth service. - **Rationale**: The app already keeps Tauri wrappers in `src/lib/` and cross-component state in `src/state/`; account data will be needed by shell UI, settings, and sync. **Alternatives**: Keep state inside `SettingsModal`; rejected because top-right avatar and sync entry points also need it.

**Decision**: Use the existing `open` Rust dependency to launch `verificationUriComplete` in the system browser. - **Rationale**: `open` is already present in `src-tauri/Cargo.toml` and used by the panic hook; no new plugin is required just to open URLs. **Alternatives**: Add `tauri-plugin-opener`; acceptable later if packaging policy prefers plugins, but not necessary for the plan.

**Decision**: Store token metadata in `state.db` but keep token material isolated behind `AuthService`. - **Rationale**: Existing storage centralizes global app data; wrapping token access prevents accidental UI/log exposure. **Alternatives**: Store in localStorage; rejected because it is frontend-readable and easier to leak.

**Decision**: Implement native MCP sync in Rust service code, not direct browser fetch from React. - **Rationale**: Rust can keep Authorization headers and token material out of the webview and can combine OMP command results with network calls behind one command. **Alternatives**: React fetch with token in state; rejected due token exposure and duplicated error handling.

**Decision**: Account UI uses existing shell density and global CSS. - **Rationale**: `AGENTS.md` and `DESIGN.md` require pure black canvas, orange accent, 0px radius, centralized CSS, and tooltips on every interactive element.

## Command/API Sketch

Rust models:
- `AccountProfile`: `username`, `displayName`, `avatarUrl`, `isAdmin`, `isEditor`.
- `AccountStatus`: `state` (`guest|authenticating|authenticated|error`), `profile?`, `tokenPrefix?`, `expiresAt?`, `lastSyncAt?`, `message?`.
- `DeviceFlow`: `deviceCode`, `userCode`, `verificationUriComplete`, `expiresAt`, `intervalSeconds`.
- `NativeSyncResult`: `syncedAt`, `summary`, `warnings`, `rawResponse`.

Tauri commands:
- `auth_status() -> AccountStatus`
- `auth_start_device_flow() -> DeviceFlow`
- `auth_poll_device_flow(device_code: String) -> AccountStatus`
- `auth_refresh_profile() -> AccountStatus`
- `auth_sign_out() -> AccountStatus`
- `auth_sync_raw_usage() -> NativeSyncResult`

Frontend wrappers in `src/lib/auth.ts` mirror command names as camelCase.

## UI Placement

- Add account chip/avatar to the existing top shell/header area, not a new column.
- Guest chip label: `Guest` or `Sign in`; logged-in chip: avatar image or initials + username in tooltip.
- Settings modal adds an `Account` tab with Sign in, Sync now, Last sync, Connected as, Token expiry, and Sign out.
- During auth polling, show code + progress in the Account tab and keep the rest of the app usable.
- All interactive controls get `title` attributes.

## Risks / Trade-offs

- **Token leakage** → Mitigation: token never enters React state; Rust owns Authorization headers; UI shows only prefix/expiry.
- **Website/app contract drift** → Mitigation: keep endpoint shape in both OpenSpec changes; implement website first; add integration smoke.
- **Blocking network calls in Tauri commands** → Mitigation: current app uses blocking command style; keep calls short with timeouts, and move to async/spawn-blocking if UI jank appears in implementation.
- **No OS keychain yet** → Mitigation: choose keychain before public release if token persistence risk is unacceptable; native tokens remain scoped and revocable.
- **Visual clutter** → Mitigation: compact chip, account details behind settings, no new side panel.

## Migration Plan

1. Implement website endpoints and tests from the companion `basebuild-dotnet` plan.
2. Add desktop Rust auth models/service/commands and token storage.
3. Add frontend account state and shell/settings UI.
4. Add native MCP sync command using existing OMP JSON commands and website MCP endpoint.
5. Verify guest startup, browser sign-in, approve/deny/expiry, avatar rendering, sync success, auth failure, and revoke.

Rollback: hide the Account entry points and leave local OMP/terminal/plans untouched. No existing desktop data model is removed.

## Open Questions

- Should the first implementation add a keychain crate/plugin, or is scoped token storage in the global app DB acceptable for beta?
- What should the dev override be for website base URL (`BASEBUILD_SITE_URL`, settings field, or compile-time env)?
- Should native usage sync be manual-only initially or include a conservative background prompt after sign-in?
