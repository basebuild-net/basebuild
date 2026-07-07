# Tasks: planning-cockpit

Gates: archive `planning-command-center` first (spec bases + absorbs its open
6.4/6.5). Coordinate layout tasks (phase 6) with
`provider-parity-workspace-fixes` `.modal` reflow — land after it or rebase.
Phases 1–2, 3–4, 5–6, and 7 are intended PR boundaries.

## 1. Prompt delivery + destination chooser

- [x] 1.1 Add `deliverPrompt` shell API (`AppShell.tsx` + small
      `src/lib/promptDelivery.ts` store): `{ chatSessionId, text, mode:
      insert|send, actionId }`, per-session pending queue, exactly-once flush
      on chat readiness (idempotent by `actionId`). Remove `chatDraft`,
      `chatDraftTabId`, `autoSendDraft` and the `ChatPanel` draft effect;
      `ChatPanel` consumes deliveries keyed by its `nativeSessionId`:
      insert → composer set + focus; send → one user turn, composer left
      empty; tool-incapable model → insert + inline notice (no send).
- [x] 1.2 `DestinationPicker.tsx` (managed dialog, 0px radius, tooltips):
      lists open chat panels (title, grid position, model, busy/assigned
      badges) + "New conversation" + cancel; busy selection warns; returns a
      chat session id (creating the panel when new). Styles in `globals.css`.
- [x] 1.3 Wire schematic entry points through it: `handleStartSchematicWizard`
      (all call sites — schematic tab, empty state, nudges, flow board fix
      action) opens the picker, then delivers via `deliverPrompt(send)`.
      Fix `handleOpenSchematic` so the panels-list/stage click always opens or
      focuses the schematic surface in every project (no legacy `empty`-tab
      dead path).
- [x] 1.4 Rust unit tests: none (frontend seam). Playwright e2e:
      wizard → picker → existing tab (single insert+send, empty composer
      after), wizard → new conversation, cancel delivers nothing, double
      click before readiness delivers once, second-project schematic click
      opens its surface. Fix `native_interaction_list_all` mock gap in
      `src/test-support/tauri-core.ts` so mocked chats stop rendering the
      error banner.

## 2. Real assignment + batch launch destinations

- [x] 2.1 Backend `plan_assign_to_chat(plan_id, chat_session_id)` command +
      `plan_runner_service` path: validate ready+unassigned, seed opening
      context into the existing session, provision worktree per policy
      (`WorktreeService::create_with_base`, set `plan_runs.workspace_path`),
      enqueue per `run-concurrency-limits`, emit `PLAN_RUN_EVENT` with the
      same `chat_session_id`. Unit tests: binding to existing session id,
      worktree field set, queued-at-cap, busy-session rejection.
- [x] 2.2 Chat-header "Assign plan": replace the stub — picker select calls
      `plan_assign_to_chat`, badge/worktree chips bind from the run event;
      replace-confirmation flow for already-assigned chats (managed dialog).
- [x] 2.3 Batch launch mapping UI on the flow board: multi-select ready plans
      → mapping step (default New panel; per-plan destination via
      `DestinationPicker` data; busy tabs disabled) → managed confirmation
      enumerating plan→destination, worktrees, branches, providers → dispatch
      each mapped plan (new-panel plans spawn panels first); per-plan error
      capture reverts failures to `ready`. Delete the status-flip
      "Launch N ready" path and its `window.confirm`.
- [x] 2.4 Playwright e2e: assign-to-this-chat streams into the same session;
      batch launch 3 (1 existing tab + 2 new) creates 3 runs (mocked
      git/provider) with queued state beyond cap; cancel creates nothing;
      no `window.confirm` anywhere in these flows.

## 3. OpenSpec change catalog (backend)

- [x] 3.1 `openspec_service.rs`: `list_changes(project_path)` (name, artifact
      presence, progress, linked plan via `find_plan_by_change`, archived
      flag, created date from `.openspec.yaml`), tolerant of malformed
      changes. `parse_tasks_structured` (phases `^## `, tasks
      `- [ ]/- [x]` with ids, line offsets, lossless). Unit tests: mixed
      app/foreign changes, malformed tasks.md, structure fidelity.
- [x] 3.2 `toggle_task(project_path, change_name, line, expected_state)`:
      canonicalize-under-`openspec/changes/` guard, content+mtime verify,
      atomic temp+rename rewrite of the single checkbox marker; emits
      `TaskProgressChanged` planning event (new kind in
      `models/planning_event.rs`). Unit tests: toggle round-trip, formatting
      preserved, stale-content rejection, traversal rejection.
- [x] 3.3 Liveness: tool-runtime post-write hook (native + app-driven OMP
      writes matching `openspec/changes/**/tasks.md` → re-parse + event);
      2s mtime-gated poll of linked tasks.md while any run is active; 5s
      poll while a catalog surface is open (frontend-driven subscription
      command). `archive_change` + `link_change_to_plan` / `unlink` commands
      (confirm-gated in UI; archive refuses active plans; link refuses
      double-link). Unit tests: hook emission, poll detection, archive
      guards, link guards.
- [x] 3.4 Commands + thin `src/lib/openspecCatalog.ts` wrappers for all of
      the above.

## 4. Catalog + checklist UI

- [x] 4.1 `ChangeCatalog.tsx` in the planning surface: change list with
      artifact-presence chips, progress bars, linked-plan back-links,
      archived filter; actions: link/unlink to plan, archive (managed
      confirmations); foreign changes shown equally.
- [x] 4.2 `TaskChecklist.tsx`: phase-grouped checklist with per-phase and
      total progress, click-to-toggle via `toggle_task`, live refresh from
      `TaskProgressChanged`; reachable from plan rows, run cards, and the
      catalog; open-in-file-viewer affordance for artifacts.
- [x] 4.3 Plan rows + chat plan badges show live `n/m` progress from events
      (replace poll-on-open-only display).
- [x] 4.4 Playwright e2e: catalog lists fixture changes, checklist toggle
      persists (mocked fs round-trip), progress updates live from an emitted
      event, archive flow gated + filtered, link/unlink guards surfaced.

## 5. Interactive coverage (OMP RPC cards, prose chips, managed confirms)

- [x] 5.1 Route OMP-RPC-delegated native chat turns' user-input/ask frames
      into `pending_interactions` keyed by the chat session (reuse
      `omp_rpc_session_service::handle_user_input`); answers serialize back
      over stdin; cancel resolves both sides. Unit tests: frame → interaction
      → answer round-trip, unknown frames inert.
- [x] 5.2 Prose quick-reply chips in `ChatPanel.tsx`: conservative detector
      (completed assistant messages; ≥2 enumerated options `^[A-H][).:]\s`
      or explicit "reply with X/Y"; skip code fences; no chips while an
      `ask_user` card is pending), chips send the reply as a normal user
      message, escaped rendering, free-text affordance. Unit-style e2e
      fixtures for positive + negative detection and hostile text inertness.
- [x] 5.3 Managed `ConfirmDialog.tsx` + sweep: batch launch, archive, link,
      replace-assignment, mark-complete, commit, PR confirmations use it;
      remove every `window.confirm`/`alert`/`prompt` from planning/source
      flows (repo-wide grep gate in e2e).
- [x] 5.4 Playwright e2e: OMP RPC question frame renders the same card and
      answer round-trips (mocked RPC child); prose chips send the pick;
      no-native-dialog assertion across the swept flows.

## 6. Command strip + wide layouts + idea browser

- [x] 6.1 `CommandStrip.tsx` mounted in the shell header/sidebar entry:
      per-stage counts, status colors, activity pulse, unread planning badge,
      aggregate running `n/m`; live from planning events; click-through opens
      the planning surface on that stage (drill-through wiring also fixes the
      board's dead stage clicks); collapsible to a badge, state persisted in
      workspace restore.
- [x] 6.2 Wide-layout pass (container queries in `globals.css` only, on
      content classes — never `.modal` sizing): planning surface master–detail
      + board columns ≥1100px container, stacked below; source-control surface
      same treatment; kill run-on filter chips and clipped tabs at narrow
      widths.
- [x] 6.3 `IdeaBrowser.tsx` replacing the Ideas trigger menu: status filters,
      category grouping, grounding summaries; actions Promote / Send to chat
      (via `DestinationPicker` + `deliverPrompt`) / open planning surface;
      generation actions as secondary section; empty-state CTA into
      generation.
- [x] 6.4 Playwright e2e: strip counts update from events and click-through
      lands on the right stage; wide vs narrow layout snapshots for planning
      + source surfaces; idea browser filter → send-to-chat → prompt lands in
      the chosen tab; promote updates row.

## 7. Completion flow

- [x] 7.1 Backend: run-end evaluation — full checklist keeps auto-complete;
      incomplete/indeterminate checklist parks the run in `awaiting-review`
      (no silent `finished`) and emits a mark-as-complete planning event;
      `plan_run_mark_complete(run_id)` command records manual completion.
      Unit tests: early-stop parks, full-checklist auto-completes, manual
      completion transitions.
- [x] 7.2 Completion card in the run's chat + notification: "Mark as
      complete? n/m", actions mark-complete / keep-running / open-checklist;
      completed state shows confirm-gated Commit (editable message,
      worktree-scoped via existing final-touches commit step) and Create PR
      (existing recommend/create path incl. no-`gh` fallback), with outcomes
      reported on the card + notification.
- [x] 7.3 Source-control context on the card and finished-run rows: branch,
      ahead/behind vs fetched default, changed-file count, worktree path with
      reveal; renders nothing (not an error) for non-git/unborn-HEAD.
- [x] 7.4 Playwright e2e: early-stop → prompt → mark complete; full checklist
      → completed card; commit and PR actions confirm-gated with mocked git
      (declining does nothing); non-git shows no context block.

## 8. Verification + docs

- [x] 8.1 `npx tsc --noEmit`, `npm run build`, `cargo check`, `cargo test`
      (src-tauri), `npm run test:e2e` all pass.
- [x] 8.2 UI smoke on a live dev build: schematic wizard → destination picker
      → cards (native + OMP RPC) → ideas → browser assign → batch launch to
      mixed destinations → strip pulses → checklist ticks live → early-stop
      prompt → mark complete → commit → PR. Tooltips, 0px radius, single
      stylesheet audited on all new surfaces.
- [x] 8.3 Docs: `docs/agents/openspec.md` (catalog, toggle, archive
      semantics), `docs/agents/desktop-shell.md` (command strip, destination
      picker, completion card), `docs/agents/agent-runtime.md` (prompt
      delivery contract, OMP RPC question routing, prose-chip detector),
      `DESIGN.md` (strip, wide layouts, managed dialogs). Roadmap refresh:
      `node scripts/openspec-status.mjs --write` + narrative entry.
