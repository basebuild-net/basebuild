# Tasks: Basebuild Desktop Local Foundation

## 1. Setup

- [x] 1.1 Scaffold Tauri v2 app structure with `src/` frontend and `src-tauri/` Rust core.
- [x] 1.2 Configure React, TypeScript, Vite, Tailwind CSS, and dark-first CSS tokens.
- [x] 1.3 Add baseline Rust modules for app state, commands, events, services, and models.
- [x] 1.4 Add initial local storage paths for `~/.basebuild/` and `<project>/.basebuild/`.
- [x] 1.5 Add SQLite and TOML dependencies for runtime state and editable config files.

## 2. Desktop Shell and Projects

- [x] 2.1 Build the minimal dark app layout with activity navigation, main pane, and right panel.
- [x] 2.2 Add native folder picker command for opening projects.
- [x] 2.3 Implement recent-project persistence in local SQLite state.
- [x] 2.4 Detect Git repository, OpenSpec folder, and project `.basebuild/` folder on project open.
- [x] 2.5 Add command to create project `.basebuild/` with default config and ignored runtime subpaths.

## 3. Updates and Requirements

- [x] 3.1 Create requirement service for detecting Git, OMP CLI, and platform capabilities.
- [x] 3.2 Implement Git detection command with installed/missing/version states.
- [x] 3.3 Build the shared Updates & Requirements UI with badge count.
- [x] 3.4 Add Windows Git install actions for winget, Git for Windows URL, copy command, and re-check.
- [x] 3.5 Add update-card data model for app updates, config-pack updates, and future plugin/skill updates.

## 4. OMP RPC Integration

- [x] 4.1 Implement Rust `OmpRpcService` that spawns `omp --mode rpc` for the active project.
- [x] 4.2 Implement JSONL request/response correlation and event streaming.
- [x] 4.3 Add frontend OMP store for model, provider, session, task, and run state.
- [x] 4.4 Add UI panels for OMP availability, current model, provider/login status, session status, and context usage.
- [x] 4.5 Add prompt execution, abort, and streamed event rendering from OMP RPC.

## 5. Terminal Management

- [x] 5.1 Add `portable-pty` terminal service in Rust.
- [x] 5.2 Add xterm.js terminal component in the frontend.
- [x] 5.3 Start PowerShell by default for Windows terminal panes.
- [x] 5.4 Wire terminal input, output, resize, focus, and close behavior.
- [x] 5.5 Open terminal panes in the active project working directory.

## 6. Source Control

- [x] 6.1 Create `GitService` wrapper around installed Git CLI execution.
- [x] 6.2 Parse `git status --porcelain=v2 -z --branch` into structured status data.
- [x] 6.3 Build Source Control tab with branch summary and staged/unstaged file groups.
- [x] 6.4 Add file diff view for unstaged and staged changes.
- [x] 6.5 Add stage, unstage, and refresh actions.
- [x] 6.6 Add discard action with confirmation dialog.
- [x] 6.7 Add commit message input and commit action with actionable Git error output.
- [x] 6.8 Add simple recent commit history/list view from Git log.

## 7. Basebuild Config Packs

- [x] 7.1 Define Basebuild pack manifest schema using TOML metadata and Markdown prompt files.
- [x] 7.2 Add built-in official idea-generation config pack bundled with the app.
- [x] 7.3 Add config-pack discovery from built-in, global user, and project sources.
- [x] 7.4 Build Configs UI for selecting active idea-generation prompt/config pack.
- [x] 7.5 Add user-created local prompt/config pack creation flow.
- [x] 7.6 Add installed-pack version metadata and manual update state model.
- [x] 7.7 Add config-pack update cards to the shared Updates & Requirements UI.

## 8. Update-Ready Release Infrastructure

- [x] 8.1 Add app update-check service interface compatible with Tauri updater metadata.
- [x] 8.2 Add Cloudflare Worker/R2/D1-compatible release manifest model.
- [x] 8.3 Configure Tauri updater plugin behind manual update-check UI without requiring one-click install in v1.
- [x] 8.4 Add GitHub Actions draft workflow plan for Windows builds and future Cloudflare artifact upload.
- [x] 8.5 Document required future secrets for Tauri updater signing and Cloudflare upload.

## 9. Integration & Testing

- [x] 9.1 Verify Windows launch, project opening, and `.basebuild/` creation manually.
- [x] 9.2 Verify missing Git shows a requirement badge and install/re-check actions.
- [x] 9.3 Verify Source Control status/diff/stage/unstage/commit against a test Git repository.
- [x] 9.4 Verify OMP missing and OMP available states.
- [x] 9.5 Verify OMP RPC prompt execution against a local project when OMP is installed.
- [x] 9.6 Verify terminal input/output/resize with PowerShell on Windows.
- [x] 9.7 Verify built-in and user-created config packs can be selected for idea generation.

> Runtime manual verification (9.1–9.7) is blocked on this host by missing Visual Studio C++ build tools required to link the Rust backend. Frontend `vite build` and `tsc --noEmit` pass; detailed manual verification must run on a Windows machine with the build tools installed.

## 10. Polish

- [x] 10.1 Review UI for simplicity, dark theme consistency, and non-native-looking custom styling.
- [x] 10.2 Remove unused dependencies, placeholder UI, and dead code.
- [x] 10.3 Add minimal developer notes for running the Tauri app locally.
- [x] 10.4 Run the targeted frontend and Rust checks available for the scaffold.

> 10.4 result: `npm run build` and `npx tsc --noEmit` pass. `cargo check` is blocked by missing Visual Studio C++ build tools on this host; install them with `winget install Microsoft.VisualStudio.2022.BuildTools`.
