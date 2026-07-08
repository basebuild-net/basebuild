# Basebuild MVP Workflow

This is the acceptance checklist for Basebuild's first complete user journey.
The MVP is not “the controls exist”; it is the whole loop working reliably with
minimal typing, clear state, and recoverable automation.

## Golden path

- [ ] Open or add a project folder. Only one folder picker can be open.
- [ ] Show a blocking project-loading surface while project-scoped sessions,
      panels, planning counts, provider/model state, and source state restore.
- [ ] Restore the most recently focused project, chat, and panel after restart.
- [ ] Create or update the Project Schematic through one-question-at-a-time
      cards: repository facts are prefilled, choices are clickable, feedback is
      accepted, and no file is written before approval.
- [ ] Generate 3–8 grounded categories from the approved schematic, then let the
      user add, edit, remove, or regenerate them without writing a prompt.
- [ ] Generate multiple grounded ideas for one or more categories, select ideas
      in bulk, provide feedback, and repeat a round with one click.
- [ ] Browse every pending idea in one command center, grouped and filterable by
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
- [ ] Show prerequisite, affected-path, and collision analysis before dispatch.
      Safe mode orders/blocks conflicts; explicit YOLO mode confirms the risks.
- [ ] Every worker reports through the shared run board (plan, priority,
      prerequisites, files claimed, branch, worktree, progress, blockers). This
      board—not free-form agent-to-agent chat—is the coordination source of truth.
- [ ] Every chat header always shows project, workspace/worktree, branch, model,
      assigned plan, and run state; narrow layouts may compact but not hide them.
- [ ] Review worker diffs against their plan artifacts, resolve collisions in a
      dependency-aware merge queue, and keep commit/PR/merge/prune actions
      explicitly confirmed.

## Interaction and quality gates

- [ ] No normal decision requires copying a letter or writing a command when a
      questionnaire, choice card, picker, or batch action can express it.
- [ ] Loading, empty, offline, queued, blocked, partial-failure, and retry states
      are visually distinct and never expose stale content from another project.
- [ ] Project switching gives immediate feedback and remains interactive; no
      unexplained blank canvas, layout shuffle, or orphan-recovery warning.
- [ ] The shell, dialogs, account menu, planning board, and chat composer work at
      the supported minimum 960×640 and at 1280×800, including 125%/150% scale.
- [ ] Account and context menus are viewport-clamped and keyboard reachable.
- [ ] Common UI actions respond within 100 ms; the project loading surface paints
      within 100 ms; restored content is usable within 1 s on the smoke fixture.
- [ ] A 60-second streaming/resize/project-switch smoke produces no freeze report
      and no duplicate project/session load or false orphan warning.
- [ ] All interactions emit useful debug logs; duplicate handlers and skipped
      branches are visible without turning expected transitions into warnings.
- [ ] UI invariants are automated: `globals.css` only, 0px radius, and `title=`
      tooltips on interactive elements. New inline styles fail CI.

## Live audit baseline — 2026-07-08

Tested with the Tauri dev build using the native desktop UI.

| Priority | Finding | Reproduction / evidence |
|---|---|---|
| P0 | Schematic wizard is not questionnaire-first | The generated chat reported that repository access and `ask_user` were unavailable, requested pasted repo files, and fell back to “Reply with No/Yes”. |
| P0 | Provider/model routing breaks the first-run path | The schematic turn surfaced `Provider 'anthropic' returned HTTP 404` before fallback. |
| P0 | Category generation is a dead-end | “Generate categories from project” logged `openOrFocusChat: focusing existing`, but left the planning modal in place and no prompt/card appeared in either visible chat after closing it. |
| P0 | Last focus is not restored | After selecting `who_to_hit_today`, closing, and reopening, Basebuild focused `basebuild-app` instead. `AppShell` selects `sidebar.projects[0]`; selection does not update `last_opened_at`. |
| P1 | Project restore is not atomic | During switching, stale/placeholder chat controls shuffled into the next project; after reopen the previous Anthropic model appeared under `basebuild-app` and the status bar said “No folder selected”. |
| P1 | Restore guard is ineffective | `projectRestoreLoading` starts false and is only set false; it is never set true when the project changes. |
| P1 | Project switching creates noisy/duplicate work | Logs showed repeated `Project deselected`, four `Chat config loading` events, and repeated `Orphaned session tabs recovered` warnings during ordinary switching. |
| P1 | Account dropdown overflows | The bottom-left menu rendered off the left edge. Its fixed-position calculation uses a right offset derived from a left-side trigger, forcing the 180px menu negative. |
| P1 | Folder picker is not single-flight | Re-entering the open-folder action produced five native “Open Basebuild project” dialogs; there is no in-flight guard. |
| P1 | Planning counts disagree | The header showed `Schematic 0`; the flow board reported `8/11 sections` and an attention count of 1 for the same project. |
| P2 | UI invariant debt is unguarded | Source audit found 65 React inline-style occurrences despite the one-stylesheet invariant, including the account dropdown and planning empty state. |
| P2 | Worker controls are detached from launch | Concurrency/subagent settings exist in Settings, but the flow/launch path does not present worker count, isolation policy, dependency/collision analysis, or a shared coordination view. |
| P2 | The renderer ships as one large main chunk | `npm run build` produced an 814.47 kB minified JavaScript chunk (222.42 kB gzip) and Vite's >500 kB warning; planning/catalog/settings surfaces are candidates for lazy loading. |

The implementation plan is `openspec/changes/mvp-workflow-hardening/`.
