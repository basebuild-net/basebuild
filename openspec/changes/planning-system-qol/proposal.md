# Proposal: Planning System QoL & End-to-End Completion

## Why

Live testing on 2026-07-05 (dev build, project `basebuild-dotnet`, model
`umans/umans-glm-5.2`) showed the planning pipeline is not usable end-to-end:
"Generate plans" produces only chat prose (the model even asks "want me to
turn these into actual openspec files?"), "Start OpenSpec" flips a status
without generating artifacts, plan runs only provision a chat session, and
every app launch mints a new junk-titled session so existing plans become
invisible. Several already-archived canonical specs (`openspec-artifacts`,
`tool-transcript-rendering`, `tool-approval-gateway`, `plan-pipeline` stage
recording, `ide-workspace-state` session restore) are unimplemented; this
change closes those gaps and adds the missing QoL requirements found in
testing.

## What Changes

Implementation gaps against existing canonical specs (no new requirements):

- Wire `openspec_service::write_artifacts_atomic` into the `draft → openspec`
  transition: generate `proposal.md`/`specs/`/`tasks.md` via a recorded
  pipeline stage, set `plans.change_name`, and only then flip status
  (`openspec-artifacts` spec).
- Surface `openspec_task_progress` (completed/total from `tasks.md`) on plan
  cards and the focus modal (`openspec-artifacts` spec).
- Persist and emit tool events live during the agent loop instead of writing
  them all at run completion; render tool calls as live cards, never as raw
  argument JSON concatenated into assistant text (`tool-transcript-rendering`
  spec; observed: all `native_tool_events` rows shared one end-of-run
  timestamp, and `{"glob": ...}` fragments rendered inline in the bubble).
- Implement the `run_command` inline approval card; today every call is
  auto-denied with "Approval required for run_command. Pending UI
  integration." (`tool-approval-gateway` spec).
- Resume the last session on launch instead of creating
  `Session <timestamp>` rows (65+ junk sessions observed; 4 created during
  one test hour just from app starts) (`ide-workspace-state` spec).
- Record plan/idea AI stages as `pipeline_runs` rows (`plan-pipeline` spec;
  table observed empty after generation runs).

New requirements (spec deltas in this change):

- **Structured plan proposal capture**: generate-plans runs return proposals
  as structured data rendered as selectable cards; accepted AND rejected
  proposals persist per session and reload; accepted ones become draft plans.
- **Session lifecycle QoL**: no session minting on launch, auto-derived
  meaningful session titles, stable sidebar ordering (selection must not
  reshuffle the list), and a single-instance guard (second launch focuses the
  existing window; two live instances sharing `state.db` were reproduced).
- **Reasoning channel separation**: stop persisting
  `{reasoning}\n\n---\n\n{content}` as the assistant message
  (`provider_client.rs`); store reasoning separately, render it collapsed
  with visually distinct "Thinking" styling (never confusable with the
  reply), and exclude it from subsequent provider requests. Observed leak:
  reply was "The user wants me to reply with exactly ... --- GLM52-OK".
- **Grouped tool activity**: consecutive tool calls collapse into one live
  activity group (count + latest call summary) with a height-capped
  scrollable expansion, so long agentic runs don't fill the transcript with
  stacked cards (a 7-minute test run produced 20+ full-width tool rows).
- **Deterministic tool globs**: `list_files` currently returns mass
  duplicates (`walk_glob_recursive` re-matches the `**` zero-directory branch
  once per directory entry); results must be deduplicated and sorted.
- **Effort validity**: composer/effort persistence must clamp to the model's
  `supportedEfforts` (observed `medium` stored and sent for
  `umans-glm-5.2`, which supports only `high`/`xhigh`).
- **Test DB isolation**: Rust tests must never write the user's real
  `~/.basebuild/state.db` (observed `/test/project-unavailable` and
  `/test/project-default` rows in the production DB).

QoL fixes (small, no spec impact):

- Keep the typed goal when the schematic-creation modal interrupts
  "Generate plans"; resume generation after the schematic is saved.
- Remove stale copy "Until the backend skill is wired, this creates
  placeholder plans" from GeneratePlanModal.
- De-duplicate default chat tab titles ("Chat 1 | Chat 1 | Chat 1 | Chat 1"
  observed after restore) and show friendly provider/model labels (not raw
  ids like `basebuild-local · basebuild-local-coordinator`) in the chat empty
  state.

## Capabilities

### New Capabilities

- `session-lifecycle` — session creation/reuse rules, titles, ordering,
  single-instance behavior.

### Modified Capabilities

- `plan-pipeline-ui` — ADDED: structured plan proposal capture with
  selected/rejected persistence.
- `agent-chat` — ADDED: reasoning channel separation (persist, distinct
  collapsed rendering, context exclusion).
- `tool-transcript-rendering` — ADDED: grouped tool activity (collapsed
  live group, latest-call summary, height-capped scrollable expansion).
- `core-tool-runtime` — ADDED: deterministic, deduplicated glob results.
- `chat-model-defaults` — ADDED: effort level validity clamping.
- `testing-automation` — ADDED: test database isolation.

(`openspec-artifacts`, `tool-approval-gateway`, `plan-pipeline`,
`ide-workspace-state` are implementation work only — their canonical
requirements already cover the behavior. `tool-transcript-rendering` gets
both: implementing its existing live-card requirements AND the new grouping
requirement above.)

## Impact

- Rust: `plan_service`, `plan_runner_service`, `pipeline_service`,
  `native_chat_service`, `agent_loop_service`, `provider_client`,
  `tool_runtime_service`, `openspec_service`, `session_service`,
  `storage_service` (schema: proposals table, reasoning column,
  session titles), `lib.rs` (single-instance plugin).
- TS: `ChatPanel`, `PlanPanel`, `FocusPlanModal`, `GeneratePlanModal`,
  `AppShell`, `ProjectSidebar`, `state/plans.ts`, `state/sessions.ts`,
  `lib/native-chat.ts`, `lib/plans.ts`.
- DB migrations: new `plan_proposals` table; `native_chat_messages.reasoning`
  column; session title backfill is NOT required (existing titles stay).
- Docs: `docs/agents/agent-runtime.md`, `docs/agents/desktop-shell.md`,
  `DESIGN.md` (proposal cards, reasoning fold visual language),
  `docs/agents/design-system.md`.
