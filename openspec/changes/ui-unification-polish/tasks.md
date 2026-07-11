# Tasks: UI Unification & Polish

## 1. OptionList component

- [ ] 1.1 Create `src/components/layout/OptionList.tsx` — generic square button group per design.md contract (value, options, onChange, label, compact, disabled)
- [ ] 1.2 Add `.option-list`, `.option-list-btn`, `.is-active`, compact variant classes to `globals.css` (0px radius, group border, active CTA underline)
- [ ] 1.3 Keyboard: ArrowLeft/ArrowRight focus movement, Enter/Space select

## 2. Dropdown replacements

- [ ] 2.1 ChatPanel permission mode (safe/balanced/auto) → OptionList
- [ ] 2.2 ChatComposerRail effort → OptionList (static label when 1 option)
- [ ] 2.3 PlanPanel promotion form: engine, effort, workspace, scheduling → OptionList
- [ ] 2.4 PlanningInspector launch form: workspace, scheduling, engine, finish → OptionList
- [ ] 2.5 EditPlanModal status → OptionList
- [ ] 2.6 IdeasPanel idea status → OptionList
- [ ] 2.7 SettingsModal rule decision + notification delivery → OptionList
- [ ] 2.8 FinalTouchesTab step kind → OptionList

## 3. Settings unification

- [ ] 3.1 Extract `RuntimeDefaultsFields.tsx` shared component
- [ ] 3.2 SettingsModal Defaults tab consumes it
- [ ] 3.3 FirstRunModal consumes it
- [ ] 3.4 Add Skills tab to SettingsModal (list, badges, empty/error states)
- [ ] 3.5 Skill preview modal (read_resolved_skill)

## 4. Skills in plan forms

- [ ] 4.1 PlanPanel skill free-text → skill picker with "No skill" + text fallback
- [ ] 4.2 E2E mock: `list_resolved_skills` returns seeded skills; `read_resolved_skill` returns stub content

## 5. DESIGN.md

- [ ] 5.1 Add "Selection controls" section: option lists for enumerated sets, card catalog for models, no native dropdown styling for small sets

## 6. Verification

- [ ] 6.1 E2E: OptionList render/select/keyboard on permission mode
- [ ] 6.2 E2E: Skills tab list + preview
- [ ] 6.3 E2E: plan promotion form OptionList values persist
- [ ] 6.4 `tsc --noEmit` clean; full e2e suite green
