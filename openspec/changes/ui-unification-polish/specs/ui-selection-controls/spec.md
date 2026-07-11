## ADDED Requirements

### Requirement: OptionList replaces enumerated native dropdowns
Enumerated choices with 2–6 fixed options SHALL render as a square option list — a bordered button group showing all options at once — instead of a native `<select>` dropdown. The option list SHALL have 0px border radius, use only `globals.css` classes, show a `title=` tooltip on every option, mark the active option with `aria-pressed="true"` and a visible active style, and expose a group `aria-label`.

#### Scenario: All options visible at once
- **WHEN** a surface renders an enumerated choice (e.g. permission mode safe/balanced/auto)
- **THEN** every option is visible as a square button without opening any dropdown

#### Scenario: Selecting an option
- **WHEN** the user clicks a non-active option
- **THEN** the option becomes active (`aria-pressed="true"`, active style) and the same value id previously emitted by the `<select>` is persisted

#### Scenario: Keyboard navigation
- **WHEN** an option has focus and the user presses ArrowRight or ArrowLeft
- **THEN** focus moves to the next or previous option; Enter or Space selects the focused option

### Requirement: Permission mode as option list
The chat composer's permission mode control (safe / balanced / auto) SHALL render as an option list instead of a dropdown.

#### Scenario: Mode change persists
- **WHEN** the user clicks "Auto" in the permission option list
- **THEN** the approval mode is set to `auto` (same backend call as before) and a toast confirms the change

### Requirement: Effort level as option list
The chat composer's effort selector SHALL render the model's supported efforts as an option list. When a model supports exactly one effort, the control SHALL render as a static label without buttons.

#### Scenario: Effort visible without dropdown
- **WHEN** the selected model supports low/medium/high efforts
- **THEN** all three render as square buttons and the active effort is visually marked

### Requirement: Plan forms use option lists
The plan promotion form (`PlanPanel`) and the launch form (`PlanningInspector`) SHALL render engine, effort, workspace policy, scheduling mode, and finish policy as option lists. `EditPlanModal` SHALL render plan status as an option list. `IdeasPanel` SHALL render idea status as an option list. `FinalTouchesTab` SHALL render step kind as an option list.

#### Scenario: Launch form values unchanged
- **WHEN** the user selects an engine/workspace/scheduling option and launches
- **THEN** the launch request carries the identical value ids as the previous select-based form

### Requirement: Model pickers keep the card catalog
Model and provider selection SHALL continue to use the existing card-based catalog. Dynamic lists (runtime profiles, git AI provider/model, idea category filter) SHALL NOT be converted to option lists in this change.

#### Scenario: Model picker unchanged
- **WHEN** the user opens the model picker
- **THEN** the card-based provider/model catalog renders as before
