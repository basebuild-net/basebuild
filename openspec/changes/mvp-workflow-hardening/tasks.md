# Tasks: mvp-workflow-hardening

Gates satisfied 2026-07-07: `planning-command-center`, `planning-cockpit`, and
`panel-grid-state-reliability` are archived; command-center tasks 6.4/6.5 were
absorbed by planning-cockpit before archive. Land restore work after
`chat-history-persistence`, provider/tool routing after
`provider-parity-workspace-fixes`, and subagent execution after
`harness-subagents`. `mvp.md` is the acceptance checklist.

Ownership map:
- Restore/session/panel activation: this change owns `AppShell`, project
  commands/storage focus state, workspace restore, and MVP restart tests; defer
  chat history pagination internals to `chat-history-persistence`.
- Provider/tool routing: this change owns planning action destination routing
  and visible repair states; defer provider transport/catalog parity to
  `provider-parity-workspace-fixes`.
- Worker coordination: this change owns launch profile, dependency graph,
  claims ledger, run board, and merge-review queue; defer subagent spawning
  mechanics to `harness-subagents`.
- Compact shell/invariants: this change owns viewport-clamped popovers,
  960×640 context affordances, inline-style cleanup, invariant checks, and MVP
  visual baselines.

## 1. Baseline and ownership

- [x] 1.1 Archive the two completed changes and refresh the roadmap narrative;
      reconcile the remaining command-center tasks without duplicating them.
- [x] 1.2 Add the deterministic MVP fixture and record baseline desktop logs,
      screenshots, interaction timings, and failing restart/compact tests.
- [x] 1.3 Assign overlapping files/capabilities to the gated changes and rebase
      this change after each owner lands.

## 2. Atomic project activation

- [x] 2.1 Add backend `get/set_last_focused_project`; update focus on every
      successful selection (not only folder add), with storage unit tests.
- [x] 2.2 Implement a generation-guarded activation coordinator covering
      detection, restore, last session/chat/panel, planning counts, and model
- [x] 2.3 Render a project loading/error boundary within 100 ms; hide old-project
      content, show subsystem progress/retry, and ignore late prior responses.
- [x] 2.4 Make the native folder picker single-flight across all entry points and
      disable/relabel triggers until it resolves.
- [x] 2.5 Regression tests: select project C → restart restores C + last chat and
      panel; rapid A→B→C settles only C; partial failure has no stale model/counts;
      repeated folder clicks create one dialog; ordinary switches produce no
      false orphan warnings or duplicate config loads.

## 3. Compact shell and UI invariants
- [x] 3.1 Replace account/menu coordinates with reusable viewport-clamped
      popovers; verify mouse, keyboard, 125%/150% scale, and all viewport edges.
- [x] 3.2 Compact chat/environment headers at 960×640 while keeping project,
      branch/worktree, assigned plan, model, and run state reachable.
- [x] 3.3 Remove repository inline-style debt into documented `globals.css`
      classes; preserve 0px radius and add titles to missing interactions.
- [x] 3.4 Add CI invariant checks for extra stylesheets, inline styles, non-zero
      radius, and interactive elements without `title=`; document reviewed
      computed-geometry exceptions.
- [x] 3.5 Playwright visual/interaction snapshots at 960×640 and 1280×800 for
      shell, account menu, planning board, picker/dialogs, and 1/2/4 chat panels.

## 4. Questionnaire-first schematic and ideation

- [x] 4.1 Replace schematic/category/idea `openOrFocusChat` paths with one typed,
      destination-aware planning action router and exactly-once `send` delivery.
- [x] 4.2 Verify repository read + `ask_user` capability before delivery; choose a
      compatible coordinator or show a model/provider/tool repair card.
- [ ] 4.3 Make category and idea generation visible: close or demote the planning
      modal, focus the named destination, render question cards, and refresh
      persisted results/counts on completion.
- [ ] 4.4 Add feedback/regenerate/batch-select loops with no required prompt
      typing and consistent header/flow/catalog counts.
- [ ] 4.5 Tests: repo-prefilled schematic cards, approve-before-write, provider
      failure recovery, categories→ideas multi-round flow, cancelled destination,
      and no dropped/double/prose-only question.

## 5. Plan readiness controls

- [ ] 5.1 Add a promotion/revision form for engine, provider/model/effort, skill,
      artifact destination, and project defaults; show detected OpenSpec/native
      engines and skill source.
- [ ] 5.2 Validate proposal/design/spec/tasks completeness, scenario syntax,
      dependencies, affected paths, verification commands, and status before
      approval can transition a plan to `ready`.
- [ ] 5.3 Route feedback to artifact revision, retain versions/diff, and require a
      fresh validation pass after changes.
- [ ] 5.4 Assignment to an existing/new chat passes the immutable validated
      artifact bundle and chosen launch profile, then creates a queued/running
      run rather than a status-only transition.

## 6. Dependency-aware workers and merge queue

- [ ] 6.1 Add plan priority, prerequisites, declared affected paths, and inferred
      overlap service/model/API with cycle and stale-plan validation.
- [ ] 6.2 Add launch-time worker count, effective provider cap, workspace policy,
      and safe/YOLO scheduling controls with a complete confirmation summary.
- [ ] 6.3 Implement safe dispatcher ordering and live file claims; queue/block
      conflicts, surface reasons, and re-evaluate when claims/progress change.
- [ ] 6.4 Add the shared run board for plan, priority, prerequisites, owner chat,
      provider/model/skill, branch/worktree, claims, progress, blockers, and
      merge readiness. Every state transition emits a debug log/event.
- [ ] 6.5 Show the same project/workspace/branch/plan/run context in each chat
      header; sequential fallback and non-Git limitations are explicit.
- [ ] 6.6 Feed completed workers into a dependency-aware merge-review queue using
      artifacts and diff claims; YOLO conflicts require review and all
      commit/PR/merge/prune operations retain explicit confirmation.
- [ ] 6.7 Tests: 4 workers with provider cap 2, prerequisite chain, disjoint pair,
      initial and late collision, safe serialization, YOLO confirmation, failed
      worker recovery, and ordered merge review.

## 7. MVP harness, performance, and docs

- [ ] 7.1 Add the full golden-path e2e: folder → schematic cards → categories →
      ideas → plan/artifacts → approval → assignment → queued workers → progress
      → merge-review readiness, with mocked deterministic providers/Git.
- [ ] 7.2 Add restart/focus and partial-failure desktop smoke plus a 60-second
      streaming/project-switch/panel-resize run; assert zero freeze report,
      duplicate activation, false orphan warning, and unhandled error.
- [ ] 7.3 Enforce performance budgets: feedback/loading paint ≤100 ms, fixture
      activation usable ≤1 s, and the initial renderer chunk below 500 kB
      minified by lazy-loading heavy planning/catalog/settings surfaces; capture
      diagnostics on regression.
- [ ] 7.4 Update `DESIGN.md`, desktop-shell/agent-runtime/testing/workflow docs,
      and keep `mvp.md` aligned with shipped behavior.
- [ ] 7.5 Run `npx tsc --noEmit`, `npm run build`, `cargo check`, `cargo test`, and
      `BASEBUILD_E2E=1 npm run test:e2e`; perform live 960×640 + 1280×800 desktop
      smoke with screenshots.
- [ ] 7.6 Run `node scripts/openspec-status.mjs --write` and manually reconcile
      roadmap gates/status/archive narrative.
