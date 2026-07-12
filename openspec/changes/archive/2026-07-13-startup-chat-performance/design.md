# Design: Startup and Chat Performance

## Context

The first storage connection currently performs the complete idempotent schema initializer on every process launch. That initializer probes and migrates roughly fifty tables, so a safe idempotent implementation still imposes a repeated launch cost. Frontend project discovery then fans out session reads for every recent project. Chat startup waits for six unrelated reads in one `Promise.all`, including global metrics, before exposing its provider catalog; existing transcript hydration is gated on that catalog. Stream fragments update React state for every provider event.

The chat UI duplicates model and runtime details in the sticky header, transcript metrics row, composer rail, controls row, and context strip. Context usage is passed as `{ used: null, limit: null }`, guaranteeing an unknown display.

## Goals / Non-Goals

**Goals**:
- Make current-schema launches take the storage fast path.
- Keep first/legacy database preparation correct and serialize concurrent first connections.
- Prioritize visible projects, active workspace data, and transcripts over secondary metadata.
- Bound stream-driven renderer updates to the display refresh cadence.
- Produce a compact, keyboard-usable, tooltip-complete header and minimal composer.
- Show grounded per-session context usage.

**Non-Goals**:
- Replace SQLite, React, Tauri IPC, or the native agent loop.
- Introduce remote caches, analytics, uploads, or speculative provider calls.
- Pre-open terminals, agents, projects, or other side-effecting resources during warm-up.
- Change provider token accounting semantics.

## Decisions

**Decision**: Persist a `PRAGMA user_version` matching a code-owned schema version and run the existing initializer only when the database version is behind. Keep the per-path process lock across version check, migration, and version write. — **Rationale**: preserves the battle-tested idempotent migration body while removing its normal-launch cost. **Alternative**: rewrite all existing migrations into numbered steps now; cleaner long term, but unnecessarily risky for this performance slice.

**Decision**: Apply WAL mode only in the once-per-process initialization section; retain per-connection busy timeout and synchronous settings. Run storage-heavy Tauri commands through `spawn_blocking`. — **Rationale**: journal mode is sticky and should not be rewritten by every short-lived connection; blocking filesystem/SQLite setup must not occupy the command thread.

**Decision**: Seed recent projects from a validated localStorage cache, refresh SQLite immediately, prioritize the active project's sessions, then hydrate remaining project histories after the browser yields. — **Rationale**: the shell can orient the user without waiting for secondary lists; SQLite remains authoritative. **Alternative**: add a denormalized all-project startup RPC; potentially faster but expands the backend API and duplicates query shapes.

**Decision**: Separate critical chat configuration from secondary metrics/permission reads and let existing-session transcript hydration run without catalog availability. — **Rationale**: unrelated data must not form a single failure or latency barrier.

**Decision**: Append stream bytes to refs immediately but publish React state through one scheduled animation-frame flush per channel. — **Rationale**: preserves byte order and completeness while preventing event-rate rendering.

**Decision**: Track an explicit follow-latest ref from scroll events and apply bottom alignment in a layout effect when transcript content changes. Sending a message or pressing the latest button re-enables following. — **Rationale**: avoids inferring pre-growth scroll geometry from stale heights.

**Decision**: Move model, effort, permission, run state, context, branch, and secondary actions into `ChatHeader`; remove the transcript metrics row, composer rail, lower controls row, and context strip. The context indicator uses the latest request's input plus output tokens and the model context window. — **Rationale**: one information hierarchy, no contradictory duplicates, and a smaller composer.

## Risks / Trade-offs

- A future schema change could forget to increment the version → Mitigation: central constant, tests for fresh/current version behavior, and migration instructions in the storage service.
- Cached project paths can be stale → Mitigation: schema-validate cache, never activate from cache alone, and replace it with SQLite results.
- Deferring inactive session lists briefly hides their counts → Mitigation: active project loads first and inactive lists fill without blocking interaction.
- Token usage reflects the latest completed request rather than an exact live tokenizer estimate → Mitigation: exact source/ratio in tooltip and immediate update from the send result.
- Moving controls into a dense header can overflow narrow panels → Mitigation: truncation, compact dropdowns, icon secondary actions, and focused E2E/screenshot checks at the minimum viewport.

## Migration Plan

1. On the first launch after this change, the existing initializer runs once and writes the schema version.
2. Later launches skip the full initializer while retaining connection safety pragmas.
3. The project cache populates after the first successful authoritative read; no database rows are migrated for it.
4. Chat sessions require no data migration; the latest existing request metric seeds context usage.
5. Rollback remains safe: the prior idempotent initializer ignores the higher `user_version` and can still run its checks.

## Open Questions

- None for this slice. If startup timing remains above the interaction budget after these changes, command telemetry will identify the next blocking service rather than adding speculative warm-up work.
