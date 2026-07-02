# Basebuild Desktop Development Notes

## Stack

- Frontend: React + TypeScript + Vite
- Backend: Rust + Tauri v2
- Terminal: portable-pty + xterm.js
- State: local SQLite (via rusqlite)

## Quick start

```bash
# Install frontend dependencies
npm install

# Run the dev server and Tauri (requires Rust + Visual Studio C++ tools)
dev.bat                 # Windows helper; detects port 1420 conflicts and keeps errors visible
npm run tauri dev       # Direct command

```

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Vite frontend only on port 1420 |
| `npm run tauri dev` | Tauri dev mode |
| `dev.bat` | Windows launcher that checks port 1420, can stop stale listeners, and pauses on errors |
| `npm run build` | Production frontend build |
| `npm run tauri build` | Build Windows installer |

## Architecture

- `src/components/layout/*` - shell components (sidebar, workspace, tool tabs, plan panel).
- `src/components/panels/*` - feature panels (Terminal, Source, Debug).
- `src/lib/*` - thin Tauri invoke helpers for each backend service.
- `src/state/*` - React state hooks.
- `src-tauri/src/commands/*` - Tauri command surface.
- `src-tauri/src/services/*` - business logic and external CLI integration.
- `src-tauri/src/models/*` - serializable data types.
- `src-tauri/src/services/settings_service.rs` - runtime profiles, defaults, permissions, audit trail.
- `src-tauri/src/services/analytics_service.rs` - opt-in usage analytics (disabled by default).

## Requirements

The app detects Git and OMP CLI. If Git is missing, the UI provides a copyable `winget` command and a download link.
Runtime profiles (OMP, terminal, future Basebuild CLI) are seeded on first launch and persisted in SQLite. Defaults and permissions are conservative: analytics off, auto-send off, ask before sensitive actions.

### Port 1420 conflicts

Tauri dev mode runs Vite on port 1420. If that port is already in use,
`dev.bat` detects the listener before startup, shows the owning PID/process,
and asks whether to stop it before continuing. It also pauses after failures so
the red error remains visible for copying.

## Known environment constraints

### Windows build tools

Building the Tauri backend on Windows requires the **MSVC C++ build tools** (part of Visual Studio Build Tools). If `cargo check` fails with `link.exe` errors, install the workload:

```powershell
winget install Microsoft.VisualStudio.2022.BuildTools --override "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

### Tauri updater signing

Before publishing updates, replace `PLACEHOLDER_PUBLIC_KEY` in `src-tauri/tauri.conf.json` with the public key from `npx @tauri-apps/cli signer generate`.

See `docs/SECRETS.md` for the full secrets checklist.
## Privacy and analytics

Basebuild is local-first. Usage analytics collection and upload are disabled by default and require explicit opt-in. See `docs/agents/agent-runtime.md` for the full privacy model. No analytics events store prompt text, chat content, source code, terminal output, secrets, or raw absolute paths. If a remote upload endpoint is ever added, it MUST be documented here and in `docs/SECRETS.md` before the upload code path is enabled.

## Releases

Releases are draft-first and single-source. The `workflow_dispatch` version
input is the source of truth — the workflow bumps all version files
(`package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`,
`src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`) itself, so there is no manual
pre-bump commit and no version drift between files.

1. Ensure `src-tauri/tauri.conf.json` `bundle.createUpdaterArtifacts` is `true`.
   Without it the workflow will not upload `latest.json` or `.sig` updater
   assets and in-app updates will fail.
2. Trigger the **CI / Release (Windows)** workflow via `workflow_dispatch`,
   passing the version (e.g. `0.0.7`). The workflow bumps all version files to
   match the input and verifies the bump succeeded before building.
3. The workflow builds the installer and creates a **GitHub draft release**.
   It aborts if the target version is already published, and validates that
   `latest.json` contains the correct version, Windows platform entry, URL,
   and signature.
4. Review the draft in the GitHub UI, write release notes, and click **Publish**.
   After publishing, verify the in-app update check no longer reports a remote
   JSON failure — the updater endpoint should serve the new `latest.json`.

Never re-release a published version. If a release is broken, ship a hotfix as
the next version (e.g. `0.0.7` after a broken `0.0.6`). See `AGENTS.md`
"Release Discipline" for the full policy.

## Feature backlog pointer

OpenSpec plan lives in `openspec/changes/basebuild-desktop-local-foundation/`.
