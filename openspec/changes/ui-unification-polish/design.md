# Design: UI Unification & Polish

## OptionList component

One shared component, one CSS block. No portal, no popover, no focus trap — all
options are always visible.

```tsx
type OptionListOption<T extends string> = {
  id: T;
  label: string;
  /** Tooltip — required per design system. */
  title: string;
  disabled?: boolean;
};

type OptionListProps<T extends string> = {
  value: T;
  options: OptionListOption<T>[];
  onChange: (id: T) => void;
  /** aria-label for the group. */
  label: string;
  /** Compact mode: smaller padding for dense forms. */
  compact?: boolean;
  disabled?: boolean;
};
```

- Renders `<div role="group" aria-label={label} className="option-list">` with
  one `<button type="button">` per option.
- Active option: `aria-pressed="true"`, class `is-active`, orange bottom border
  (2px CTA) + `surface-container-high` background — matches the existing
  `tool-button-active` pattern from DESIGN.md.
- Keyboard: Left/Right arrows move focus between options; Enter/Space selects.
- 0px radius, 1px outline border around the group, options divided by 1px
  border. Wraps to multiple rows when the container is narrow.
- Never used for >6 options or dynamic lists — those keep their current
  control until a dedicated list-picker capability exists.

## Rollout table

| Surface | Field | Options | Notes |
|---|---|---|---|
| ChatPanel | permission mode | safe / balanced / auto | compact |
| ChatComposerRail | effort | model's efforts (≤4) | compact; hides when 1 option |
| PlanPanel promotion | engine | native / omp | |
| PlanPanel promotion | effort | low / medium / high | |
| PlanPanel promotion | workspace | isolated_worktrees / shared | |
| PlanPanel promotion | scheduling | safe / eager | |
| PlanningInspector launch | workspace / scheduling / engine / finish | same sets | |
| EditPlanModal | status | draft / openspec / ready / running / finished / cancelled | wraps |
| IdeasPanel | idea status | concept / picked / rejected / archived | compact |
| SettingsModal | rule decision | ask / allow / deny | compact |
| SettingsModal | notification delivery | ≤4 delivery modes | compact |
| FinalTouchesTab | step kind | enumerated kinds | |

Out of scope (keep `<select>`): runtime profile pickers (dynamic), git AI
provider/model (dynamic), idea category filter (dynamic).

## Settings unification

- `RuntimeDefaultsFields` component (new file
  `src/components/layout/RuntimeDefaultsFields.tsx`): renders the default chat
  adapter and default terminal profile fields given
  `{ defaults, chatProfiles, terminalProfiles, onChange }`. Both `SettingsModal`
  and `FirstRunModal` render it; neither keeps a private copy.
- Skills tab appended to the `SettingsModal` tab list (icon: `Sparkles`),
  loading `listResolvedSkills()` on first open. Each row: name (mono), source
  badge (`bundled` / `user` / `override`), runtime badge (`native` / `omp` /
  `both`), description, and a "View" button opening the preview modal.
- Preview modal: skill name header + scrollable `<pre>` of the markdown from
  `readResolvedSkill(name)`. Read-only in this change — editing is a future
  capability.

## Skill picker in PlanPanel

The free-text `skillId` input becomes a button that opens a small square
list (same visual language as OptionList but vertical) of resolved skills +
"No skill". Selecting writes `skillId`. If `list_resolved_skills` fails or is
empty, fall back to the current text input so plans never lose the field.

## Decisions

- **Buttons, not radio inputs**: matches every existing control in the app;
  no new form-element styling needed.
- **`aria-pressed` over `role="radiogroup"`**: the app already uses
  `aria-pressed` (agent mode pill); consistency wins over strict radio
  semantics.
- **No behavior change to persisted values**: OptionList emits the exact same
  ids the selects emitted; backend contracts untouched.
- **E2E mock already returns `[]` for `list_resolved_skills`** — tests seed a
  non-empty list via a new mock branch so the Skills tab and picker are
  testable.
