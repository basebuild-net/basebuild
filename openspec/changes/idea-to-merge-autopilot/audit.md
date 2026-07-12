# Baseline Audit — idea-to-merge-autopilot (2026-07-10)

Method: the native Tauri window cannot be driven by this agent, so evidence
comes from two sources, labeled per finding:

- **[ui-mock]** — the real React UI driven live in a browser against the
  `BASEBUILD_E2E=1` mocked Tauri backend (vite dev server, plain fixture
  project, empty planning state).
- **[e2e]** — the committed Playwright suite (344 passed / 0 failed on
  `main` @ `cee9ea9`), which exercises the same UI with seeded fixtures.
- **[code]** — inspection of the real backend/frontend wiring.

Per `mvp.md`, checkboxes there remain human-owned; this file only surfaces
evidence. Items marked **needs-live** cannot be verified without the running
native app + a real provider.

## Per-stage findings

| # | Stage | Verdict | Evidence |
|---|---|---|---|
| 1 | Project open + restore | **Working** | [ui-mock] open lands in shell with command strip, chat, composer; [e2e] activation/restore/splash specs green. One noise item: "Chat session loaded 2 warning(s)" chip on a plain load — pre-existing, low priority. |
| 2 | Schematic wizard | **Broken (UI dead-click)** | [ui-mock] Schematic modal routes correctly ("Project description missing", Start wizard / Edit raw), but **Start wizard produces zero visible reaction** — no question card, no chat turn, no loading state, no toast. Matches the reopened P0 in `mvp.md`. [e2e] `schematic-wizard-native.spec.ts` passes by driving the turn through seeded native-chat events, which confirms the rendering path but not the modal's dispatch path. **needs-live** for the skill-turn content. |
| 3 | Idea/category generation | **Broken (gate + dead affordances)** | [ui-mock] "Generate categories from project" soft-gates to the Schematic modal but with **no warning text and no proceed-anyway option** (spec `grounded-generation` requires both). Flow board's "Generate ideas" button **only navigates to the Ideas tab** — no generation turn, no gate message, no feedback. Ideas tab empty state offers only a disabled "Generate from finished plans" — **no enabled generation CTA** (violates `chat-idea-generation` empty-state requirement). |
| 4 | Promote / batch approve | **Present, untested live** | [e2e] batch promote + partial-failure isolation green (`assignment-batch-launch`, planning specs). Not walkable in [ui-mock] with an empty catalog. |
| 5 | Assign / batch launch to chats | **Present** | [ui-mock] flow board exposes Ready→"Assign to chat", launch profile (workers, provider cap, isolated worktrees vs sequential, Safe/Yolo, engine), "Save launch profile". [e2e] batch-launch destination mapping + no-status-flip contract green. **needs-live** for real dispatch. |
| 6 | Run progress / run board | **Present, minimal** | [ui-mock] run board renders ("No run board entries"); [e2e] run-board + context-strip specs green. No per-run card view, no estimates — that is this change's `run-mission-control` gap, confirmed. |
| 7 | Chat native turn | **Working** | [ui-mock] `stream-test` → streamed → final message rendered, composer re-enabled, sidebar status dot running→standby. |
| 8 | Review / merge queue | **Present, gated** | [ui-mock] Flow board "Review (0)" and "Merge" buttons exist with correct disabled gating at zero finished runs; [e2e] integration-queue specs green (merge confirm, conflict abort, cleanup). Multi-run session flow does not exist — this change's `workspace-merge-review` gap, confirmed. |
| 9 | Post-finish handling | **Hardcoded** | [code] completion card offers fixed manual Commit / Create PR actions (`plan-completion-flow` canonical); no policy concept anywhere. `queue_merge_review`-style routing absent. Confirms the `plan-completion-flow` delta. |
| 10 | Archive / sync | **Present** | [ui-mock] Changes tab lists OpenSpec changes (Active/Archived); Finished stage exposes "Archive/Sync". [e2e] changes-catalog specs green. |

## Reconciliation into this change's tasks (task 1.2)

1. **Task 2.2 (round entry) must also fix the two dead generation affordances**
   it replaces/sits beside: the flow board "Generate ideas" nav-only button and
   the Ideas empty state without an enabled CTA. The round entry becomes the
   real dispatch path on both surfaces.
2. **Soft gate**: the round entry must implement the warn + proceed-anyway
   contract (spec `idea-rounds` already requires it); the current
   redirect-without-warning behavior is the anti-pattern to remove where the
   round entry mounts. Fixing the *category* generation gate globally is out of
   scope here (upstream `grounded-generation` UI) — noted as follow-up.
3. **Schematic wizard dead-click (stage 2) is out of scope** for this change
   (owned by the reopened P0 / `ai-workbench-shell` surface). The round flow
   must therefore not hard-depend on wizard completion: the soft gate's
   proceed-anyway path is mandatory.
4. Stages 5, 6, 8, 9 confirm the four capability deltas as specified — no spec
   adjustments needed from the audit.
5. Follow-ups surfaced (not this change): "2 warning(s)" chip on plain session
   load; schematic wizard modal dispatch.

## Needs-live (human verification in the running app)

- Schematic wizard skill turn content (questionnaire-first vs prose).
- Real provider generation rounds (grounding reads visible in transcript).
- Real worktree provisioning + merge on a git repo with a remote.
