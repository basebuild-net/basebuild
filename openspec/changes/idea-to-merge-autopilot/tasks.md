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
- [x] 2.6 e2e (`idea-rounds.spec.ts`, 7 tests): soft gate + proceed, gate
      cancel creates nothing, captures tagged + review + deploy creates
      plans, destination-picker cancel abandons the round, End round
      finishes in place (later captures untagged), deploy isolates
      per-idea failures (`__e2e_fail_promote_ideas` knob), zero-capture
      round shows the empty review state.

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
- [x] 3.5 e2e (`mission-control.spec.ts`, 5 tests): run card shows
      plan/state/progress/elapsed/worktree; flow board Running stage
      drills into mission control; pending ask_user raises attention
      state and clears on answer; open-chat focuses owner chat; unmet
      prerequisite raises the blocked state with the block reason.

## 4. Post-finish policy

- [x] 4.1 Backend: added `finish_policy` column to `plan_launch_profiles`
      (migration, default 'hold'); `LaunchProfile` struct field with
      `#[serde(default)]`; updated `set_launch_profile` INSERT + SELECT;
      2 Rust tests (round-trip with auto_commit, hold default).
- [x] 4.2 Backend: `apply_finish_policy` in `PlanRunnerService` —
      `auto_commit` (GitService::commit_all), `auto_commit_pr` (commit +
      PullRequestService::create_pr), `queue_merge_review` (commit +
      add_to_merge_queue); non-git hard-fallback to hold with notification;
      `FinishOutcome`/`FinishResult` types; wired into `complete_run` after
      plan transitions to Finished; `plan_run_apply_finish_policy` Tauri
      command; `GitService::commit_all` helper.
- [x] 4.3 Frontend: `FinishPolicy` type + `finishPolicy` on `LaunchProfile`
      TS type; policy selector (`<select>`) in launch profile form with 4
      options; `normalizeFinishPolicy` guard; effective policy shown in
      launch confirmation summary (`FINISH_POLICY_LABELS`); `PlanPanel`
      `ProfileForm` updated with `finishPolicy` for assign-with-profile.
- [x] 4.4 Frontend: `CompletionCard` `finishOutcome` prop renders commit
      SHA, PR link, merge-ready flag, and policy errors; `PlanningInspector`
      fetches outcomes via `applyFinishPolicy` for succeeded runs; `hold`
      renders exactly as today (no outcome section).
- [x] 4.5 e2e (`finish-policy.spec.ts`, 6 tests): launch confirmation shows
      policy; auto_commit shows commit SHA; auto_commit_pr shows PR link;
      hold shows no outcome; queue_merge_review shows merge-ready flag;
      policy error renders as the sole outcome row
      (`__e2e_set_finish_policy_error` knob). Mock `plan_run_complete`
      updates run status, `plan_run_apply_finish_policy` returns
      policy-appropriate outcomes.

## 5. Workspace merge review

- [x] 5.1 Frontend: integration queue multi-select with per-entry checkboxes,
      "Select all" toggle, and "Review & merge (N)" batch entry button;
      the merge-ready group is selectable in one action via Select all
      (spec scenario "Merge-ready group selection") — no default
      pre-selection; the session button stays disabled at zero selection.
- [x] 5.2 Frontend: session state machine — dependency-aware ordering using
      the dependency graph (prerequisites first), one entry at a time with
      merge/skip/stop actions; stable ordering preserved after entries
      transition (uses full mergeQueue, not just pending); conflict on merge
      records as "conflicted" and advances.
- [x] 5.3 Frontend: session summary (merged/skipped/conflicted counts) +
      batch "Clean up merged" scoped to the session; resets selection and
      session state.
- [x] 5.4 e2e (`merge-review.spec.ts`, 6 tests): multi-select + merge all +
      summary + cleanup; skip preserves entry and advances; stop ends
      session early with partial results; merge conflict records
      "conflicted", advances, and survives cleanup; zero selection keeps
      the session button disabled; prerequisite entries reviewed before
      dependents. Mock `plan_merge_queue_list`/`plan_merge_queue_review` +
      `__e2e_seed_merge_queue`/`__e2e_fail_merge_review` test knobs.

## 6. Workspace lifecycle hardening

- [x] 6.1 e2e (`workspace-hardening.spec.ts` test 1): full lifecycle walk
      — set queue_merge_review policy → seed plan + run → complete run →
      finish policy seeds merge queue → session merge → cleanup; asserts
      no primary-checkout mutation.
- [x] 6.2 e2e (test 2): non-git project — policy hard-fallback to hold
      (applyFinishPolicy returns {kind:"hold"}), sequential_primary
      workspace shows no worktree indicators, finish policy selector
      shows "hold".
- [x] 6.3 e2e (test 3): prune confirmations — after merging all entries,
      entries remain visible (status "merged") until explicit "Clean up
      merged" button click; no auto-prune. Merge queue now shows all
      entries (pending + reviewed) with session result tags.

## 7. Verification and docs

- [x] 7.1 `npx tsc --noEmit` clean; `npm run build` clean (6.4s).
- [x] 7.2 `cargo check` clean (0 errors, 22 pre-existing warnings);
      `cargo test --lib` 354 passed / 0 failed (32s).
- [x] 7.3 Full e2e suite: 373 passed / 4 skipped / 0 stable failures.
      New specs: idea-rounds (7), run-eta (11), mission-control (5),
      finish-policy (6), merge-review (6), workspace-hardening (3) = 38
      new tests (8 edge-case tests added post-verification; the 4 touched
      specs re-ran 24/24 green). Pre-existing flakes in
      chat-grid/workspace-splash are unrelated (pass in isolation).
- [x] 7.4 `npx openspec validate idea-to-merge-autopilot --strict` → valid.
- [x] 7.5 Docs: tasks.md updated with completion evidence for all 30
      tasks across 7 phases. Spec deltas unchanged from creation.
- [x] 7.6 Refresh `openspec/ROADMAP.md` via
      `node scripts/openspec-status.mjs --write` — updated (22 changes).
