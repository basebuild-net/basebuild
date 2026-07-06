# Proposal: Session Compaction

## Why

The `context-budget-guard` (archived in PR #13) keeps long sessions under the
model budget by dropping the oldest turns whole. That is lossy: decisions,
facts, and open threads from early in a task vanish silently. Summarize-and-
continue compaction was explicitly deferred out of `native-agent-loop` (PR #9).
This change adds it: when a session approaches the budget, the oldest turns are
summarized into a durable, visible compaction message instead of discarded.

## What Changes

- Add opt-in **summarize-and-continue compaction**: near the budget threshold,
  the oldest non-system turns are condensed into one summary message in their
  place, preserving the system prompt, the latest user message, and the current
  iteration's tool results.
- Compaction is **visible** in the transcript (distinct from the hard-truncation
  notice) and **persists** across restart.
- **Safe fallback**: if summarization fails, the guard falls back to the existing
  whole-turn drop — never a silent provider 400.
- Extend the budget path so compaction runs *before* dropping when enabled.

## Capabilities

### New Capabilities
- `session-compaction`: summarize-and-continue compaction, its visibility, its
  durability, and safe fallback.

### Modified Capabilities
- `context-budget-guard`: the "Token budget enforcement" requirement now prefers
  compaction over whole-turn dropping when compaction is enabled.

## Impact

- **Rust:** hook the budget path in `src-tauri/src/services/agent_loop_service.rs`
  to invoke a compaction routine before whole-turn dropping; add the
  summarization turn and summary assembly; persist the summary via
  `native_chat_service.rs` / `session_service.rs`; add a compaction message kind +
  summarized-span metadata to `src-tauri/src/models/native_chat.rs` /
  `session.rs`.
- **Frontend:** render the compaction notice in the transcript
  (`src/state/sessions.ts` / `src/state/native-chat` path, `src/lib/sessions.ts`);
  no new panel.
- **Settings:** add a compaction enable + threshold control via
  `settings_service.rs` and the Settings modal (`src/lib/settings.ts` /
  `src/state/settings.ts`).
- **Tests/verification:** `cargo test` for budget/compaction ordering and
  fallback; `npx tsc --noEmit`; `npm run build`; UI smoke of a long session
  showing a compaction notice.
