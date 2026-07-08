# Tasks: OpenSpec Chat Workbench

## 1. Runtime and settings foundation

- [ ] 1.1 Add `src-tauri/src/models/openspec_runtime.rs` with `OpenSpecRuntimeStatus { state, version, executable_path, schema, project_ready, message }` and re-export it from `models/mod.rs`.
- [ ] 1.2 Add `src-tauri/src/services/openspec_runtime_service.rs` with `status(project_path)`, `detect_executable()`, `validate_project(path)`, and explicit install/update stubs returning actionable `not configured` until a source is selected; no network call in detection.
- [ ] 1.3 Add Tauri commands `openspec_runtime_status`, `openspec_runtime_install`, and `openspec_runtime_update`; register them in `src-tauri/src/lib.rs` and route errors through sanitized strings.
- [ ] 1.4 Add thin wrappers in `src/lib/openspecRuntime.ts`; do not put React state in this file.
- [ ] 1.5 Add Settings → `OpenSpec` tab in `src/components/layout/SettingsModal.tsx` next to Planning/Final Touches. It must show missing/ready/error/installing, version/path/schema, project readiness, retry, manual path/install affordance, and debug-log actions.
- [ ] 1.6 Gate OpenSpec plan validation/ready/run in `PlanPanel.tsx`, `PlanningInspector.tsx`, and plan-run dispatch paths: missing runtime shows setup-required card linking to Settings → OpenSpec; no worktree/run is created when blocked.

## 2. OpenSpec wrapper flow

- [ ] 2.1 Update idea promotion in `ChatPanel.tsx` / plan creation flow so promoted ideas default to `engine: openspec` and store `external: openspec/changes/<slug>/` after artifact generation.
- [ ] 2.2 Ensure `.basebuild` plan records for OpenSpec plans store metadata/external pointers only; do not duplicate `tasks.md` checkboxes into another native implementation plan.
- [ ] 2.3 Update run opening prompt construction to use the exact path-based OpenSpec apply instruction from `design.md`; include `Do not create a second implementation plan`.
- [ ] 2.4 Update `plan_import` and imported OpenSpec plans to participate in the same ready/run/context-strip flow.
- [ ] 2.5 Update completion/final-touches flow so completed OpenSpec-backed runs surface review, validate, commit, PR, merge, prune, sync, and archive actions as explicit confirmed steps.
- [ ] 2.6 Update `mvp.md` golden path to the owner-approved loop: `generate ideas → generate OpenSpec artifacts/full implementation plans → process queue → final touches/merge/archive`, with worktrees used when configured.

## 3. Flat activity timeline

- [ ] 3.1 In `ChatPanel.tsx`, introduce a `ChatActivityItem` union matching `design.md` and a monotonic `sequence` allocator for streaming text, thinking, tool calls, questions, notices, errors, approvals, and captures.
- [ ] 3.2 Replace default `ToolEventGroup` rendering with `ActivityTimeline` + `ActivityTimelineRow`; each `NativeToolEvent` renders as its own `ToolEventCard` in sequence order.
- [ ] 3.3 Split thinking blocks: close the current thinking item before appending any tool call, question, approval, notice, capture, error, or assistant text after a tool result; later reasoning starts a new `ThinkingBlock` row.
- [ ] 3.4 Keep grouped/compact timeline disabled by default. If old `.tool-card-group` classes remain for compatibility, they must not be used by the default chat timeline.
- [ ] 3.5 Add loading rows for `thinking`, `streaming`, `running tools`, `waiting for answer`, `queued`, `blocked`, and `failed`; every state must include text and icon, not color alone.
- [ ] 3.6 Ensure native and OMP RPC events both normalize into the same timeline rows. Raw PTY terminals are excluded from managed OpenSpec planning and must show a capability blocker.

## 4. Questions and choices everywhere

- [ ] 4.1 Move `QuestionCard` rendering into `ActivityTimelineRow` for `question` items; the card remains inline and blocks the run visibly.
- [ ] 4.2 Verify `ask_user` card rendering for `options`, `multi`, `confirm`, and `text`, including multiple questions in one call and recommended options.
- [ ] 4.3 Wire OMP RPC user-input/ask frames into the same timeline question item path; answering must serialize back over RPC and resume the exact pending turn once.
- [ ] 4.4 Keep conservative prose quick-reply detection for degraded A/B questions, but never render chips when a structured `ask_user` card exists for the same turn.
- [ ] 4.5 Escape all question/option/chip text; do not render raw HTML or executable links.

## 5. Chat context status strip

- [ ] 5.1 Add `src/components/panels/ChatContextStrip.tsx` with props from `design.md`: workspace id, branch, worktree path, plan/change, task progress, run state, model label, context usage.
- [ ] 5.2 Mount `ChatContextStrip` next to or below the composer input in `ChatPanel.tsx`. It must stay visible when the transcript scrolls and must not be inside `.chat-messages`.
- [ ] 5.3 Wire branch/worktree state already loaded for `ChatHeader` into the context strip; include full paths in `title=` tooltips.
- [ ] 5.4 Wire assigned plan/OpenSpec change/progress from existing plan progress refresh (`tasks.md` parser) into the strip; update when progress changes.
- [ ] 5.5 Add context-window meter with healthy/warning/critical/unknown states. Use local estimates/known model limits only; never fabricate limits.
- [ ] 5.6 Keep free-form chats simple: provider/model/context usage visible, plan/worktree omitted when not applicable.

## 6. Visual planning command center

- [ ] 6.1 In `PlanningInspector.tsx`, add a visual command-center header with stage cards for Ideas, OpenSpec, Ready, Queued, Running, Blocked, Review, Finished, and Integration.
- [ ] 6.2 Each stage card must show count, status word, status color, icon/activity pulse when active, and a `title=` tooltip with the exact count and next action.
- [ ] 6.3 Add obvious primary actions: `+ Generate ideas`, `Run through OpenSpec`, `Assign to chat`, `Start queue`, `+ Add worker`, `Review`, `Merge`, and `Archive/Sync`; actions disabled only with a visible reason.
- [ ] 6.4 Make idea cards visually runnable through OpenSpec: selecting an idea and clicking `Run through OpenSpec` creates/updates the OpenSpec-backed plan, updates status immediately, and increments the OpenSpec stage count.
- [ ] 6.5 Make the run board visual-first: running/queued/blocked totals, per-worker progress bars, branch/worktree chips, owner chat link, current activity summary, and blocker/collision badges.
- [ ] 6.6 Add CSS variables/classes in `globals.css` for `.planning-command-center`, `.planning-stage-card`, `.planning-stage-count`, `.planning-stage-action`, run status colors, progress bars, and active pulses.
- [ ] 6.7 Add e2e coverage for visual counts and actions: generate ideas, run selected idea through OpenSpec, queue two plans, show one running/one queued, and click a running worker to focus its chat.

## 7. Markdown, syntax, and visual tokens

- [ ] 7.1 Add or reuse a safe Markdown renderer for assistant messages; if adding a dependency is necessary, justify it and ensure raw HTML is disabled/sanitized. Prefer existing dependencies if present.
- [ ] 7.2 Render code fences, inline code, lists, blockquotes, tables, and diffs with tokenized styles from `src/styles/globals.css`.
- [ ] 7.3 Refactor hardcoded chat/status colors in changed components to CSS variables; add tokens for neutral silver, status draft/openspec/ready/running/finished/cancelled, tool read/write/edit/command/question/error, and context healthy/warn/critical.
- [ ] 7.4 Update `DESIGN.md`: loosen pure-black/single-orange language; keep 0px radius, one stylesheet, tooltip coverage, local-first, semantic state redundancy, and screenshot verification.
- [ ] 7.5 Update `docs/agents/design-system.md` with the new token classes and remove direct named external-reference language from component docs.
- [ ] 7.6 Remove direct external-reference comments from product code, starting with `src/components/panels/ChatHeader.tsx`; use neutral Basebuild-owned comments.

## 8. Shell declutter and zoom

- [ ] 8.1 Refactor the persistent left sidebar so it exposes only Projects, Chats, Settings, and Updates. Plans/Ideas/Files/Source/Flow must move to chat controls, context strip/header actions, or project modals.
- [ ] 8.2 Make tabs flatter/larger and neutral silver; make the primary plus/new-chat affordance larger and more discoverable; use `…` menus for secondary actions.
- [ ] 8.3 Add zoom state (`80`, `90`, `100`, `110`, `125`, `150`) with `Ctrl/Cmd + +`, `Ctrl/Cmd + -`, and `Ctrl/Cmd + 0` keyboard handling; persist locally.
- [ ] 8.4 Apply zoom through `document.documentElement.dataset.bbZoom` and CSS in `globals.css`; do not use React inline styles.
- [ ] 8.5 Show a bottom-right/status-bar zoom indicator with a tooltip and reset affordance.
- [ ] 8.6 Verify popovers/modals/context strip at 960×640 and Windows 125%/150% scale do not clip.
- [ ] 8.7 Adapt the verified T3 Code branch/environment-picker pattern as Basebuild-owned UI: show branch + workspace policy under the input, lock workspace policy after the first message/run starts, keep branch actions explicit, and hide git controls for non-git projects.

## 9. Tests and fixtures

- [ ] 9.1 Add Rust tests for OpenSpec runtime detection/project validation missing/ready/error states; install/update may be stub-tested until installer source is finalized.
- [ ] 9.2 Add frontend/e2e fixture data for an OpenSpec-backed plan with progress, queued state, running worktree, and finished awaiting-review state.
- [ ] 9.3 Add e2e coverage: Settings → OpenSpec missing/ready display; missing runtime blocks ready/run; ready runtime allows assignment.
- [ ] 9.4 Add e2e coverage: flat timeline renders thinking A → tool → thinking B → question → answer without a grouped tool lump.
- [ ] 9.5 Add e2e coverage: context strip shows branch/worktree/plan/progress/model/context usage under the input and updates after progress changes.
- [ ] 9.6 Add e2e coverage: A/B prose quick replies and structured `ask_user` cards are clickable and escaped.
- [ ] 9.7 Add e2e coverage: zoom shortcuts update UI scale and visible indicator; reset returns to 100%.
- [ ] 9.8 Add e2e coverage: visual command center stage counts, `+ Generate ideas`, `Run through OpenSpec`, queued/running counts, and click-through to owning chat.
- [ ] 9.9 Add UI invariant coverage for any new interactive controls (`title=`), one stylesheet, and 0px radius.

## 10. Verification

- [ ] 10.1 Run `npx tsc --noEmit`.
- [ ] 10.2 Run `npm run build`.
- [ ] 10.3 Run `cd src-tauri && cargo check`.
- [ ] 10.4 Run targeted Rust tests for OpenSpec runtime/settings/plan gating.
- [ ] 10.5 Run targeted Playwright specs added/changed for timeline, questions, OpenSpec settings, context strip, zoom, visual command center, and shell declutter.
- [ ] 10.6 Run `npm run check:ui-invariants`.
- [ ] 10.7 Perform UI smoke with screenshots: dark theme, visual command center, flat timeline, thinking/tool split, clickable question, context strip, Settings → OpenSpec, zoom indicator, 960×640 compact layout.

## 11. Docs and roadmap

- [ ] 11.1 Update `docs/agents/agent-runtime.md` to say the default timeline is ungrouped and thinking blocks split around tool calls/questions.
- [ ] 11.2 Update `docs/agents/desktop-shell.md` for left navigation Projects/Chats/Settings/Updates, context strip, zoom, and OpenSpec wrapper flow.
- [ ] 11.3 Update `docs/agents/openspec.md` for Settings-managed OpenSpec runtime and ready/run gating.
- [ ] 11.4 Update `docs/agents/design-system.md` and `DESIGN.md` as described above.
- [ ] 11.5 Update `mvp.md` with the new MVP loop and human-signoff checklist items.
- [ ] 11.6 Run `node scripts/openspec-status.mjs --write` and manually update `openspec/ROADMAP.md` narrative for this change.
