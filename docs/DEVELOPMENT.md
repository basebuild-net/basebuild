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

## Releases

Releases are manual and draft-first. There is no automatic release on push or
tag creation.

1. Bump the version in `package.json`, `src-tauri/tauri.conf.json`, and
   `src-tauri/Cargo.toml` in a dedicated `chore(release): bump version to X.Y.Z`
   commit on `main`.
2. Trigger the **CI / Release (Windows)** workflow via `workflow_dispatch`,
   passing the version (e.g. `0.0.3`).
3. The workflow builds the installer and creates a **GitHub draft release**. It
   aborts if the target version is already published.
4. Review the draft in the GitHub UI, write release notes, and click **Publish**.

Never re-release a published version. If a release is broken, ship a hotfix as
the next version. See `AGENTS.md` "Release Discipline" for the full policy.

## Feature backlog pointer

OpenSpec plan lives in `openspec/changes/basebuild-desktop-local-foundation/`.
