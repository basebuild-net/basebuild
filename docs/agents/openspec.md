# OpenSpec Workflow

Basebuild uses [OpenSpec](https://github.com/Fission-AI/OpenSpec) for planned
changes. Changes live in `openspec/changes/<change-name>/`.

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


## Change catalog UI

The Planning Inspector's **Changes** tab lists all OpenSpec changes in
`openspec/changes/`. Each entry shows:

- **Artifact chips** (P/D/T/S) — presence of proposal, design, tasks, specs.
- **Progress bar** — `n/m` tasks complete from `tasks.md`.
- **Link/unlink to plan** — binds a change to a plan for run-end checklist
  evaluation. A change can only link to one plan at a time; unlinking is
  refused while the plan is running or ready.
- **Archive** — moves the change to `openspec/changes/archive/` (confirm-gated
  via `ConfirmDialog`, not `window.confirm`).

Task checkboxes in `tasks.md` can be toggled directly from the catalog —
clicking a task calls `openspec_toggle_task` which rewrites the file. Progress
is polled every 5 seconds via `openspec_refresh_task_progress` which emits a
`TaskProgressChanged` event only when counts change.
## Archiving a change

Use the `/archive` skill when **all** tasks in `tasks.md` are `[x]`. This
merges delta specs into `openspec/specs/` and moves the folder to
`openspec/changes/archive/<date>-<name>/`. Do not leave completed changes in
`openspec/changes/` — archive in the same session that completes the last
task. The roadmap status table + narrative MUST reflect the archive in the
same commit (run `node scripts/openspec-status.mjs --write` and update the
"Merged — awaiting archive" / archive history sections).

## Rules

- Every requirement MUST have at least one `#### Scenario:`.
- Scenarios use 4 hashtags exactly. Using 3 fails silently.
- Specs define WHAT the system should do, not HOW.
- Tasks should be small enough to complete in one session.
- Check `openspec/specs/` for existing capabilities before creating new ones.
- The `openspec/changes/` directory is the source of truth for in-progress work.
- `openspec/config.yaml` has project context that is injected into all artifacts.

## Tracking and remote sync

`openspec/` is committed and pushed — it is the source of truth for planned
work, so plans survive machine changes and are reviewable in PRs.

- `openspec/ROADMAP.md` is the execution queue: what's in flight, what's next,
  what needs re-scoping, and proposed plans that have no artifacts yet.
- **MUST, same commit** (AGENTS.md Invariant 12): any edit under
  `openspec/changes/**` — checkbox flip, new proposal, re-scope, or archive —
  is accompanied by:

```bash
node scripts/openspec-status.mjs --write
```

  plus a manual pass over the ROADMAP narrative sections (Now / Merged —
  awaiting archive / Next / Proposed) so dependency gates and merge state match
  reality. The script only refreshes the status table; the narrative is yours.
- A PR that completes a change MUST move that change's roadmap entry and cite
  the PR number.
- Do not pre-generate artifacts for proposed plans whose dependencies are still
  in flight; generate them with `/propose` when their turn comes.
