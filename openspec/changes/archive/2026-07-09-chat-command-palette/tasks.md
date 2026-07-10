# Tasks: Chat Command Palette

## 1. Command Metadata & Helpers

- [x] 1.1 Add normalized command metadata types for name, description, usage, arguments, examples, source, local-only behavior, and recency.
- [x] 1.2 Define built-in metadata for `/login`, `/model`, `/provider`, `/models refresh`, `/clear`, `/new`, `/commands`, `/help`, `/stop`, `/mcp`, `/plan`, `/idea`, `/openspec`, and `/skill:<name>`.
- [x] 1.3 Add pure filtering and ranking helpers for recent-first ordering, exact/prefix/substring relevance, and source priority preservation.
- [x] 1.4 Add pure argument-helper formatting for required arguments, optional arguments, examples, validation messages, and local-only/provider-send labels.

## 2. Palette UI

- [x] 2.1 Add a command palette component near `src/components/panels/ChatPanel.tsx` that renders a large list of commands with names, descriptions, source badges, usage text, and active-option state.
- [x] 2.2 Add keyboard handling for ArrowUp, ArrowDown, Tab, Enter, and Escape without breaking normal multiline composer editing.
- [x] 2.3 Add slash-triggered palette opening and filter synchronization from the composer draft.
- [x] 2.4 Add inline helper text below/near the composer for command usage, required arguments, optional arguments, examples, and validation errors.
- [x] 2.5 Add command palette and helper styles to `src/styles/globals.css` only, preserving 0px radius, Basebuild Mono colors, and the existing flat visual language.

## 3. Commands Button Entry Point

- [x] 3.1 Add a visible `Commands` button to `src/components/panels/ChatComposerRail.tsx` or the active composer rail equivalent after rebasing in-flight composer changes.
- [x] 3.2 Ensure the `Commands` button has a `title=` tooltip and opens the same palette as typing `/`.
- [x] 3.3 Ensure pointer selection from the button fills the composer draft with the command and helper text, without executing until the user submits.

## 4. Built-in Command Execution

- [x] 4.1 Implement `/model [query]` by opening/filtering the existing model picker and persisting the selected provider/model/effort through the existing selection path.
- [x] 4.2 Implement `/provider [query]` by opening/filtering the existing provider picker and resolving a compatible model fallback through the existing catalog logic.
- [x] 4.3 Implement `/new` by creating or focusing a fresh empty chat for the current project while preserving the previous chat.
- [x] 4.4 Implement `/clear` with explicit confirmation when persisted messages/tool events would be deleted, preserving the session record and provider/model/effort selection.
- [x] 4.5 Add a thin `src/lib/native-chat.ts` wrapper plus `src-tauri` command/service/model changes only if `/clear` requires a backend persisted-message delete API.
- [x] 4.6 Implement `/commands` and `/help` as local command-reference output with complete command metadata, source labels, shadowed-command notes, and keyboard guide.
- [x] 4.7 Implement `/stop` by reusing the existing native chat cancellation path and reporting idle/running outcomes inline.
- [x] 4.8 Preserve existing `/login`, `/models refresh`, `/plan`, `/idea`, `/openspec`, `/mcp`, and `/skill:<name>` behavior while routing them through the new metadata/helper surface.
- [x] 4.9 Ensure unknown slash commands show a local no-match/help state and require explicit user action before sending as plain text.

## 5. Recency & Safety

- [x] 5.1 Persist recent command usage as capped non-secret local UI preference data and update it only after successful command submission.
- [x] 5.2 Ensure command palette metadata never expands command bodies, secrets, provider tokens, environment variables, or credentials.
- [x] 5.3 Ensure `/clear`, `/new`, `/model`, and `/provider` produce inline success/failure feedback without silently changing hidden state.

## 6. Verification

- [x] 6.1 Add focused frontend tests for filtering, ranking, argument-helper formatting, and Tab completion helper behavior.
- [x] 6.2 Add UI behavior coverage for slash-triggered palette opening, Commands button opening, keyboard navigation, and no-send local command execution.
- [x] 6.3 Add Rust service tests for persisted chat clearing if a backend clear command is introduced.
- [x] 6.4 Run `npx tsc --noEmit`.
- [x] 6.5 Run `npm run build`.
- [x] 6.6 Run `cd src-tauri && cargo check` if any Rust/backend files changed.
- [x] 6.7 Run `cd src-tauri && cargo test` if any Rust/backend files changed.
- [x] 6.8 Run the relevant Playwright/UI smoke path for composer command discovery, keyboard navigation, Commands button selection, and local command execution.

## 7. Docs & Roadmap

- [x] 7.1 Update `DESIGN.md` or `docs/agents/*` only if the command palette changes documented user workflow or agent-facing behavior.
- [x] 7.2 Refresh `openspec/ROADMAP.md` with `node scripts/openspec-status.mjs --write` after implementation tasks are complete.
