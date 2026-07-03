# Proposal: Diff Review Workflow

## Why

The plan run queue will let agents change many files across many plans, in parallel. Without a review surface, checking what a run actually did means manual `git diff` archaeology per run — and the final-touches commit/PR steps would ship unreviewed changes. Trust in the whole pipeline depends on one-click review of each run's changeset.

## What Changes

- Record a git baseline snapshot when a plan run starts (native or OMP terminal), without touching the working tree or index.
- Track the run's changeset: files added/modified/deleted relative to the baseline, attributed to that run.
- Add a review surface: per-file diffs against the baseline, approve / revert / send-back-to-chat per file, approve-all, revert-all. Revert is file-level (restore baseline blob; delete files the run created).
- Gate queued plan runs: final-touches steps that write (commit, pull request) run only after the changeset is reviewed (all files approved) or the user explicitly skips review. Ad-hoc chat sessions get the review surface but no gate.
- Graceful degradation on non-git projects: changeset tracking disabled with a visible notice; queue gate auto-skips.
- **Depends on** `native-agent-loop` (runs that change files) and `plan-pipeline-harness` (run queue, final touches, worktrees).

## Capabilities

### New Capabilities

- `run-changeset-tracking` — baseline snapshots and per-run file change attribution.
- `diff-review-surface` — per-file diff review UI with approve/revert/send-back actions.
- `review-completion-gate` — review-or-skip requirement before write-side final touches on queued runs.

### Modified Capabilities

- None. Checked `openspec/specs/`: no existing capability covers run changesets or review gating; `plan-final-touches` (unarchived, in `plan-pipeline-harness`) gains an ordering dependency documented there at integration time, not a requirement change here.

## Impact

- `src-tauri/src/services/`: new `changeset_service.rs` (baseline refs, diff computation, file revert); `git_service.rs` (blob restore, untracked enumeration); `plan_runner_service.rs` (baseline hook at run start, gate before write steps).
- `src-tauri/src/commands/` + `src/lib/changesets.ts` thin wrappers.
- `src/components/`: review surface in `SourcePanel.tsx` or a run-scoped review panel; run cards link to their changeset; `globals.css`.
- SQLite: `run_changesets` table (run id, baseline ref, file states, review states).
- Docs: `docs/agents/agent-runtime.md`, `docs/agents/desktop-shell.md`.
