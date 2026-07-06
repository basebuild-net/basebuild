# Design: planning-command-center

## Context

The planning substrate is largely built: `pipeline_service.rs` runs
generation as visible chat turns, `propose_ideas` captures grounded ideas,
`plan_service.rs`/`storage_service.rs` own the catalog, `plan_runner_service.rs`
runs plans in worktrees with per-provider caps (landed via
`parallel-plan-workspaces`), and `openspec_service.rs` writes/links OpenSpec
artifacts. What's missing is the connective tissue: no interaction primitive
(agent can't ask with buttons), no domain events (UI can't react), no
notifications, no batch operations, no integration stage, and no feedback
loop. The schematic/category flows also don't work reliably in practice and
need a repair pass against their existing canonical specs.

User-selected scope decisions: notifications include a persistent center (not
toasts only); the OMP RPC bridge is built now (not deferred); personalization
uses decision-history steering plus an agent-maintained preferences file.

## Goals / Non-Goals

**Goals**:
- One managed pipeline with visible state: schematic → ideas → batch approve →
  parallel runs → integrate/cleanup → complete.
- Clicking over typing: every skill decision point renders as interactive
  cards in native chat and in OMP RPC chats.
- Every planning mutation observable: typed events → live panels + toasts +
  persistent center.
- Close the loop: decisions steer future generation; finished work nudges
  schematic re-alignment.
- Existing specs for schematic/category/idea flows actually pass end to end.

**Non-Goals**:
- OS-level (Windows) notifications — in-app only for now.
- Auto-merge/auto-push/auto-PR of any kind — integration stays confirm-gated.
- Subagent execution (owned by `harness-subagents`).
- Replacing OpenSpec — it remains the first-class plan engine; the `.basebuild`
  native engine and multi-engine selection stay with `planning-file-ingestion`
  / `plan-import` / the planning skill's engine field.
- Rendering OMP's full TUI; the RPC bridge maps structured frames only.

## Decisions

- **Decision**: One event channel (`planning://event`) with a per-app-run
  monotonic `seq`, emitted from a single `planning_events::emit(app, event)`
  helper called at service mutation points. — **Rationale**: one subscription
  point for inspector/board/notifications; `seq` lets consumers detect gaps
  and refetch instead of trusting event completeness. **Alternatives**:
  per-domain channels (more wiring, no gap detection); DB triggers/polling
  (latency, no semantics).
- **Decision**: `ask_user` pauses the agent loop on the same wait substrate as
  tool approvals (`native-chat://approval-request` pattern), with a
  `pending_interactions` table for crash safety; the startup orphan sweep
  resolves stale interactions as cancelled. — **Rationale**: the approval
  gateway already proves the park/resume shape works backend-owned;
  persistence prevents hung loops after restart. **Alternatives**: frontend
  await (dies on unmount); timeout-with-default answers (fabricates user
  intent — rejected).
- **Decision**: `ask_user` schema mirrors the batched-questions shape
  (`questions: [{id, prompt, kind, options?, recommended?, allowFreeText?}]`,
  kinds `options | multi | confirm | text`). — **Rationale**: proven UX shape;
  batching avoids N sequential round-trips; ids make multi-question results
  unambiguous.
- **Decision**: Notifications are derived consumers of planning events,
  persisted in a `notifications` table (kind, entity ref, title, detail, read,
  created_at) with a size cap pruning oldest-read. Toast rendering is a
  frontend concern over the same rows. — **Rationale**: single source of
  truth; unread survives restart; pruning bounds growth. **Alternatives**:
  frontend-only toasts (lost on restart — user explicitly wants review-later).
- **Decision**: Flow board is a new tab inside the existing Planning
  Inspector, not a new top-level surface. — **Rationale**: `chat-first-shell`
  relocated the inspector as *the* planning surface; adding a sibling surface
  would recreate the "all over the place" problem this change kills.
- **Decision**: Batch approve/launch reuse single-item paths in a loop with
  per-item error capture (no new transactional bulk path). — **Rationale**:
  identical semantics and events per item; partial success reporting; the
  scheduler already serializes run starts under caps.
- **Decision**: Decision digest is computed at assembly time in
  `planning_prompt_service` (bounded window, newest first); preferences file
  is read raw and appended after the focus directive. — **Rationale**: no new
  storage, always fresh, override precedence unchanged.
- **Decision**: OMP RPC bridge = new `omp_rpc_session_service.rs` owning a
  persistent child per session, generalizing the frame reader proven in
  `OmpCodexRpcClient` (`{id,type:"prompt"}` in; `response` /
  `assistantMessageEvent` / `turn_end` out). Question-frames map to the same
  interaction rows as `ask_user`; answers serialize back over stdin. Unknown
  frames → inert debug rows. A version probe gates the profile. —
  **Rationale**: reuses a working protocol client; one interaction pipeline
  for both runtimes; tolerant parsing because frames are untrusted. **Risk
  accepted**: OMP's question/tool frame schema must be verified against the
  installed OMP first (task 8.1) — if OMP cannot surface ask-style frames in
  RPC mode, the bridge ships text+tools streaming and question forwarding is
  explicitly reported as blocked upstream.
- **Decision**: Skill registry resolves bundled `skills/` + user dir
  (`%APPDATA%/basebuild/skills`), user wins on collision;
  `planning_prompt_service` reads through the registry; app-launched OMP
  processes are provisioned to discover the same set (mechanism verified in
  task 8.1 against OMP's skill discovery: flag, env, or config). —
  **Rationale**: kills prompt drift between runtimes; single inspection
  surface.

## Risks / Trade-offs

- **Unanswered questions hang runs** → cancel resolves as `cancelled`;
  restart sweep cancels orphans; pending-question toast + badge make them
  findable; no fabricated defaults.
- **Notification spam during generation** → per-turn summary events (one
  toast per generation turn), idea-level events default center-only,
  per-kind settings.
- **OMP frame schema drift** → tolerant parser, version probe, unknown-frame
  debug rows, protocol verification task before implementation; bridge
  degrades feature-by-feature instead of breaking.
- **Event emission gaps (missed mutation points)** → emission lives in the
  service layer next to each mutation, unit-tested per service; `seq` gap →
  consumer refetch.
- **Batch launch resource blowup (N worktrees)** → confirmation enumerates
  exactly what's created; concurrency caps already queue runs; integration
  queue + batch cleanup reclaim worktrees.
- **Preferences file drifting into fiction** → approval-gated writes only,
  user-editable, injected verbatim (inspectable), never required.
- **Scope size** → phased delivery (below); each phase lands green and
  independently valuable.

## Migration Plan

Additive only. Two new tables (`notifications`, `pending_interactions`) via
the existing migration path; no changes to existing rows or status
vocabularies (coordinates with, but does not depend on, `plan-status-rename`).
Skills gain sections; existing prompt overrides keep precedence. Rollback =
revert code; new tables are inert if unused.

Delivery phases (intended PR boundaries):
- **A — Events + notifications**: `planning_events`, emission points,
  `notification_service`, toasts, center, badges, settings.
- **B — Interactive elements**: `ask_user`, interaction persistence, question
  cards, composer routing, skill updates.
- **C — Repair + flow board**: fix schematic/category/idea flows against
  existing specs (e2e-backed), flow board with batch approve/launch.
- **D — Loop closure**: decision digest, preferences file, re-align nudge,
  integration queue, milestone auto-commit.
- **E — OMP RPC bridge + skill registry**: protocol verification, session
  service, native rendering, question forwarding, registry + Settings.

A phase may ship as its own PR; roadmap tracks per-phase progress. Gate:
`parallel-plan-workspaces` must archive first so `plan-chat-assignment` /
`run-concurrency-limits` bases are canonical.

## Open Questions

- Does the installed OMP RPC mode emit an ask/question frame today, and what
  is its exact shape? (Task 8.1 answers; question forwarding scope hinges on
  it.)
- Auto-prune worktrees when a PR is detected merged remotely — worth a
  setting later? Deferred; manual + batch cleanup first.
- Should the re-align nudge also fire on archive (not just `finished`)?
  Start with `finished`; revisit with usage.
