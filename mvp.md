# Basebuild MVP Workflow

This is the acceptance checklist for Basebuild's first complete user journey.
The MVP is not "the controls exist"; it is the whole loop working reliably with
minimal typing, clear state, and recoverable automation.

> **Human sign-off required.** Every item below starts unchecked. Only a human
> who has personally verified the behavior in the running app may check an item
> off. Automated tools, agents, and AI may never check items on their own
> behalf — they may only surface evidence for a human to review. If you cannot
> confirm it yourself in the live app, leave it unchecked.
## Golden path

The accepted MVP loop is: `generate ideas → generate OpenSpec artifacts/full
implementation plans → process queue → final touches/merge/archive`, with
worktrees used when configured.

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
- [ ] Browse every pending idea in one visual command center with stage cards,
      live counts, status words/colors, progress bars, and obvious `+` actions.
- [ ] Promote one or more ideas to plans. Plans default to `engine: openspec`;
      artifact generation, apply, verify, and archive route through OpenSpec.
- [ ] Generate and validate complete OpenSpec artifacts. Preview them, request
      changes, approve them, and transition the plan to `ready` only after
      validation and OpenSpec runtime readiness.
- [ ] Assign a ready plan to an existing or new chat. The selected chat receives
      the artifacts once and starts or queues the run rather than only changing
      status. The opening prompt says "Do not create a second implementation
      plan."
- [ ] Configure worker count and execution policy before launch: isolated
      worktree per worker, or sequential primary-workspace execution.
- [ ] Show prerequisite, affected-path, and collision analysis before dispatch.
      Safe mode orders/blocks conflicts; explicit YOLO mode confirms the risks.
- [ ] Every worker reports through the shared run board (plan, priority,
      prerequisites, files claimed, branch, worktree, progress, blockers). This
      board—not free-form agent-to-agent chat—is the coordination source of truth.
- [ ] Every chat shows a context strip under the input with workspace id, branch,
      worktree, plan, progress, model, context-window usage, and queue state.
- [ ] Review worker diffs against their plan artifacts, resolve collisions in a
      dependency-aware merge queue, and keep commit/PR/merge/prune actions
      explicitly confirmed.
- [ ] Archive/sync completed OpenSpec changes after merge; the action previews
      affected specs and roadmap updates before applying.

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

Tested with the Tauri dev build using the native desktop UI. Items below show
the post-archive reality, not only task completion in
`mvp-workflow-hardening`. Remaining work is specified in
`openspec/changes/ai-workbench-course-correction/`.

| Priority | Finding | Status |
|---|---|---|
| P0 | Schematic wizard is not questionnaire-first | **Reopened** — Schematic now opens its correct dedicated modal, but the live skill turn still stops at a prose “gathering facts” message with no visible tools or question card. |
| P0 | Provider/model routing breaks the first-run path | **Fixed** — session selection restores, connected providers are first, models/effort are scoped, and the catalog's `supports_tools` field now reflects transport routing (bespoke/OMP-RPC kinds report `false`), so the frontend planning gate uses backend-owned effective capability truth instead of a duplicated api-kind allowlist. |
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

### Course-correction fixes landed on this branch

- [ ] Compact the duplicate top/chat context and prevent raw metadata overlap.
- [ ] Route Schematic to Project Schematic, Ideas to Ideas, and Plans to Plans.
- [ ] Remove the chat-level Ideas button and blank/manual Create plan affordance.
- [ ] Replace the frontend api-kind allowlist with backend-owned effective `supports_tools` (catalog + DB read path account for OMP-RPC transport).
- [ ] Keep effort choices within the selected model's supported efforts.
- [ ] Repair Settings columns and the wide Planning modal's blank/reflow failure.
- [ ] Render native and OMP planning work as one visible tool/question/activity timeline.
- [ ] Complete AI-only idea → artifacts → validation → approval → ready → chat assignment.
