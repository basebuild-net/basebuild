# Proposal: Harness Context Files

## Why

Native chat sessions start context-blind: no AGENTS.md, no project schematic, no skills awareness — the model knows nothing about the project's conventions unless the user pastes them. OMP (the parity bar) assembles a system prompt from discovered context files and skill metadata; Basebuild's native harness needs the same or agents will keep violating repo conventions the harness never showed them. This also makes plan runs (`plan-pipeline-harness`) meaningfully better: a run session inherits project rules automatically instead of relying only on plan text.

## What Changes

- Add deterministic system-prompt assembly for native chat sessions: base harness prompt + discovered context files + project schematic + skills metadata list, in fixed order with per-part token accounting.
- Add context-file discovery: `AGENTS.md` walked up from the project directory to the repo root (skipping dot-directories), `.basebuild/project-schematic.md`, and `CLAUDE.md` as fallback when no `AGENTS.md` exists at the same level; mtime-cached, refreshed on session create and manual refresh.
- Add skills metadata exposure: discovered skill names + descriptions listed in the system prompt so the model can request `read_skill` content on demand (bodies are never bulk-injected).
- Add per-project settings to toggle each context source and cap injected sizes; oversized files are head-truncated with explicit markers, feeding the `context-budget-guard` accounting from `native-agent-loop`.
- Add context visibility UI: a session inspector showing exactly which files/parts were injected, their token sizes, staleness, and a refresh action.
- **Depends on** `native-agent-loop` (context-budget-guard accounting, `run_agent_turn` seam). Plan-run sessions from `plan-pipeline-harness` layer plan context on top of this standing context.

## Capabilities

### New Capabilities

- `harness-system-prompt` — ordered, token-accounted system prompt assembly for native sessions.
- `context-file-discovery` — AGENTS.md/CLAUDE.md/schematic discovery with caching and settings toggles.
- `context-visibility` — per-session injected-context inspection and refresh UI.

### Modified Capabilities

- None. Checked `openspec/specs/`: `native-agent-harness` covers runtime profile, permissions, catalog, metrics, and turn execution — no system-prompt or context requirements exist there.

## Impact

- `src-tauri/src/services/`: new `context_service.rs` (discovery, cache, assembly); `native_chat_service.rs` (session-create injection point); `schematic_service.rs` reuse; `settings_service.rs` (source toggles, size caps).
- `src-tauri/src/commands/`: context inspection/refresh commands; `lib.rs` registration.
- `src/lib/context.ts` (thin wrappers), `src/components/panels/ChatPanel.tsx` (context inspector affordance), `SettingsModal.tsx` (source toggles), `src/styles/globals.css`.
- Docs: `docs/agents/agent-runtime.md` (context assembly order, toggles, caps).
