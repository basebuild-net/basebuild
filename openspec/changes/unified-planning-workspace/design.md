# Design: Unified Planning Workspace

## Context

Two planning data models coexist and confuse the UI:

- `ideas` + `idea_categories` (owned by `session_service`, surfaced in the right
  panel's Ideas surface) — the older catalog with `concept → picked → archived`.
- `plan_proposals` (owned by `plan_proposal_service`, shipped in the unarchived
  `planning-system-qol` change, surfaced as chat "proposal cards") — captured by
  the agent's `propose_plans` tool during generate-plans runs.

Generation (`native_chat_service::generate_ideas`) builds a one-shot prompt,
calls `provider_client::generate`, parses a JSON array, saves ideas, and emits
streaming deltas on a `native-chat://chunk` channel tagged `ideas` — which
`ChatPanel` discards (`if (channel === "ideas") return;`). Result: a
`Generating…` spinner with no visible thinking, progress, or incremental
output.

System prompts (`native_chat_service::system_prompt`, the idea prompt, etc.) are
Rust string literals with no runtime override.

## Goals / Non-Goals

**Goals**:
- One catalog: `Categories → Ideas → Plans`. Delete the parallel proposals path.
- Generation is a visible chat turn (reasoning fold + live progress + idea cards
  appearing one by one), reusing the existing streaming + agent-loop plumbing.
- Categorical direction with default seed (SEO, Optimization, Design, New
  Features) and per-category "suggest more".
- Idea `rejected` status; Reject action beside Promote; status-filtered history.
- One tabbed right-side inspector `Plans / Ideas / Categories` with category
  drill-down.
- Compact chat planning quick-access menu.
- Tunable, resettable planning prompts in Settings → Planning.

**Non-Goals**:
- No cloud sync of prompts or catalog (local-first).
- No change to plan lifecycle statuses (`draft → openspec → ready → running →
  finished`), OpenSpec artifact generation, or the run queue.
- No multi-user or shared-catalog semantics.

## Decisions

**Decision: `ideas` is the single unit; remove `plan_proposals`.**
- **Rationale**: The user explicitly wants unification; two stores rendering
  near-identical cards is the reported "stupid" UI. `ideas` already has
  categories, promotion, persistence, and a spec (`plan-pipeline`). Proposals do
  not add a distinct concept — they are ideas captured from chat.
- **Compatibility note (api-design skill)**: The skill counsels extend-only and
  deprecate-before-remove for *released public APIs with external consumers*.
  `plan_proposals` is an internal SQLite table + Tauri commands in a pre-1.0
  (`v0.0.x`), local-first, single-user app, shipped in a not-yet-archived change
  and exposed to no third party or wire protocol. There is no
  binary/wire/source-compat surface to preserve. The delivery contract's
  "default to clean cutover — leave no shims" governs here: drop the table and
  `plan_proposal_*` commands, migrate the `propose_plans` tool to `propose_ideas`
  writing `ideas`. This supersedes the `plan_proposals` portion of
  `planning-system-qol`.
- **Alternatives**: (a) Keep both, add a sync layer — rejected: more surface,
  same confusion. (b) Make proposals the unit and drop ideas — rejected: ideas
  is older, richer, already specced with categories/promotion.

**Decision: Generation runs through the agent loop as a real chat turn using a
`propose_ideas` tool.**
- **Rationale**: Directly satisfies "planning as part of the global terminal
  chat with full context". Reuses the shipped thinking-fold (reasoning channel),
  live tool-event transcript, and idea-card rendering. The tool captures each
  idea to the `ideas` catalog as it is called, so cards stream in incrementally
  and the run is naturally cancellable and recorded as a `pipeline_runs` stage.
- **Mechanism**: `native_chat_service` sends a generation turn: a user message
  ("Generate ideas for <category|freeform>…"), a system prompt from
  `planning_prompt_service`, and the `propose_ideas` tool exposed for this turn.
  `agent_loop_service` intercepts `propose_ideas` (like the current
  `propose_plans`) and calls `SessionService::create_idea(session, title, desc,
  category_id)`, emitting a tool event per capture. The discarded `ideas`
  channel and the one-shot JSON path are removed.
- **Alternatives**: (a) Keep the one-shot call but stop discarding the stream —
  rejected: still a bespoke path, no tool cards, weaker "in-context" story.

**Decision: `IdeaStatus` gains `Rejected` (additive).**
- **Rationale**: History needs accepted/rejected/no-change/archived. `rejected`
  is semantically distinct from `archived`.
- **Mechanism**: Add `IdeaStatus::Rejected` (`"rejected"`), extend `as_str` /
  `from_str`. Existing rows unaffected; unknown strings still fall back to
  `concept`. This is an additive enum value — safe for readers.

**Decision: Planning prompts stored in a `planning_prompts` key/value table with
compiled defaults.**
- **Rationale**: Additive, simple, no restart needed (read per-generation).
- **Schema**: `planning_prompts(key TEXT PRIMARY KEY NOT NULL, value TEXT NOT
  NULL, updated_at INTEGER NOT NULL)`. Keys: `chat_system`, `idea_generation`,
  `plan_generation`, `category_generation`. Absence of a row = use the compiled
  default. `reset` = `DELETE` the row. `list` returns, per key, `{ key, value
  (effective), default, isModified }`.
- **Scope**: Global (not per-project) for v1 — prompts are harness-level tuning.
- **Alternatives**: per-project prompts — deferred; adds a project dimension
  without a demonstrated need.

**Decision: Default categories are seeded lazily per session.**
- **Rationale**: Categorical generation needs direction out of the box without a
  setup step, but seeding must not fight user/AI categories.
- **Mechanism**: `SessionService::ensure_default_categories(session_id)` inserts
  SEO / Optimization / Design / New Features **only if** the session has zero
  categories. Called when the Categories tab opens or before category-directed
  generation. Idempotent.

**Decision: The right panel becomes a tabbed inspector; the generate modal is
retired for the ideas/quick path.**
- **Rationale**: One exploration surface (`Plans / Ideas / Categories`) plus a
  compact chat menu is the requested model. The existing `GeneratePlanModal`
  "Generate from context" behavior for schematic-based plan prompts is retained
  where it feeds the chat, but the primary idea entry points move to the chat
  menu and the Categories tab.

## Data model

```
idea_categories(id, session_id, name, description, created_at)     -- existing
ideas(id, session_id, category_id, title, description, status,     -- existing
      created_at, updated_at)   -- status now: concept|picked|rejected|archived
plans(... idea_id ...)                                             -- existing
planning_prompts(key, value, updated_at)                           -- NEW
-- REMOVED: plan_proposals
```

## Migration Plan

1. Additive migration: create `planning_prompts`; no-op if present.
2. `ideas.status` accepts `rejected` — no schema change (TEXT column); readers
   updated.
3. Drop `plan_proposals` (`DROP TABLE IF EXISTS plan_proposals`) and remove
   `plan_proposal_*` commands + `lib/planProposals.ts`. Pre-1.0, local,
   single-user; any dev-only rows are discardable and carry no plan links.
4. Ship behind one release; schema additions are additive and a previous binary
   ignores `planning_prompts`. The dropped table is not read by older code paths
   after this change.
5. Rollback: re-adding `plan_proposals` is a schema-only revert; no data
   migration is owed because proposals were never promoted into plans directly
   (promotion always went through `ideas`/plans).

## Risks / Trade-offs

- **Dropping a just-shipped table** → Mitigation: it is unarchived, internal,
  and dev-only; documented supersession in the proposal and roadmap.
- **Generation-as-tool-turn reliability** (model may not call `propose_ideas`)
  → Mitigation: keep the tolerant fallback parser that scans the final message
  for a JSON array and captures ideas, mirroring today's
  `parse_and_capture_proposals`, so a non-tool-calling model still yields ideas.
- **Prompt editing footgun** (user saves a broken prompt) → Mitigation:
  "Reset to default" per prompt; defaults always available; empty override is
  treated as "use default".
- **Inspector scope creep** → Mitigation: tabs reuse existing plan lane and idea
  list rendering; Categories drill-down is a filtered idea list plus one button.

## Open Questions

- Should `By category…` in the chat menu and the Categories tab share one
  category-picker component? (Assumed yes; a single `CategoryPicker`.)
- Should rejecting an idea that already has a linked plan be blocked? (Assumed
  yes — `picked` ideas are not rejectable; Reject is offered only for `concept`.)
