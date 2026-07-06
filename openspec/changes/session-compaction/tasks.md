# Tasks: Session Compaction

## 1. Data Model & Persistence

- [ ] 1.1 Add a compaction message kind + summarized-span metadata to `src-tauri/src/models/native_chat.rs` / `src-tauri/src/models/session.rs`.
- [ ] 1.2 Extend the session store (`native_chat_service.rs` / `session_service.rs` + `storage_service.rs` migration) to persist the summary and its span, retaining original turns on disk.

## 2. Compaction in the Budget Path

- [ ] 2.1 In `src-tauri/src/services/agent_loop_service.rs`, add a compaction step to the budget enforcement path that runs before whole-turn dropping when compaction is enabled and the threshold is reached.
- [ ] 2.2 Implement the summarization turn (session model) that condenses the oldest non-system turns into one summary, preserving the system prompt, latest user message, and current iteration's tool results.
- [ ] 2.3 Fall back to the existing whole-turn drop when summarization fails or the summarized history still overflows; record the outcome.

## 3. Visibility & Settings

- [ ] 3.1 Emit/store a compaction notice distinct from the truncation notice and render it in the transcript (`src/state/sessions.ts`, `src/lib/sessions.ts`).
- [ ] 3.2 Add a compaction enable + threshold control via `settings_service.rs`, `src/lib/settings.ts`, `src/state/settings.ts`, and the Settings modal; default off.

## 4. Verification

- [ ] 4.1 `cargo test` in `src-tauri` covering: compaction preferred over drop when enabled; preservation of anchors; fallback to truncation on summarization failure; restart reloads the summary.
- [ ] 4.2 `npx tsc --noEmit`
- [ ] 4.3 `npm run build`
- [ ] 4.4 UI smoke: drive a long session over threshold; confirm a compaction notice appears and the turn succeeds.
- [ ] 4.5 Update `docs/agents/agent-runtime.md` (or the relevant runtime doc) describing compaction behavior + the setting.

## 5. Docs & Roadmap

- [ ] 5.1 Refresh `openspec/ROADMAP.md` via `node scripts/openspec-status.mjs --write`.
