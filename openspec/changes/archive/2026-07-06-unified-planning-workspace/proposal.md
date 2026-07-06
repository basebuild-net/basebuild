# Proposal: Unified Planning Workspace

## Why

Planning is split across two overlapping, half-wired systems and a generation
flow that hides everything it does:

- The chat has `plan_proposals` (shipped in `planning-system-qol`) rendering
  "proposal cards", while the right panel has a separate `ideas` /
  `idea_categories` catalog. Two data models, two surfaces, same intent — the
  "stupid" duplicated UI the user called out.
- "Generate ideas"/"Generate plans" streams reasoning and progress on a
  `native-chat://chunk` channel tagged `ideas`, which the frontend **explicitly
  discards** (`if (channel === "ideas") return;`). The composer shows a
  `Generating…` spinner that collapses to nothing — no thinking, no progress,
  no ideas appearing incrementally. Generation is invisible and feels broken.
- Idea generation has no direction: the prompt asks for "3-6 concrete ideas"
  with no categorical grounding (SEO, Optimization, Design, New Features), so
  output is generic.
- System prompts for chat/idea/plan/category generation are hardcoded in Rust
  with no way to view or tune them.
- Ideas can be Promoted but never Rejected; there is no history view of what
  was accepted, rejected, or left untouched, and no per-category exploration.

## What Changes

Unify planning into a single **Categories → Ideas → Plans** model, surfaced in
the main chat (generation is a visible, in-context turn) and in one tabbed
right-side inspector, with tunable prompts.

- **Single unit = Idea.** Fold the chat `plan_proposals` mechanism into the
  existing `ideas` catalog: the agent's structured-capture tool writes `ideas`
  rows (category-tagged, `concept`) instead of `plan_proposals`. The chat's
  "proposal cards" become "idea cards". **BREAKING (internal, pre-1.0):** the
  `plan_proposals` table and `plan_proposal_*` commands are removed; there is
  one catalog, not two.
- **Generation flows through the main chat.** Idea/plan generation runs as a
  real chat turn: reasoning renders in the thinking fold, progress streams live
  in the transcript, and ideas appear as cards **one by one** as they are
  captured. The discarded `ideas` channel is removed. Nothing collapses to an
  empty spinner.
- **Categorical direction.** Generation is grounded in categories (default
  seed: SEO, Optimization, Design, New Features; plus AI-generated and
  user-added). "Suggest more ideas for this category" generates within that
  category's direction.
- **Idea status adds `rejected`.** Lifecycle becomes
  `concept → picked | rejected | archived`. Reject is a first-class action next
  to Promote. Status is the history signal (accepted / rejected / no change).
- **Unified right-side inspector** with `Plans / Ideas / Categories` tabs.
  Ideas tab is the filterable history (by status). Categories tab drills into a
  category to show its ideas and a "Suggest more" button.
- **Chat quick-access menu** replaces the lone "Generate ideas" button with a
  small menu: `Quick ideas`, `By category…`, `Open planning inspector`.
- **Planning Settings.** A new Settings → Planning tab shows every generation
  system prompt (chat, idea, plan, category) in an editable field with
  `Save` and `Reset to default`. Overrides persist; generation reads them.

## Capabilities

### New Capabilities

- `planning-prompt-settings` — view, edit, save, and reset the system prompts
  used for chat, idea, plan, and category generation.

### Modified Capabilities

- `chat-idea-generation` — generation is an in-context chat turn (visible
  reasoning/progress, incremental idea cards) unified with the former proposal
  mechanism; supports categorical direction and reject.
- `plan-pipeline` — idea lifecycle gains `rejected`; category-directed
  generation and "suggest more per category"; idea/category history is
  first-class; `plan_proposals` is superseded by the `ideas` catalog.
- `plan-pipeline-ui` — the right panel becomes a tabbed
  `Plans / Ideas / Categories` inspector with per-category drill-down and
  suggest-more; the chat exposes a compact planning quick-access menu; ideas and
  chat idea cards gain a Reject action.

## Impact

- **Rust services:** `native_chat_service` (generation → chat turn, remove
  `ideas` channel, read tunable prompts), `session_service` (idea `rejected`
  status, category-directed generation, seed default categories), new
  `planning_prompt_service`, `plan_proposal_service` (removed),
  `storage_service` (new `planning_prompts` table; drop `plan_proposals`).
- **Rust models/commands:** `models/idea.rs` (`IdeaStatus::Rejected`),
  new `commands/planning_prompts.rs`, `commands/native_chat.rs` (generation
  request gains category/direction; remove `plan_proposal_*`), `lib.rs`
  registration.
- **TS:** `ChatPanel` (in-transcript generation, idea cards + Reject, quick
  menu; remove proposal cards), new `PlanningInspector` with
  `Plans/Ideas/Categories` tabs (replaces/extends `PlanPanel`),
  `SettingsModal` (Planning tab), `lib/ideas.ts` + `state/ideas.ts` (reject,
  category-directed generate), new `lib/planningPrompts.ts`, remove
  `lib/planProposals.ts`.
- **DB migrations:** additive `planning_prompts` table; additive
  `ideas.status` accepts `rejected`; drop `plan_proposals` (pre-1.0, local,
  no external consumers).
- **Docs:** `docs/agents/agent-runtime.md` (unified catalog, tunable prompts,
  generation-as-chat-turn), `docs/agents/desktop-shell.md` (planning
  inspector), `DESIGN.md` + `docs/agents/design-system.md` (inspector tabs,
  idea cards, quick menu, planning settings).
- **Supersedes:** the `plan_proposals` portion of the unarchived
  `planning-system-qol` change. Its `plan-pipeline-ui` "Structured plan
  proposal capture" delta is replaced by this change's unified idea capture.
