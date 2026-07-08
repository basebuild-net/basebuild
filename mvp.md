# Basebuild MVP Workflow

This is the acceptance checklist for Basebuild's first complete user journey.
The MVP is not “the controls exist”; it is the whole loop working reliably with
minimal typing, clear state, and recoverable automation.

## Golden path

- [x] Open or add a project folder. Only one folder picker can be open.
- [x] Show a blocking project-loading surface while project-scoped sessions,
      panels, planning counts, provider/model state, and source state restore.
- [x] Restore the most recently focused project, chat, and panel after restart.
- [x] Create or update the Project Schematic through one-question-at-a-time
      cards: repository facts are prefilled, choices are clickable, feedback is
      accepted, and no file is written before approval.
- [x] Generate 3–8 grounded categories from the approved schematic, then let the
      user add, edit, remove, or regenerate them without writing a prompt.
- [x] Generate multiple grounded ideas for one or more categories, select ideas
      in bulk, provide feedback, and repeat a round with one click.
- [x] Browse every pending idea in one command center, grouped and filterable by
      category/status, with its grounding and next action visible.
- [ ] Promote one or more ideas to plans. Choose the planning engine (native or
      OpenSpec), model/provider/effort, and planning skill before generation.
- [ ] Generate and validate complete artifacts. Preview them, request changes,
      approve them, and transition the plan to `ready` only after validation.
- [ ] Assign a ready plan to an existing or new chat. The selected chat receives
      the artifacts once and starts or queues the run rather than only changing
      status.
- [ ] Configure worker count and execution policy before launch: isolated
      worktree per worker, or sequential primary-workspace execution.
- [x] Show prerequisite, affected-path, and collision analysis before dispatch.
      Safe mode orders/blocks conflicts; explicit YOLO mode confirms the risks.
- [ ] Every worker reports through the shared run board (plan, priority,
      prerequisites, files claimed, branch, worktree, progress, blockers). This
      board—not free-form agent-to-agent chat—is the coordination source of truth.
- [ ] Every chat header always shows project, workspace/worktree, branch, model,
      assigned plan, and run state; narrow layouts may compact but not hide them.
- [x] Review worker diffs against their plan artifacts, resolve collisions in a
      dependency-aware merge queue, and keep commit/PR/merge/prune actions
      explicitly confirmed.

## Interaction and quality gates

- [x] No normal decision requires copying a letter or writing a command when a
      questionnaire, choice card, picker, or batch action can express it.
- [x] Loading, empty, offline, queued, blocked, partial-failure, and retry states
      are visually distinct and never expose stale content from another project.
- [x] Project switching gives immediate feedback and remains interactive; no
      unexplained blank canvas, layout shuffle, or orphan-recovery warning.
- [x] The shell, dialogs, account menu, planning board, and chat composer work at
      the supported minimum 960×640 and at 1280×800, including 125%/150% scale.
- [x] Account and context menus are viewport-clamped and keyboard reachable.
- [x] Common UI actions respond within 100 ms; the project loading surface paints
      within 100 ms; restored content is usable within 1 s on the smoke fixture.
- [x] A 60-second streaming/resize/project-switch smoke produces no freeze report
      and no duplicate project/session load or false orphan warning.
- [x] All interactions emit useful debug logs; duplicate handlers and skipped
      branches are visible without turning expected transitions into warnings.
- [x] UI invariants are automated: `globals.css` only, 0px radius, and `title=`
      tooltips on interactive elements. New inline styles fail CI.

## Live audit baseline — 2026-07-08 (updated 2026-07-07)

Tested with the Tauri dev build using the native desktop UI. Items below show
resolution status from the `mvp-workflow-hardening` change.

| Priority | Finding | Status |
|---|---|---|
| P0 | Schematic wizard is not questionnaire-first | **Fixed** — schematic/category/idea actions route through typed `PlanningAction` system (4.1-4.3). |
| P0 | Provider/model routing breaks the first-run path | **Fixed** — capability check extended to require `supportsTools` (4.2). |
| P0 | Category generation is a dead-end | **Fixed** — generation visible, modal closes on delivery, destination picker shown (4.3). |
| P0 | Last focus is not restored | **Fixed** — `get/set_last_focused_project` backend + restore guard (2.1, 2.2). |
| P1 | Project restore is not atomic | **Fixed** — generation-guarded activation coordinator + loading boundary (2.2, 2.3). |
| P1 | Restore guard is ineffective | **Fixed** — `projectRestoreLoading` set true on project change (2.3). |
| P1 | Project switching creates noisy/duplicate work | **Fixed** — orphan detection gated, panel grid cleared only on deselection (2.3). |
| P1 | Account dropdown overflows | **Fixed** — viewport-clamped popovers via `popover.ts` (3.1). |
| P1 | Folder picker is not single-flight | **Fixed** — single-flight picker with `pickerPromiseRef` (2.4). |
| P1 | Planning counts disagree | **Fixed** — planning modal closes on action delivery, counts refresh (4.3). |
| P2 | UI invariant debt is unguarded | **Fixed** — `scripts/check-ui-invariants.mjs` + all 43 violations fixed (3.4). |
| P2 | Worker controls are detached from launch | **In progress** — backend dependency graph/claims/merge queue done (6.1, 6.3, 6.6); launch controls UI in progress (6.2). |
| P2 | The renderer ships as one large main chunk | **Fixed** — lazy-loaded heavy modals/panels; initial chunk 389 kB (was 817 kB) (7.3). |
