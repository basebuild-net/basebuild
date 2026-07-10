# Proposal: planning-command-center

## Why

The planning system exists as disconnected parts that do not cohere into a
workflow. Skill-driven flows (schematic wizard, category generation, idea
generation) run as prose-only chat turns — the agent thinks, reads, and
responds, but never presents options to click, so every decision requires
typing. Planning mutations (plan created, idea captured, status changed, run
finished) emit no events, so nothing in the UI reacts: no toast, no badge, no
live inspector refresh. The schematic flow is effectively non-functional in
practice, categories are rarely generated, and the loop never closes — nothing
feeds approved/rejected decisions back into generation, nothing nudges a
schematic re-align after plans finish, ideas are approved one-by-one, and
finished parallel runs have no integration/cleanup stage.

This change turns the existing pieces (pipeline turns, `propose_ideas`
capture, plan lanes, worktree runs, OpenSpec artifact generation) into one
managed pipeline: `schematic → generate ideas → batch-approve → parallel
worktree runs → integrate/cleanup → complete`, with interactive question
cards in chat (buttons/options instead of typing), in-app notifications at
every stage transition, live status indicators, a personalization loop from
past decisions, and an OMP RPC chat bridge so OMP-driven sessions get the
same native interactive UI.

## What Changes

- **Interactive chat elements** — a native `ask_user` tool the agent loop
  pauses on: question cards with option buttons, multi-select, confirm, and
  free-text render in the transcript; answers return as tool results. The
  bundled planning + schematic skills are updated to drive their
  questionnaires and picking loops through it. Less typing everywhere.
- **Planning event bus** — every plan/idea/category/schematic/run mutation
  emits a typed `planning://event`; the inspector, flow board, and
  notifications consume it (no more stale panels).
- **In-app notifications** — transient toasts plus a persistent notification
  center (unread count, mark-read, click-to-navigate), fed by the event bus,
  with per-kind Settings toggles. Local-only.
- **Planning flow board** — a pipeline view of the whole lifecycle
  (Schematic → Ideas → Plans → Runs → Integration) with live counts, status
  colors, and loading indicators; multi-select **batch approve** of ideas and
  confirm-gated **batch launch** of ready plans into parallel worktree chats.
- **Feedback + personalization loop** — generation turns receive a decision
  digest (recent picks/rejections, finished plans); an agent-maintained,
  approval-gated `.basebuild/preferences.md` captures inferred taste; finished
  plans trigger a schematic re-align nudge that runs the skill's re-align
  mode as an interactive chat turn.
- **Integration / cleanup stage** — a queue of finished worktree runs with
  branch state; confirm-gated merge-to-default, post-merge test command,
  worktree prune, and batch "clean up merged". Closes the loop after parallel
  runs.
- **Milestone auto-commit** — opt-in per-project setting: during a plan run,
  commit in the run's worktree after each completed task milestone.
- **OMP RPC chat bridge** — a persistent `omp --mode rpc` chat profile whose
  frames render natively (streaming text, tool cards, and OMP questions as the
  same interactive cards); plan runs can target it. Extends the existing
  one-shot RPC client (`OmpCodexRpcClient`) into a session adapter.
- **Shared skill registry** — one resolved skill set (bundled + user), served
  to the native harness and provisioned to OMP sessions, listed in Settings;
  planning prompts and OMP runs stop drifting apart.
- **Repair pass** — diagnose and fix the existing schematic wizard, category
  generation, and idea generation flows against their already-canonical specs
  (`schematic-wizard`, `plan-pipeline` project-derived categories,
  `grounded-generation`, `chat-idea-generation`), with e2e coverage so they
  stay fixed. No spec delta — implementation must satisfy the specs that
  already exist.

## Capabilities

### New Capabilities

- `chat-interactive-elements` — `ask_user` tool, question cards, loop
  pause/resume, answer persistence, composer answer routing.
- `planning-events` — typed planning domain events over one channel; ordering
  and payload contract; UI subscription.
- `app-notifications` — toast stack + persistent notification center with
  unread badges, click-to-navigate, per-kind settings.
- `planning-flow-board` — lifecycle pipeline view with live stage indicators;
  batch idea approval; batch run launch entry.
- `planning-feedback-loop` — decision digest in generation context,
  agent-maintained preferences file, post-completion re-align nudges.
- `plan-merge-cleanup` — integration queue for finished worktree runs:
  merge, test, prune, batch cleanup; all confirm-gated.
- `omp-rpc-chat` — persistent OMP RPC session as a chat runtime profile with
  native transcript + interactive question forwarding.
- `shared-skill-registry` — single skill source resolved for both runtimes,
  with a Settings listing.

### Modified Capabilities

- `plan-pipeline` — batch idea approval (multi-select promote → plans).
- `plan-pipeline-ui` — inspector refreshes live from planning events; unread
  planning badge.
- `plan-chat-assignment` — batch launch of multiple ready plans into parallel
  chats (depends on `parallel-plan-workspaces` archiving first).
- `plan-final-touches` — milestone auto-commit step (opt-in, worktree-scoped).
- `grounded-generation` — decision-history + preferences steering in the
  focus directive.

## Impact

- **Frontend**:
  - New: `ToastStack.tsx`, `NotificationCenter.tsx`, `QuestionCard.tsx`,
    `PlanningFlowBoard.tsx`, `IntegrationQueue.tsx`, `SkillsSettingsSection`
    (inside `SettingsModal.tsx`).
  - Modified: `ChatPanel.tsx` (question cards, answer routing),
    `PlanningInspector.tsx` (Flow tab, live refresh, badges),
    `ChatEnvironmentPanel.tsx` / `StatusBar.tsx` (bell + unread count),
    `SettingsModal.tsx` (notifications, auto-commit, skills),
    `AppShell.tsx` (toast mount, navigation targets).
  - New lib wrappers: `notifications.ts`, `interactions.ts`, `integration.ts`,
    `skillRegistry.ts`; extended: `ideas.ts` (batch), `plans.ts` (batch),
    `planningPrompts.ts` (digest preview).
  - State: `notifications.ts`, `planningEvents.ts` hooks; `ideas.ts`/`plans.ts`
    gain event-driven refresh.
- **Backend (Rust)**:
  - New services: `notification_service.rs`, `interaction_service.rs`,
    `integration_service.rs`, `skill_registry_service.rs`,
    `omp_rpc_session_service.rs`; new `planning_events` module (emit helper +
    payload types).
  - Modified: `tool_runtime_service.rs` (+`ask_user`), `agent_loop_service.rs`
    (pause/resume on interaction), `pipeline_service.rs` (events, digest),
    `plan_service.rs` / `storage_service.rs` (batch ops + event emission),
    `schematic_service.rs` (events), `plan_runner_service.rs` (milestone
    commits, integration handoff), `planning_prompt_service.rs` (digest +
    preferences injection), `settings_service.rs` (notification/auto-commit/
    skill settings), `provider_client.rs` (RPC session reuse).
  - SQLite: new `notifications` and `pending_interactions` tables (additive
    migrations, no breaking change).
- **Skills**: `skills/basebuild-planning/SKILL.md` +
  `skills/basebuild-project-schematic/SKILL.md` gain an "Interactive
  surfaces" contract (use `ask_user` when available; fall back to prose);
  planning skill gains preferences-file guidance.
- **Dependencies**: none added.
- **Tests**: Rust unit tests (event emission, interaction lifecycle, digest
  assembly, RPC frame parsing, batch ops, milestone commit gating);
  Playwright e2e (question card answer flow, toast + center, batch
  approve→launch, flow board rendering, repaired generation flows) with
  mocked Tauri commands.
- **Security / trust boundaries**:
  - Model-authored question/option text renders as escaped text only — never
    HTML, never executed; answers are data returned to the loop, not shell
    input.
  - OMP RPC frames are untrusted child-process output: tolerant line-JSON
    parsing, unknown frame kinds rendered inert, no shell interpolation,
    hidden spawn via `process_helpers::hidden_command`.
  - `.basebuild/preferences.md` writes go through the existing
    file-modification approval gateway; never silent.
  - Milestone auto-commit is opt-in, default off, and operates only inside
    run worktrees (Invariant 5); merge/prune/PR actions are confirm-gated.
  - Notifications persist locally only; no network upload (Invariant 4).
- **Coordination**: requires `parallel-plan-workspaces` archived (its
  `plan-chat-assignment` / `parallel-workspaces` / `run-concurrency-limits`
  specs become canonical bases). Uses current status vocabulary; coordinates
  with `plan-status-rename` (`openspec → planned`) whenever that lands.
  `planning-file-ingestion` / `plan-import` feed the same catalog the flow
  board reads — compatible, no overlap. `harness-subagents` stays the owner
  of subagent execution.
