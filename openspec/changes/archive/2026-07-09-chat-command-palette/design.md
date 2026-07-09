# Design: Chat Command Palette

## Context

Basebuild is a local-first desktop control plane built with Tauri v2, React/TypeScript, SQLite local state, and OMP integration. The current canonical specs already define slash command discovery, slash command execution, and compact composer controls, but the visible UI is still basic: users need to know commands up front, command arguments are not discoverable while typing, and pointer users do not have a direct command entry point.

Existing constraints:

- Frontend styling stays in `src/styles/globals.css`; no CSS modules or inline styles.
- Interactive elements need `title=` tooltips.
- Local UI commands must not be sent to the selected model provider.
- `src/lib/*.ts` files remain thin Tauri invoke wrappers.
- Commands must not expose credentials, provider tokens, environment variables, or command body secrets in palette metadata.
- In-flight composer work exists in `chat-first-shell`, `openspec-chat-workbench`, and `project-grid-workspace`; implementation should isolate command behavior from rail layout to reduce rebasing conflicts.

## Goals / Non-Goals

**Goals**:

- Provide an obvious command palette when the user types `/` or clicks `Commands`.
- Make commands discoverable through descriptions, source badges, usage strings, examples, and inline argument helpers.
- Support keyboard navigation and completion: ArrowUp/ArrowDown, Tab, Enter, Escape.
- Add basic local chat commands for clearing, new chat, model switching, provider switching, command reference/help, and cancellation.
- Keep command execution local and explicit; never silently forward recognized local commands to model providers.
- Preserve existing provider/model controls and route `/model` and `/provider` through the same selection state used by visible controls.

**Non-Goals**:

- No new command scripting language.
- No remote command catalog.
- No continuous filesystem watcher for file-based commands.
- No new frontend UI dependency or command-palette library.
- No changes to external provider APIs.
- No destructive chat deletion without explicit user confirmation.

## Decisions

**Decision**: Implement a normalized frontend command registry for palette rendering, backed by existing discovered commands and built-in command definitions. — **Rationale**: The palette needs names, descriptions, usage, argument metadata, source badges, and execution behavior in one shape. A frontend-normalized view keeps rendering and keyboard behavior independent of backend command providers. — **Alternatives**: Put all palette metadata behind a new Tauri service; this adds backend surface area before file/MCP command execution needs it.

**Decision**: Extract command UI into a focused component/helper under `src/components/panels/` or a small adjacent helper, then wire it into `ChatPanel.tsx` and `ChatComposerRail.tsx`. — **Rationale**: `ChatPanel.tsx` is large; isolating filtering, ranking, active option state, and argument helper rendering keeps the implementation testable and reduces layout conflicts with in-flight composer rail work. — **Alternatives**: Inline the palette in `ChatPanel.tsx`; faster initially, but harder to test and maintain.

**Decision**: Store command recency as non-secret local UI preference data, capped to a small list and keyed by command name. — **Rationale**: Recent-command ranking does not affect authoritative chat state, contains no secrets, and only changes list ordering. Existing UI preferences already use local browser storage for non-sensitive state. — **Alternatives**: Persist recency in SQLite; more consistent with durable app state, but requires extra Tauri commands for a low-risk preference.

**Decision**: Make the `Commands` button fill the composer draft instead of executing immediately. — **Rationale**: Pointer selection should match Tab completion and allows the user to inspect or edit arguments before any local state changes. — **Alternatives**: Execute on click; this is faster for known commands but unsafe for `/clear` and confusing for commands that need arguments.

**Decision**: `/clear` requires confirmation when persisted messages would be deleted. — **Rationale**: Clearing chat history is destructive. The slash command is an explicit user action, but a typed command can still be accidental; confirmation preserves local-first safety. — **Alternatives**: Treat `/clear` as view-only clearing; that would not meet the user's request to clear chat. Delete immediately; too risky.

**Decision**: `/model` and `/provider` reuse the existing catalog and picker logic rather than creating separate command-specific selection code. — **Rationale**: Visible controls and slash commands must preserve the same provider/model/effort invariants and session default persistence. — **Alternatives**: Implement custom inline pickers; likely to drift from current provider/model behavior.

**Decision**: `/commands` and `/help` render a local command reference message/panel, not a provider prompt. — **Rationale**: Help must be available even offline and must not leak local command metadata to providers. — **Alternatives**: Send help requests to the model; violates local control semantics and can expose installed command names.

## Risks / Trade-offs

- **Risk**: `ChatPanel.tsx` is already large, increasing regression risk. → Mitigation: Extract pure filtering/ranking helpers and cover them with focused tests; keep wiring thin.
- **Risk**: In-flight composer rail changes may conflict with button placement. → Mitigation: Implement the button as a composable rail action with stable props and stylesheet classes, not as a layout rewrite.
- **Risk**: Recent-command ranking could hide less-used commands. → Mitigation: Show a large list, preserve filtering, and keep `/commands` as the complete reference.
- **Risk**: File-based command metadata may include unsafe or overly large content. → Mitigation: Display frontmatter and placeholder-derived metadata only; never evaluate or expand command bodies for palette help.
- **Risk**: `/clear` may delete data the user expected to keep. → Mitigation: Require confirmation for persisted messages and report the result inline.
- **Risk**: `/provider` can select a provider whose selected model is incompatible. → Mitigation: Reuse existing catalog fallback resolution and show setup state before switching.

## Migration Plan

1. Add command metadata types and pure helpers for filtering, ranking, usage formatting, and argument-helper derivation.
2. Add the command palette UI and styles in `src/styles/globals.css`.
3. Wire slash-triggered opening, keyboard handling, and helper text into the composer.
4. Add the `Commands` button entry point using the same palette state.
5. Implement built-in command handlers for `/clear`, `/new`, `/model`, `/provider`, `/commands`, `/help`, and `/stop`, reusing existing picker/cancel/session behavior where possible.
6. Add a backend clear command only if current native chat APIs cannot delete persisted messages safely.
7. Add focused tests for helper logic and UI behavior; add Rust tests if a backend clear command is introduced.
8. Refresh `openspec/ROADMAP.md` after implementation tasks complete.

Rollback strategy: the feature is isolated to composer command handling. Reverting the command palette component/wiring and any optional backend clear command restores current slash-command behavior without migration.

## Open Questions

- Should command recency be global across projects or scoped per project path? Default implementation should use global recency because commands are app-level actions; project scoping can be added if usage data shows it matters.
- Should `/clear` delete the chat session record or only messages inside the current session? Default implementation should preserve the session and provider/model/effort selection, deleting only messages/tool events tied to that chat.
- Should `/help <command>` show command-specific help? This can be included if cheap while implementing `/help`, but the required baseline is complete command reference plus keyboard guide.
