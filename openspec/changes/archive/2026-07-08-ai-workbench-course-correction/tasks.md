# Tasks: AI Workbench Course Correction

## 1. Live-audit foundation (implemented on this branch)

- [x] 1.1 Remove the duplicate chat title/header row and render compact project,
      branch/worktree, plan, run, and model context without wrapping over controls
- [x] 1.2 Route Schematic to a dedicated Project Schematic modal
- [x] 1.3 Route Ideas and Plans stage buttons to their exact Planning tabs
- [x] 1.4 Remove the chat-level Ideas button and the Plans empty-state Create
      plan button
- [x] 1.5 Restore provider/model from the chat session, group connected providers
      first, scope models/effort to effective capabilities, and reject false
      tools support from bespoke transports
- [x] 1.6 Repair Settings to side-by-side navigation/content and repair modal
      planning reflow at wide container sizes
- [x] 1.7 Add exact-routing and compact-shell regression assertions
- [x] 1.8 Replace provider/model dropdowns with a two-pane catalog modal using
      a dense provider grid, green Connected and grey Available states, search,
      model counts, and capability badges
- [x] 1.9 Remove duplicate model/project/run-id/inactive-plan chips from the
      chat header and clarify top-level Changes, Files, New, and workspace labels

## 2. Change coordination

- [x] 2.1 Reconcile overlapping remaining tasks in `chat-first-shell`; document
      which are completed here, retained there, or explicitly superseded
- [x] 2.2 Consume `provider-parity-workspace-fixes` api-kind and auth truth;
      remove any duplicated frontend capability heuristics once available
- [x] 2.3 Update `mvp.md` from executable evidence so checked items reflect the
      current product rather than the previous change's task completion

## 3. Workbench shell and modal ownership

- [x] 3.1 Consolidate project/chat/context headers into one stable hierarchy
      with no duplicated titles or overlapping raw metadata
- [x] 3.2 Add non-null loading/error fallbacks for Schematic, Planning, Changes,
      Files, and Settings modal bodies
- [x] 3.3 Make every command-strip stage open its exact owned surface and retain
      the last selected subtab only where the user chose it
- [x] 3.4 Move Schematic wizard progress/questions into the Project Schematic
      modal; do not create a schematic workspace chat
- [x] 3.5 Verify keyboard focus trap/return, Escape, viewport clamping, and
      960x640/125%/150% layouts for all owned modals and popovers
- [x] 3.6 Inventory every toolbar/header/popover control with screenshot
      annotations; remove or relabel anything whose purpose is not obvious and
      apply the modal-versus-popover rule consistently
- [x] 3.7 Define semantic visual states across the app (connected/success green,
      unavailable/inactive grey, warning amber, error red, active selection
      orange) with text/icon redundancy and contrast checks

## 4. Truthful provider/model controls

- [x] 4.1 Replace frontend api-kind allowlists with catalog-provided effective
      capability fields and actionable unsupported reasons
- [x] 4.2 Persist provider/model/effort on every chat session and restore it
      before first composer paint without flashing a project default
- [x] 4.3 Add connected/available sections, provider-scoped search, capability
      badges, and planning-compatible filtering to provider/model pickers
- [x] 4.4 Repair invalid stored selections deterministically and visibly; never
      select a model from another provider
- [x] 4.5 Add mocked and live tests for authenticated ordering, restart restore,
      provider switching, effort clamping, and unsupported tool transports

## 5. Visible agent activity

- [x] 5.1 Define one normalized activity event shape for native and OMP-backed
      turns with stable sequence/id/status fields
- [x] 5.2 Render context gathering, reasoning availability, tool calls, questions,
      approvals, captures, errors, and completion in transcript order
- [x] 5.3 Add dense running/waiting/blocked/failed states with latest-operation
      summary, expandable detail, cancellation, and retry where safe
- [x] 5.4 Ensure questionnaire `ask_user` cards render in the owning Schematic or
      planning surface and answers resume the exact pending run once
- [x] 5.5 Add a regression where a planning model reads files, asks a question,
      captures structured output, and completes without an unexplained pause

## 6. AI-only plan generation and approval

- [x] 6.1 Remove every remaining blank/manual plan creation entry point while
      retaining edits for existing plan metadata
- [x] 6.2 Promote selected ideas into a generation setup step with engine,
      provider/model/effort, skill, worker policy, and defaults visible
- [x] 6.3 Generate and preview native/OpenSpec artifacts in a visible run; support
      feedback and revision without creating duplicate plans
- [x] 6.4 Validate required artifacts and block `ready` until validation passes
- [x] 6.5 Approve validated plans into `ready`, then assign/start/queue them in an
      existing or new chat exactly once
- [x] 6.6 Migrate legacy blank drafts to a visible `needs_artifacts` recovery path
      without deleting user data

## 7. Performance and UI harness

- [x] 7.1 Add interaction timing marks for project activation, modal first paint,
      provider/model restore, and first activity event; surface >50ms violations
- [x] 7.2 Prevent expensive planning/catalog refreshes from running on unrelated
      tab clicks; memoize/virtualize provider and model lists where measured
- [x] 7.3 Add Playwright gates for exact stage routing, no manual plan creation,
      Settings columns, compact header, authenticated provider ordering, and
      visible tool/question activity
- [x] 7.4 Add 960x640 and 1280x800 screenshots plus a restart/project-switch
      smoke that asserts no blank modal, stale project content, or layout shuffle
- [x] 7.5 Run `scripts/check-ui-invariants.mjs`, `npx tsc --noEmit`, build,
      relevant e2e, full e2e, and live desktop screenshots

## 8. Documentation and closeout

- [x] 8.1 Update `DESIGN.md` and the design-system, desktop-shell, and
      agent-runtime guides with the shipped hierarchy and event contract
- [x] 8.2 Run `node scripts/openspec-status.mjs --write` and reconcile ROADMAP
      ordering/overlap narrative
- [x] 8.3 Archive this change in the same session when all tasks are complete
