# Design: planning-cockpit

## Context

`planning-command-center` (46/48) built primitives; live use shows the seams
between them are stubbed or broken. Root causes are diagnosed with evidence in
`docs/reports/2026-07-07-planning-cockpit-audit.md`:

- Prompt routing: `AppShell.tsx` `chatDraft`/`autoSendDraft` broadcast to all
  mounted `ChatPanel`s; `chatDraftTabId` is written, never read; the consuming
  effect can consume without sending, and never clears the composer after
  auto-send (`ChatPanel.tsx:710-727`).
- Assignment: `handleAssignPlan` (`ChatPanel.tsx:1139-1145`) sets local state
  only; "Launch N ready" (`PlanningInspector.tsx:487-499`) flips statuses via
  `window.confirm`. Backend dispatch always creates a fresh
  `native_chat_sessions` row (`plan_runner_service.rs:691-719`).
- `ask_user` gap: OMP-RPC-routed chats force `supports_tools=false`
  (`native_chat_service.rs:679-696`) and bypass the agent loop.
- OpenSpec: write + flat count only (`openspec_service.rs`); no enumeration,
  no structured tasks, no live refresh, no archive, no manual link.
- Surfaces: `PlanningInspector`/`SourcePanel` are ~300px rail components in a
  fixed 960×640 `.modal` (measured at 1720×990).

## Goals / Non-Goals

**Goals**
- Every planning decision is a click: destination choosers, question cards,
  quick-reply chips, managed confirms.
- Plans launch into user-chosen chats for real (run rows, worktrees, seeding).
- OpenSpec is the single planning substrate: catalog, checklists, live
  progress, archive. No new plan format.
- Shell-level command strip; wide adaptive planning/source layouts.
- Completion closes the loop: prompt → commit/PR with SC context.

**Non-Goals**
- No custom skill system (piggyback OpenSpec + existing bundled skills).
- No spec-merge automation in the archive action (stays an agent workflow).
- No baseline `.modal` reflow (owned by `provider-parity-workspace-fixes`).
- No raw-terminal question bridging (pty has no structured channel).
- No auto-commit/auto-push policy changes (final-touches defaults unchanged).

## Decisions

1. **Prompt delivery as a first-class message bus, not shared draft state.**
   **Decision**: replace `chatDraft`/`chatDraftTabId`/`autoSendDraft` with a
   `deliverPrompt({ chatSessionId, text, mode: "insert" | "send" })` shell
   API; `ChatPanel` subscribes by its own `nativeSessionId`; pending
   deliveries for not-yet-ready chats are held in a per-session queue and
   flushed on readiness, exactly once (idempotency token per user action).
   **Rationale**: kills broadcast, stale-tab capture, and the
   consume-without-send race in one move; sessions are the stable identity
   (panel/tab ids churn).
   **Alternatives**: fixing `chatDraftTabId` reads (still racy across
   creates); backend chat-append command (heavier, duplicates the existing
   send path, and hides the message from composer editing in insert mode).

2. **Destination chooser is one shared component.**
   **Decision**: `DestinationPicker` lists open chat panels (title, grid
   position, model, busy/assigned state) + "New conversation"; used by
   schematic wizard, idea browser "Send to chat", and batch-launch mapping.
   **Rationale**: one UX for "which chat?" everywhere; one e2e surface.

3. **Assignment dispatch binds to the existing session.**
   **Decision**: new command `plan_assign_to_chat(plan_id, chat_session_id)`:
   validates plan `ready` + session unassigned → seeds opening context into
   that session (existing `build_plan_opening_context`), provisions worktree
   per policy (git projects; reuse `WorktreeService::create_with_base`), sets
   `plan_runs.workspace_path`, enqueues respecting `run-concurrency-limits`,
   emits `PLAN_RUN_EVENT` with the *same* `chat_session_id`. `runner` keeps
   the fresh-session path only when destination = new panel.
   **Rationale**: matches the canonical spec's intent; frontend stubs become
   thin calls; queue/caps logic reused.
   **Alternatives**: frontend orchestration of enqueue+seed (racy, splits the
   invariant across processes).

4. **tasks.md liveness = tool-event hook + scoped poll, no watcher crate.**
   **Decision**: (a) native tool runtime + app-driven OMP sessions: after any
   successful file write whose resolved path matches
   `<project>/openspec/changes/**/tasks.md`, re-parse and emit
   `TaskProgressChanged`; (b) while ≥1 plan run is active, poll linked
   tasks.md mtimes every 2s (debounced, mtime-gated re-parse); (c) catalog
   open in UI: poll at 5s.
   **Rationale**: covers agent edits instantly and external edits within
   bounded latency, zero new dependencies, no global FS watching of user
   projects (privacy + resource posture).
   **Alternatives**: `notify` crate (new dependency, watch handles per
   project, overkill for one file class).

5. **Structured tasks parse stays line-oriented and lossless.**
   **Decision**: parse phases (`^## ` headings) and task lines
   (`^\s*- \[( |x|X)\] (id?) text`), recording byte offsets; toggle rewrites
   only the checkbox marker at the recorded line, verified against the
   line's current content before write (mtime + content guard, atomic
   temp+rename). Reject paths that don't canonicalize under
   `<project>/openspec/changes/`.
   **Rationale**: preserves human formatting; concurrent-edit safe;
   path-traversal safe.

6. **OMP-RPC chats get cards via the RPC question channel.**
   **Decision**: when a native chat turn delegates to OMP RPC, route
   user-input/ask frames through the existing
   `omp_rpc_session_service::handle_user_input` → `pending_interactions` path
   keyed to the chat's session id, so `ChatPanel` renders the same cards;
   answers serialize back over stdin. `ask_user` remains the native-loop
   tool; no tool injection into OMP.
   **Rationale**: reuses two shipped mechanisms; no OMP protocol invention.
   **Risk**: OMP may ask in prose anyway → covered by quick-reply chips.

7. **Prose quick-reply chips are conservative and client-side.**
   **Decision**: detect only completed assistant messages ending in an
   enumerated question: ≥2 options matching `^[A-H][).:]\s` list items or an
   explicit "reply with X/Y" phrase; render chips that prefill+send plain
   text; no detection inside code fences; everything escaped.
   **Rationale**: high precision beats recall — cards are the primary path;
   chips only rescue degraded modes (OMP prose, tool-less models).

8. **Command strip is a shell component fed by existing state.**
   **Decision**: `CommandStrip` renders from the planning-events store +
   catalog counts already held by `state/plans.ts` / `state/ideas.ts`;
   clicking opens the planning surface pre-focused on a stage. Collapsed
   state persists in workspace restore state.

9. **Wide layouts via container queries in `globals.css`.**
   **Decision**: planning/source surfaces become `container-type: inline-size`
   hosts; ≥1100px container → master–detail two-pane, board stages as
   columns; below → stacked. Depends on `provider-parity-workspace-fixes`
   making `.modal` adaptive; this change only styles the *content*.
   **Rationale**: no JS resize plumbing; works in modal or future docked
   hosts alike.

## Risks / Trade-offs

- **Two changes touch the same modal shells** (`provider-parity-workspace-fixes`
  baseline vs this change's content layouts) → Mitigation: ordering gate
  (land after it or rebase layout tasks); layout tasks touch content classes
  only, never `.modal` sizing rules.
- **Toggle vs agent write race on tasks.md** → Mitigation: content+mtime guard
  before rewrite; on mismatch, re-parse and ask the user to retry (no blind
  write).
- **Prose detection false positives** → Mitigation: conservative grammar, no
  chips when an `ask_user` card is pending, e2e fixtures for negative cases.
- **OMP frame drift across versions** → Mitigation: tolerant parsing already
  in `omp_rpc_session_service`; unknown frames stay inert; chips as fallback.
- **Batch launch partial failures** (worktree creation fails for one plan) →
  Mitigation: per-plan error capture; failed plan reverts to `ready`
  (spec'd); summary notification names failures.

## Migration Plan

Additive throughout: new commands + one planning-event kind
(`TaskProgressChanged`); no SQLite schema change required (assignment reuses
`plan_runs.chat_session_id` / `workspace_path`). Frontend removes the
`chatDraft*` state in the same PR that lands `deliverPrompt` (no
compatibility window — internal seam). Rollback = revert; on-disk OpenSpec
files are only ever edited via checkbox toggle or archived via directory move,
both reversible by hand.

Ordering gates:
1. Archive `planning-command-center` (bases for `chat-interactive-elements`,
   `planning-flow-board`; absorbs its open 6.4/6.5).
2. Land `provider-parity-workspace-fixes` modal-reflow tasks (or rebase this
   change's layout tasks if it lands first).

## Open Questions

- Should "Send to chat" from the idea browser mark the idea `picked`
  automatically once the resulting turn promotes it? (Current answer: no —
  status changes only through explicit promote.)
- Strip placement when the sidebar is collapsed: keep a one-badge dock or hide
  entirely? Default: one-badge dock; revisit after live use.
