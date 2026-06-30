# Proposal: Basebuild Desktop Local Foundation

## Why

Basebuild needs a Windows-first desktop foundation that turns local OMP sessions, terminals, source control, and modular prompt/config workflows into a simple visual control plane. The first change should establish the local app architecture without coupling the desktop repo to basebuild.net login, cloud sync, or backend implementation work.

## What Changes

- Add a Tauri v2 desktop app foundation using a Rust core and a React/TypeScript/Vite/Tailwind webview UI.
- Add project opening, recent-project tracking, Git repository detection, OpenSpec detection, and `.basebuild/` project configuration support.
- Add OMP RPC process management by launching `omp --mode rpc` from the Rust core and streaming state/events into the UI.
- Add terminal panes backed by a Rust PTY service and rendered with xterm.js.
- Add a simple Source Control tab backed by the installed `git` CLI, including status, diffs, stage/unstage, discard, commit, and basic history.
- Add a modular Basebuild config/prompt-pack system with built-in official packs, user-created local packs, version metadata, manual updates, and no silent auto-update.
- Add a shared Updates & Requirements UI that surfaces missing dependencies, app update status, config-pack updates, and future skill/plugin update notices behind one badge count.
- Add update-ready release design for Tauri updater-compatible manifests and GitHub Actions/Cloudflare Worker/R2/D1 integration, while keeping one-click installation optional until signing and hosting are settled.

## Capabilities

### New Capabilities

- `desktop-shell`
- `project-workspaces`
- `omp-rpc-integration`
- `terminal-management`
- `source-control`
- `basebuild-config-packs`
- `updates-requirements`

### Modified Capabilities

None.

## Impact

- Creates the initial OpenSpec planning baseline for the `basebuild-app` desktop application.
- Introduces Tauri, Rust, React, TypeScript, Vite, Tailwind CSS, xterm.js, portable-pty, SQLite, TOML, and installed Git CLI as planned dependencies or runtime requirements.
- Establishes `~/.basebuild/` and `<project>/.basebuild/` as the standard local storage/config locations.
- Keeps basebuild.net login, cloud sync, D1 schema/API implementation, GitHub Issues/PR workflows, macOS signing/notarization, Windows Authenticode, and automatic updates out of scope for this change.
