# Design: Planning System QoL & End-to-End Completion

## Context

Live desktop testing (2026-07-05, dev build, `umans/umans-glm-5.2`) showed
the plan pipeline stops at chat prose, several archived canonical specs are
unimplemented, and session hygiene problems hide persisted state from the
user. Key observed evidence:

- `plans` unchanged and `pipeline_runs` empty after a full generate-plans
  run; the model emitted complete OpenSpec artifacts as text and asked
  whether to write files.
- "Start OpenSpec" set `status='openspec'` with `change_name=NULL`; no
  artifacts on disk. `openspec_service::write_artifacts_atomic` and
  `openspec_task_progress` already exist but have no caller in this path.
- `plan_runner_service::execute_run` provisions a chat session and returns —
  no agent loop drives the run.
- All `native_tool_events` rows for a 7-minute run carried the same
  end-of-run `created_at`; during the run the UI showed raw tool-call JSON
  inside the assistant bubble.
- `run_command` auto-denies with "Pending UI integration" despite the
  archived `tool-approval-gateway` spec.
- 65+ `Session <timestamp>` rows; 4 sessions minted in one hour purely from
  app starts; sidebar reorders on selection (sorted by `updated_at`, which
  selection touches); no single-instance guard (three concurrent processes
  reproduced).
- `provider_client.rs` persists `{reasoning}\n\n---\n\n{content}`
  (two sites, ~lines 766/1028), leaking chain-of-thought into the transcript
  and back into provider context.
- `walk_glob_recursive` calls the `**` zero-directory expansion inside the
  per-entry loop → duplicated results (model complained mid-run).
- Real user DB contains `/test/project-*` rows from tests.

## Goals / Non-Goals

**Goals**:
- Make generate → select → openspec → ready → run traceable, persistent, and
  visible across restarts, matching the already-canonical specs.
- Fix chat trust issues: reasoning fold, raw tool JSON, silent denials.
- Session hygiene: reuse, titles, stable ordering, single instance.

**Non-Goals**:
- New model providers, streaming protocol changes beyond channel separation,
  OMP runner changes (`plan_run_start_omp` path untouched).
- Session compaction (tracked separately in ROADMAP proposed plans).
- Backfilling titles for existing junk sessions (optional cleanup task).

## Decisions

- **Decision**: Capture proposals via a `propose_plans` tool exposed to the
  agent loop during generate-plans runs (arguments: array of {title,
  description, goal, suggested_change_name}), persisted to a new
  `plan_proposals` table (id, session_id, run_id, title, description, goal,
  state `proposed|accepted|dismissed`, plan_id nullable, created_at).
  **Rationale**: tool-calls are the only structured channel every supported
  provider already speaks; parsing prose is brittle. The loop already has a
  tool runtime and event stream. **Alternatives**: JSON-only response
  contract (breaks when models add prose; no incremental UI), reuse `ideas`
  table (different lifecycle and semantics).
- **Decision**: `draft → openspec` runs a recorded pipeline stage that calls
  the model for artifact content and writes via `write_artifacts_atomic`,
  setting `change_name` before the status flip; failure keeps the plan in
  `draft` with a surfaced error. **Rationale**: matches `openspec-artifacts`
  and `plan-pipeline` canonical requirements; the service layer already
  exists. **Alternatives**: keep status-only transition (tested; produces
  the current dead end).
- **Decision**: Store reasoning in a new nullable
  `native_chat_messages.reasoning` column; strip `<think>` markers from
  content; provider request assembly reads content only. **Rationale**:
  smallest schema change; keeps message identity. **Alternatives**: separate
  reasoning table (overkill for 1:1), discard reasoning entirely (loses
  the live-thinking UX the streaming channel already supports).
- **Decision**: Persist tool events as they occur (insert at call start,
  update on completion) and drive transcript cards from the existing event
  emit channel. **Rationale**: the streaming emit exists; only persistence
  and rendering lag. **Alternatives**: keep end-of-run batch write (violates
  the live-cards spec).
- **Decision**: Render consecutive tool calls of a turn as one collapsed
  activity group (count + aggregate status + latest call summary) whose
  expansion is a height-capped scroll area that auto-follows the newest
  call until the user scrolls up; grouping is a pure render-layer concern
  over the flat event stream. **Rationale**: a single agentic turn can emit
  dozens of calls (20+ observed in one test run); stacked full-width cards
  bury the conversation. View-layer grouping needs no schema change and the
  flat event log stays canonical. **Alternatives**: paginate cards (still
  noisy), cap rendered events (hides information).
- **Decision**: Single instance via `tauri-plugin-single-instance` with a
  focus callback. **Rationale**: canonical Tauri v2 solution; also protects
  SQLite from multi-writer surprises. **Alternatives**: DB lockfile probe
  (racy, no focus handoff).
- **Decision**: Sidebar orders by `created_at DESC`; selection stops writing
  `updated_at`. Auto-title on first user message via a cheap local
  truncation (no model call); manual rename sets `title_locked`.
  **Rationale**: deterministic, offline, no request cost.
  **Alternatives**: model-generated titles (adds latency/cost; can be a
  later enhancement layered on the same fields).
- **Decision**: Effort clamping happens in one place — catalog-aware
  resolution in `native_chat_service` (used by send, session create, and
  default restore) — plus UI filtering of the selector. **Rationale**: single
  choke point prevents drift between stored default and request payload.

## Risks / Trade-offs

- Agent-driven artifact generation may produce invalid OpenSpec formatting →
  Mitigation: validate with the existing parser (`openspec_parse_task_progress`
  et al.) before the atomic write; reject and surface on failure.
- `propose_plans` tool adoption varies by model → Mitigation: system prompt
  for generate-plans runs mandates the tool; fall back to a
  structured-output parse of the final message when the tool was never
  called, and surface "no proposals captured" instead of silence.
- Suppressing `updated_at` on selection could affect other consumers →
  Mitigation: audit `sessions.updated_at` readers; introduce a separate
  `last_selected_at` if any depend on touch-on-open.
- Reasoning column migration on large DBs → Mitigation: nullable column,
  no backfill.

## Migration Plan

1. SQLite migrations: `plan_proposals` table; `native_chat_messages.reasoning`
   TEXT NULL; `sessions.title_locked` INTEGER default 0.
2. Ship behavior changes behind the same release; no data backfill. Existing
   junk sessions remain readable; optional "clean empty sessions" action can
   ship later.
3. Rollback: schema additions are additive; previous binary ignores them.

## Open Questions

- Should accepted proposals auto-enqueue to the run queue when the user
  accepts with a modifier ("accept & queue")? Deferred until the base flow
  lands.
- Whether plan runs (native kind) should auto-send the opening instruction
  message — the `openspec-artifacts` "Run references the change" scenario
  implies yes; confirm before wiring auto-send to avoid violating the
  no-silent-side-effects invariant (run start IS an explicit user action).
