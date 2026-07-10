# Tasks: Idea-to-Merge Autopilot

## 1. Live baseline audit

- [x] 1.1 Run the dev app and walk the full golden path on a real project
      (schematic → round-equivalent generation → promote → launch → run →
      finish → queue → merge → prune), recording per-stage findings
      (working / broken / missing) in `openspec/changes/idea-to-merge-autopilot/audit.md`.
      Surface evidence only — `mvp.md` checkboxes remain human-owned.
- [x] 1.2 Reconcile findings against this change's specs: adjust task scope
      below where the audit shows a stage is already broken upstream (file
      follow-up fixes rather than building on broken ground).

## 2. Idea rounds

- [x] 2.1 Backend: batch id did NOT exist (design assumption corrected) —
      added `ideas.batch_id` migration + model field + `create_idea`
      plumbing across all four capture paths; rounds persist as
      `pipeline_runs` (`kind='idea_round'`) via new `idea_round_service`
      (LazyLock active-round registry) + `start/finish/list_idea_rounds`
      commands. Fixed pre-existing Idea wire-format bug (snake_case vs
      camelCase TS type). Rust tests: lifecycle, replacement, tagging.
- [x] 2.2 Frontend: "Generate ideas" round entry wired on the flow-board
      command center (replacing the dead nav-only stub) and the Ideas tab
      empty state; `IdeaRoundGate` implements the soft gate (warn + open
      wizard + proceed anyway — replacing the silent redirect).
- [x] 2.3 Frontend: `IdeaRoundsSection` — round review with grounding,
      outside-focus flag, status, multi-select, End round for running
      rounds.
- [x] 2.4 Frontend: Deploy selected — batch promote behind one enumerated
      confirmation with per-idea failure isolation; lands on the Plans
      stage. (Scope note: launch-into-chats stays owned by the existing
      ready-stage batch launch — plans must pass the OpenSpec → ready gate
      first; the spec scenario was corrected to match the plan lifecycle.)
- [x] 2.5 Frontend: round history rows (timestamp, status, live outcome
      counts) with expand-to-review filtered by batch id.
- [x] 2.6 e2e (`idea-rounds.spec.ts`, 4 tests): soft gate + proceed, gate
      cancel creates nothing, captures tagged + review + deploy creates
      plans, destination-picker cancel abandons the round.

## 3. Run mission control

- [x] 3.1 Frontend: `src/lib/runEta.ts` — median inter-tick interval
      estimator with `estimateEta` (none/estimating/estimate states),
      `formatEtaMs`, `formatElapsedMs`; 11 unit tests in
      `tests/e2e/run-eta.spec.ts` covering sparse ticks, zero ticks,
      terminal runs, and formatting edge cases.
- [x] 3.2 Frontend: `MissionControlBoard` (`src/components/layout/`)
      — one card per run with plan ref + title, owner-chat focus action,
      worktree path, `n/m` progress bar, elapsed timer, blockers from
      dependency graph; fed from `listPlanRuns` + `getDependencyGraph` +
      `openspecTaskProgress` polling (5s); wired into PlanningInspector
      Runs tab with `chatPanels` mapping from AppShell.
- [x] 3.3 Frontend: attention states on cards — `waiting_on_answer`
      (pending ask_user via `usePanelStatus`), `blocked` (dependency
      blockers/collisions), `running` (live), `queued`, `finished`;
      attention chip with focus-chat action; consistent with sidebar
      agent-status mapping.
- [x] 3.4 Frontend: tick-based ETA estimation (`estimateEta` with
      ≥2-tick threshold → "estimating" → concrete estimate); flow board
      Running stage card drills into Runs tab via `onStageClick` on
      `PlanningCommandCenter`.
- [x] 3.5 e2e (`mission-control.spec.ts`, 4 tests): run card shows
      plan/state/progress/elapsed/worktree; flow board Running stage
      drills into mission control; pending ask_user raises attention
      state and clears on answer; open-chat focuses owner chat.

## 4. Post-finish policy

- [ ] 4.1 Backend: extend the launch-profile storage row + service with
      `finish_policy` (`hold` default; absent = hold); expose via existing
      get/save commands; Rust tests for round-trip + default.
- [ ] 4.2 Backend: apply policy in the plan run service finish transition —
      `auto_commit` (worktree-scoped commit, generated plan-referencing
      message), `auto_commit_pr` (commit + existing push/PR path),
      `queue_merge_review` (commit + merge-ready flag); non-git/primary
      checkout hard-fallback to hold; notification + log per action; failure
      surfaces without retry. Rust tests per policy branch incl. fallback.
- [ ] 4.3 Frontend: policy selector in the launch/profile configuration
      surface with the one-time `auto_commit_pr` remote acknowledgment;
      effective policy shown in launch confirmations.
- [ ] 4.4 Frontend: completion card policy-awareness — reflect automated
      outcomes (commit sha, PR link, merge-ready flag) and policy-failure
      notes; `hold` renders exactly as today.
- [ ] 4.5 e2e: launch confirmation shows policy; mocked finish under each
      policy shows the correct card outcome; non-git fallback note renders.

## 5. Workspace merge review

- [ ] 5.1 Frontend: integration queue multi-select + "Review & merge" entry;
      merge-ready group pre-selection.
- [ ] 5.2 Frontend: session state machine — dependency-aware ordering (reuse
      dependency graph/collision data), one run at a time with refreshed
      ahead/behind on presentation, actions: review diff (changed-file
      summary now; `diff-review-workflow` surface when it lands), merge
      (existing confirm-gated command, conflict-abort preserved), skip, stop.
- [ ] 5.3 Frontend: session summary (merged/skipped/conflicted + verification
      outcomes) + batch "clean up merged" scoped to the session via the
      existing confirm-gated cleanup.
- [ ] 5.4 e2e: two-run session in dependency order (mocked); conflict on one
      run records and advances; skip preserves; summary + scoped cleanup.

## 6. Workspace lifecycle hardening

- [ ] 6.1 e2e: full lifecycle walk on mocks — provision on launch → run →
      finish under `queue_merge_review` → queue flag → session merge →
      batch prune; assert no primary-checkout mutation at any step.
- [ ] 6.2 e2e: non-git project walk — sequential fallback labeling, no
      worktree/branch indicators, policy hard-fallback to hold, no PR
      recommendation.
- [ ] 6.3 Audit prune/force-cleanup confirmations against
      `parallel-workspaces` + `plan-merge-cleanup` scenarios; close gaps
      found (uncommitted-work force warning, branch retention after prune).

## 7. Verification and docs

- [ ] 7.1 `npx tsc --noEmit` and `npm run build` pass.
- [ ] 7.2 `cargo check` and `cargo test` pass.
- [ ] 7.3 `npm run test:e2e` passes including all new specs;
      `npm run check:ui-invariants` passes.
- [ ] 7.4 `npx openspec validate idea-to-merge-autopilot --strict` passes.
- [ ] 7.5 Docs: update `docs/agents/workflow.md` / `docs/agents/openspec.md`
      and `DESIGN.md` where the new surfaces change behavior; note the
      policy consent model in `docs/agents/agent-runtime.md`.
- [ ] 7.6 Refresh `openspec/ROADMAP.md` via
      `node scripts/openspec-status.mjs --write`.
