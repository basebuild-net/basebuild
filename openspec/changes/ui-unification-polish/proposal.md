# Proposal: UI Unification & Polish

## Why

The UI has grown organically and three usability problems now compound each other:

1. **Native dropdowns everywhere.** 18 native `<select>` elements across 10 files render OS-styled rounded dropdowns that break the square, dark, tokenized design (`DESIGN.md`: 0px radius, dark canvas). Small enumerated choices (permission mode, effort, plan status, engine, scheduling) hide 2–5 options behind a click when they could be a single-glance square option list. Only the model/provider picker follows the design system (card-based catalog).
2. **Settings fragmentation.** `SettingsModal` has 12 tabs, `FirstRunModal` duplicates the runtime-defaults UI with its own copy of the same selects, and there is no Skills surface at all even though the backend exposes `list_resolved_skills` / `read_resolved_skill`. The same "default chat adapter / default terminal" pair is implemented twice and can drift.
3. **Skills are invisible.** Skills power `/skill:<name>`, `/schematic`, session titling, and plan-runner launch profiles — but the user cannot see which skills exist, where they come from (bundled / user / override), or what they contain. `PlanPanel`'s launch profile takes a free-text `skillId` with zero validation or discovery.

## What Changes

- **New `OptionList` component** — a square, bordered, single-row (wrapping) button group that shows all options at once. Replaces native `<select>` for enumerated sets (2–6 options). Keyboard accessible (arrow keys + Enter), `aria-pressed` per option, `title=` tooltip per option, 0px radius, `globals.css` only.
- **Replace enumerated dropdowns with `OptionList`:**
  - `ChatPanel` permission mode (safe / balanced / auto)
  - `ChatComposerRail` effort level (per-model efforts)
  - `PlanPanel` promotion form: engine, effort, workspace policy, scheduling mode
  - `PlanningInspector` launch form: workspace, scheduling, engine, finish policy
  - `EditPlanModal` plan status
  - `IdeasPanel` idea status
  - `SettingsModal` rule decision (ask / allow / deny) and notification delivery
  - `FinalTouchesTab` step kind
- **Model/provider/adapter pickers keep their existing patterns** — the card catalog for models stays; long dynamic lists (runtime profiles, git AI provider/model, idea categories) are out of scope for `OptionList` and keep `<select>` until a list-picker exists.
- **Unify settings:**
  - Extract shared `RuntimeDefaultsFields` component used by both `SettingsModal` (Defaults tab) and `FirstRunModal` so the defaults UI exists once.
  - Add a **Skills tab** to `SettingsModal` listing resolved skills (name, description, source badge, runtime badge) with a content preview action.
- **Improve skills discoverability:**
  - `PlanPanel` launch profile `skillId` free-text input becomes a square skill picker fed by `list_resolved_skills` (with a "none" option).
  - Skill preview modal shows the skill markdown content read via `read_resolved_skill`.
- **DESIGN.md** gains a "Selection controls" section codifying: square option lists for enumerated choices, card catalog only for models, no native dropdown styling for small sets.

## Capabilities

### New Capabilities
- `ui-selection-controls` — the `OptionList` component and its replacement of enumerated native selects
- `settings-unification` — shared runtime-defaults fields, Skills tab
- `skills-management` — skills list, preview, and plan-profile skill picker

## Impact

- `src/components/layout/OptionList.tsx` — new shared component
- `src/components/layout/SettingsModal.tsx` — Skills tab, shared defaults fields, OptionList for decisions/delivery
- `src/components/layout/FirstRunModal.tsx` — reuse shared defaults fields
- `src/components/layout/PlanPanel.tsx`, `PlanningInspector.tsx`, `EditPlanModal.tsx`, `FinalTouchesTab.tsx` — OptionList replacements, skill picker
- `src/components/panels/ChatPanel.tsx`, `ChatComposerRail.tsx`, `IdeasPanel.tsx` — OptionList replacements
- `src/lib/skillRegistry.ts` — already exists; consumed by new UI
- `src/styles/globals.css` — OptionList, skills list, skill preview classes
- `DESIGN.md` — Selection controls section
- `tests/e2e/` — new spec file covering OptionList behavior, Skills tab, skill picker
