# Tasks: Startup and Chat Performance

## 1. Storage and Project Startup

- [x] 1.1 Add a persisted SQLite schema-version fast path and focused fresh/current database tests in `storage_service.rs`.
- [x] 1.2 Move startup storage commands off the Tauri command thread and make `ProjectSidebar` cache-first with active-project-priority session hydration.

## 2. Chat Loading and Rendering

- [x] 2.1 Remove non-critical reads from the chat critical path and load existing transcripts before provider catalog hydration.
- [x] 2.2 Coalesce content/reasoning stream updates per animation frame and implement explicit latest-message following.
- [x] 2.3 Expose latest per-session request usage and update the context indicator from loaded and completed requests.

## 3. Compact Chat Workbench

- [x] 3.1 Consolidate model, effort, textual permission mode, run state, branch, context, commands, and secondary actions in `ChatHeader`.
- [x] 3.2 Remove duplicate transcript/composer metadata, minimize the composer, and apply focus-within orange treatment using `globals.css` only.

## 4. Verification and Documentation

- [x] 4.1 Add focused startup/chat E2E coverage and Rust tests; run `npx tsc --noEmit`, `npm run build`, focused E2E, `cargo check`, and focused Rust tests.
- [x] 4.2 Visually verify the running compact chat at the minimum viewport and update `DESIGN.md`, `docs/agents/design-system.md`, `docs/agents/agent-runtime.md`, and `docs/agents/testing.md` where behavior changed.
- [x] 4.3 Run `node scripts/openspec-status.mjs --write` and reconcile the `openspec/ROADMAP.md` narrative before archiving the completed change.
