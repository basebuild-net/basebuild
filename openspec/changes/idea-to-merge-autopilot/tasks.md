# Tasks: Idea-to-Merge Autopilot

## 1. Live baseline audit

- [ ] 1.1 Run the dev app and walk the full golden path on a real project
      (schematic → round-equivalent generation → promote → launch → run →
      finish → queue → merge → prune), recording per-stage findings
      (working / broken / missing) in `openspec/changes/idea-to-merge-autopilot/audit.md`.
      Surface evidence only — `mvp.md` checkboxes remain human-owned.
- [ ] 1.2 Reconcile findings against this change's specs: adjust task scope
      below where the audit shows a stage is already broken upstream (file
      follow-up fixes rather than building on broken ground).

## 2. Idea rounds

- [ ] 2.1 Backend: confirm generation batch id persists on ideas end-to-end
      (capture tool → row → reload); add round-scoped list query
      (`ideas by batch id`) + Tauri command if not already expressible.
- [ ] 2.2 Frontend: "Generate ideas" one-click entry on the planning surface
      and command strip — assembles the zero-input round via the existing
      grounded generation path; schematic soft gate honored.
- [ ] 2.3 Frontend: round review surface — round's ideas with grounding,
      anchor/outside-focus flag, category; multi-select; per-idea
      reject/keep actions.
- [ ] 2.4 Frontend: Deploy selected — chain batch promote + batch-launch
      destination mapping behind one confirmation enumerating plans, chats,
      worktrees/branches, provider/model; per-item failure isolation.
- [ ] 2.5 Frontend: round history list (timestamp, outcome counts) + reopen
      filtered by batch id.
- [ ] 2.6 e2e: round runs zero-input and tags ideas; deploy creates plans and
      dispatches runs (mocked); decline creates nothing; partial failure
      reported per idea.

## 3. Run mission control

- [ ] 3.1 Frontend: `src/lib/runEta.ts` — task-velocity estimator (median
      inter-tick interval, ≥2 ticks, remaining-task projection) with unit
      tests covering sparse ticks, zero ticks, and terminal runs.
- [ ] 3.2 Frontend: mission control board (lazy-loaded) — one card per
      queued/running/blocked/awaiting-review/unintegrated run: plan ref +
      title, owner chat focus action, branch/worktree, `n/m` progress bar,
      elapsed, blockers; fed from planning events + run board data.
- [ ] 3.3 Frontend: attention states on cards (pending approval, pending
      ask_user, mark-as-complete, merge-ready) with direct navigation;
      consistency with sidebar agent-status dots.
- [ ] 3.4 Frontend: wire completion estimate + "estimating" + actual-duration
      terminal state into the cards; flow board Runs stage links into the
      board.
- [ ] 3.5 e2e: two mocked runs render cards with progress; queued distinct;
      attention chip appears for an injected ask_user and clears on answer;
      estimate appears after simulated ticks and never before.

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
