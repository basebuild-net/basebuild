# Proposal: Startup and Chat Performance

## Why

Basebuild currently delays project and chat readiness behind repeated SQLite schema probes and non-critical chat metadata calls, while high-frequency stream updates can make the renderer feel frozen. The chat composer also duplicates model, context, metrics, and environment controls across the header and footer, fails to keep the newest response in view reliably, and displays context usage as unknown even when request and model data are available.

## What Changes

- Add a versioned SQLite schema fast path so normal launches do not repeat the full migration/probe sequence.
- Keep first-run schema preparation safe while moving blocking startup storage work off the Tauri command thread.
- Make project discovery cache-first and defer non-active project session hydration until after the shell becomes interactive.
- Remove non-critical metrics and permission reads from the chat's critical loading path; load existing transcripts without waiting for provider catalog setup.
- Coalesce streamed response updates to animation frames and make transcript following explicit and reliable.
- Consolidate model, effort, permission, branch, run state, and context usage into one compact chat header.
- Reduce the composer footer to the focused text-entry and send/stop controls, with secondary actions in the header menu.
- Replace unknown context usage with the latest session request usage against the selected model's context window.

## Capabilities

### New Capabilities

- `startup-loading-performance` — fast-path storage initialization, responsive project discovery, and non-blocking warm-up.
- `compact-chat-workbench` — responsive transcript loading/streaming, reliable latest-message following, and a compact non-duplicative control surface.

### Modified Capabilities

- None.

## Impact

- `src-tauri/src/services/storage_service.rs`, project/native-chat commands, and focused Rust tests.
- `src/components/layout/ProjectSidebar.tsx` project-list hydration.
- `src/components/panels/ChatPanel.tsx`, `ChatHeader.tsx`, and `src/styles/globals.css`.
- Chat and startup E2E coverage plus the design/runtime/testing documentation that describes the resulting behavior.
- No new dependency, network upload, credential handling, or permission weakening.
