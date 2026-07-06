# Design: Session Compaction

## Context

`context-budget-guard` trims sessions by dropping oldest whole turns before each
provider request, always keeping the system prompt, latest user message, and the
current iteration's tool results. This is lossy for long, multi-step tasks.
`native-agent-loop` deferred summarize-and-continue compaction. The budget path
lives in `agent_loop_service.rs`; conversation turns and tool events are stored
per session (`native_chat_service.rs` / `session_service.rs`).

## Goals / Non-Goals

**Goals**:
- Preserve task continuity past the truncation point via a durable summary.
- Make compaction visible and persistent; degrade safely to truncation.
- Keep the existing preservation invariants (system prompt, latest user message,
  current iteration's tool results).

**Non-Goals**:
- Changing the token estimator or catalog window logic.
- Retrieval/RAG over old turns (compaction summarizes; it does not index).
- Auto-tuning thresholds — a single configured threshold is enough for now.

## Decisions

- **Decision**: Run compaction inside the budget path in `agent_loop_service.rs`,
  *before* whole-turn dropping, gated on an enable flag + threshold. — **Rationale**:
  one enforcement point already exists; compaction is a strictly better first
  attempt with the same preservation rules. **Alternatives**: a separate periodic
  compactor (races with the budget check; two sources of truth).
- **Decision**: Store the summary as a distinct compaction message kind carrying
  the summarized span, replacing the summarized turns in the sent history but
  retaining originals on disk. — **Rationale**: durable across restart, visibly
  distinct from truncation, and reversible for audit. **Alternatives**: overwrite
  old turns (destroys audit trail and the raw transcript).
- **Decision**: Summarize with the session's model via a scoped turn; on any
  failure fall back to the existing drop path. — **Rationale**: never block a
  send; compaction is an optimization, not a hard dependency. **Alternatives**: a
  fixed cheap model (extra config, cross-provider surprises).

## Risks / Trade-offs

- Summary loses a needed detail → Mitigation: summary prompt targets decisions,
  facts, and open threads; originals stay on disk; a compaction notice tells the
  user what span was folded.
- Summarization latency on huge sessions → Mitigation: threshold fires before the
  hard limit; fallback to truncation keeps the turn responsive.

## Migration Plan

Additive. New message kind + metadata columns migrate forward only; sessions with
no compaction message behave exactly as today. Compaction defaults off until the
setting is enabled.

## Open Questions

None.
