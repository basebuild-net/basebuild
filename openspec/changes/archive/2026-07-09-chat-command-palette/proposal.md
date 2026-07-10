# Proposal: Chat Command Palette

## Why

Slash commands already exist as a local command concept, but discovery is too hidden: users must know command names before they can use them. A visible command palette, keyboard completion, argument hints, and basic chat-management commands make command-driven chat usable without sending control text to the model provider.

## What Changes

- Expand slash command autocomplete so typing `/` opens a large, filterable list with command names, descriptions, source badges, usage text, and argument hints.
- Rank commands by recent local use first, then prefix/relevance, while still keeping every matching command reachable.
- Add keyboard behavior: ArrowUp/ArrowDown moves selection, Tab completes the selected command into the composer, Enter executes or accepts according to context, Escape closes the list.
- Add local chat commands:
  - `/clear` clears the current chat after an explicit confirmation when persisted messages would be deleted.
  - `/new` starts a fresh chat without deleting the current chat.
  - `/model [query]` opens or filters model selection and switches the active chat model.
  - `/provider [query]` opens or filters provider selection and switches the active chat provider/model fallback.
  - `/commands` and `/help` show the complete command reference locally.
  - `/stop` cancels the current running chat request when one is active.
- Preserve existing commands such as `/login`, `/models refresh`, `/plan`, `/idea`, `/openspec`, and `/skill:<name>`.
- Add a visible `Commands` composer button that opens the same palette and fills the selected command into the composer instead of executing it immediately.
- Show inline helper text while the user types commands, including required/optional arguments, examples, validation errors, and whether a command is local-only.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `slash-command-registry` — command metadata, ordering, autocomplete, keyboard completion, and argument helper behavior.
- `chat-slash-commands` — concrete built-in chat commands and their local execution semantics.
- `chat-composer-controls` — visible GUI entry point for the command palette.

## Impact

- Affected frontend: `src/components/panels/ChatPanel.tsx`, `src/components/panels/ChatComposerRail.tsx`, `src/styles/globals.css`, and any extracted command-palette helper/component created during implementation.
- Affected frontend wrappers: `src/lib/native-chat.ts` if chat clearing needs a thin Tauri command wrapper.
- Affected backend: `src-tauri/src/commands/native_chat.rs`, `src-tauri/src/services/native_chat_service.rs`, `src-tauri/src/models/native_chat.rs`, and `src-tauri/src/lib.rs` if persisted chat clearing requires a new command registration.
- Affected tests: frontend command palette behavior tests and Rust service tests for clearing persisted chat messages if backend deletion is added.
- Security/trust boundaries: command text remains local UI control input until explicitly sent; command reference and helpers must not leak credentials, environment variables, or provider tokens; destructive `/clear` behavior requires explicit confirmation for persisted deletion.
- Dependencies: no new runtime dependency is expected.
- Overlap: this builds on canonical `slash-command-registry`, `chat-slash-commands`, and `chat-composer-controls`; it should be applied after or rebased across in-flight composer rail changes from `chat-first-shell`, `openspec-chat-workbench`, and `project-grid-workspace`.
