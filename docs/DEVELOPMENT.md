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
npm run tauri dev
```

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Vite frontend only |
| `npm run tauri dev` | Tauri dev mode |
| `npm run build` | Production frontend build |
| `npm run tauri build` | Build Windows installer |

## Architecture

- `src/components/layout/*` — shell components (sidebar, workspace, tool tabs, plan panel).
- `src/components/panels/*` — feature panels (Terminal, Source, Debug).
- `src/lib/*` — thin Tauri invoke helpers for each backend service.
- `src/state/*` — React state hooks.
- `src-tauri/src/commands/*` — Tauri command surface.
- `src-tauri/src/services/*` — business logic and external CLI integration.
- `src-tauri/src/models/*` — serializable data types.

## Requirements

The app detects Git and OMP CLI. If Git is missing, the UI provides a copyable `winget` command and a download link.

## Known environment constraints

### Windows build tools

Building the Tauri backend on Windows requires the **MSVC C++ build tools** (part of Visual Studio Build Tools). If `cargo check` fails with `link.exe` errors, install the workload:

```powershell
winget install Microsoft.VisualStudio.2022.BuildTools --override "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

### Tauri updater signing

Before publishing updates, replace `PLACEHOLDER_PUBLIC_KEY` in `src-tauri/tauri.conf.json` with the public key from `npx @tauri-apps/cli signer generate`.

See `docs/SECRETS.md` for the full secrets checklist.

## Feature backlog pointer

OpenSpec plan lives in `openspec/changes/basebuild-desktop-local-foundation/`.
