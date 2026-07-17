# OpenSpec Workflow

Basebuild uses [OpenSpec](https://github.com/Fission-AI/OpenSpec) for planned
changes. Changes live in `openspec/changes/<change-name>/`.

## OpenSpec runtime management

OpenSpec is a first-class planning engine. Its runtime health is managed from
**Settings → OpenSpec**, which detects the `openspec` executable, reports
version/path/schema, validates project readiness (`openspec/` directory), and
provides install/update affordances (stubs until a distribution source is
configured). Plans that use `engine: openspec` are gated: if the runtime is
`missing` or `error`, the PlanPanel and PlanningInspector show a setup-required
card linking to Settings → OpenSpec and block promotion/launch.

## Plan promotion

Approved ideas create independent plans in `draft`. **Generate OpenSpec** runs
the backend `GenerateOpenspec` pipeline stage with the selected planner model;
proposal, specs, design, tasks, and `.openspec.yaml` are written atomically and
validated before the plan changes to `openspec`. Failure leaves the plan in
`draft` and surfaces the error. **Approve plan** then validates artifact
completeness, dependency readiness, and execution settings before moving the
plan to `ready`. Planner routing is distinct from the coding model used by the
eventual run.

## Assessment and execution routing

Promotion records a bounded planning assessment: scope, expected duration,
difficulty, uncertainty, risk, parallelism, and confidence. The local execution
advisor combines that assessment with available provider/model capabilities,
coarse fresh/stale capacity evidence, and versioned public profile data. Hard
gates remove incompatible routes before scoring. Recommendations show planner
and coder alternatives, exclusions, factor explanations, evidence freshness,
and confidence. They are advisory only; an explicit user override wins and is
persisted for that provider/model pair.

The read-only `get_execution_advice` tool exposes only the assessment, route
ids, capability flags, coarse capacity bands, public-profile references, and
explanations. It never serializes credentials, account ids, project text,
source, paths, messages, answers, raw usage, diffs, or logs. Delivery to an
external model preserves `allowExternalContext`. Optional recommendation
feedback is independently off by default, fixed-field/no-free-text, inspectable,
exportable, deletable, and upload-gated by both analytics upload and feedback
consent.

## Starting a change

Use the `/propose` skill:

```
/propose
```

This creates:
- `proposal.md` — why and what
- `specs/<capability>/spec.md` — requirements and scenarios
- `design.md` — technical approach (if needed)
- `tasks.md` — implementation checklist

## Applying a change

Use the `/apply` skill:

```
/apply
```

This works through `tasks.md` one checkbox at a time. Mark each `[x]`
immediately after completing it. Update specs and design if you discover
something that needs changing.


## Plan/run lifecycle authority

`PlanLifecycleService` is the only writer for assignment, kickoff
started/failed, chat running/needs-input/idle/interrupted, stop, review,
completion, cancellation, and restart transitions. A question or approval parks
the owning run without losing its retained chat. Idle with complete tasks
finishes the plan; idle with incomplete tasks produces
`awaiting_review`/`needs_continuation` and returns the plan to `ready`.

Panel close is presentation-only. Permanent deletion of a run-owned chat
requires explicit cancel/keep/reassign resolution. Startup and plan/run/queue
boundaries reconcile contradictory persisted rows idempotently, record
provenance, and preserve terminal history. Background agents, Runs, Flow counts,
and next actions read those backend snapshots; no frontend component infers
live work from a plan status alone.

## Change catalog UI

The Planning Inspector's **Changes** tab lists all OpenSpec changes in
`openspec/changes/`. Each entry shows:

- **Artifact chips** (P/D/T/S) — presence of proposal, design, tasks, specs.
- **Progress bar** — `n/m` tasks complete from `tasks.md`.
- **Link/unlink to plan** — binds a change to a plan for run-end checklist
  evaluation. A change can only link to one plan at a time; unlinking is
  refused while the plan is running or ready.
- **Archive** — moves the change to `openspec/changes/archive/` and records the
  linked terminal plan as archived so it leaves active Done/Finished views.
  The plan row, chat, and worktree remain intact. The action is confirm-gated
  via `ConfirmDialog`, not `window.confirm`, and emits a planning refresh event.
  Archive is offered as the next action only for a terminal linked plan whose
  task checklist is complete; otherwise the UI shows the exact blocking reason.

Task checkboxes in `tasks.md` can be toggled directly from the catalog —
clicking a task calls `openspec_toggle_task` which rewrites the file. Progress
is polled every 5 seconds via `openspec_refresh_task_progress` which emits a
`TaskProgressChanged` event only when counts change.
## Archiving a change

Use the `/archive` skill when **all** tasks in `tasks.md` are `[x]`. This
merges delta specs into `openspec/specs/` and moves the folder to
`openspec/changes/archive/<date>-<name>/`. Do not leave completed changes in
`openspec/changes/`; archive them in the same session that completes the last
task. Refresh the local roadmap status table with
`node scripts/openspec-status.mjs --write` and update its archive narrative so
the local planning workspace remains coherent.

## Rules

- Every requirement MUST have at least one `#### Scenario:`.
- Scenarios use 4 hashtags exactly. Using 3 fails silently.
- Specs define WHAT the system should do, not HOW.
- Tasks should be small enough to complete in one session.
- Check `openspec/specs/` for existing capabilities before creating new ones.
- The `openspec/changes/` directory is the source of truth for in-progress work.
- `openspec/config.yaml` has project context that is injected into all artifacts.

## Local-only storage

`openspec/` is local workspace state. The repository's `.gitignore` excludes
the entire directory, so proposals, specs, tasks, archives, config, and
`ROADMAP.md` MUST NOT be staged, committed, pushed, attached to a PR, or relied
on as remote project history.

- `openspec/ROADMAP.md` remains the local execution queue: what is in flight,
  what is next, what needs re-scoping, and locally proposed plans.
- After a local proposal, task update, re-scope, or archive, refresh the local
  status table when useful:

```bash
node scripts/openspec-status.mjs --write
```

- Keep the local roadmap narrative consistent with the generated table, but do
  not include either file in a commit.
- Summarize user-visible behavior and durable engineering rules in tracked code
  and tracked documentation; do not make repository correctness depend on a
  developer's local OpenSpec files.
- Do not pre-generate artifacts for proposed plans whose dependencies are still
  in flight; generate them with `/propose` when their turn comes.
