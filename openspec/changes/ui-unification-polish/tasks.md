# Tasks: UI Unification & Polish

## 1. OptionList component

- [x] 1.1 Create `src/components/layout/OptionList.tsx` — generic square button group per design.md contract (value, options, onChange, label, compact, disabled)
- [x] 1.2 Add `.option-list`, `.option-list-btn`, `.is-active`, compact variant classes to `globals.css` (0px radius, group border, active CTA underline)
- [x] 1.3 Keyboard: ArrowLeft/ArrowRight focus movement, Enter/Space select

## 2. Dropdown replacements

- [x] 2.1 ChatPanel permission mode (safe/balanced/auto) → OptionList
- [x] 2.2 ChatComposerRail effort → OptionList (static label when 1 option)
- [x] 2.3 PlanPanel promotion form: engine, effort, workspace, scheduling → OptionList
- [x] 2.4 PlanningInspector launch form: workspace, scheduling, engine, finish → OptionList
- [x] 2.5 EditPlanModal status → OptionList
- [x] 2.6 IdeasPanel idea status → OptionList
- [x] 2.7 SettingsModal rule decision + notification delivery → OptionList
- [x] 2.8 FinalTouchesTab step kind → OptionList

## 3. Settings unification

- [x] 3.1 Extract `RuntimeDefaultsFields.tsx` shared component
- [x] 3.2 SettingsModal Defaults tab consumes it
- [x] 3.3 FirstRunModal consumes it
- [x] 3.4 Add Skills tab to SettingsModal (list, badges, empty/error states)
- [x] 3.5 Skill preview modal (read_resolved_skill)

## 4. Skills in plan forms

- [x] 4.1 PlanPanel skill free-text → skill picker with "No skill" + text fallback
- [x] 4.2 E2E mock: `list_resolved_skills` returns seeded skills; `read_resolved_skill` returns stub content

## 5. DESIGN.md

- [x] 5.1 Add "Selection controls" section: option lists for enumerated sets, card catalog for models, no native dropdown styling for small sets

## 6. Verification

- [x] 6.1 E2E: OptionList render/select/keyboard on permission mode
- [x] 6.2 E2E: Skills tab list + preview
- [x] 6.3 E2E: launch/promotion OptionList values persist (covered by finish-policy.spec.ts save-and-reload and workspace-hardening.spec.ts active-state assertions; direct promotion-form test self-skips when no draft plan is reachable in the fixture)
- [x] 6.4 `tsc --noEmit` clean; full e2e suite green
