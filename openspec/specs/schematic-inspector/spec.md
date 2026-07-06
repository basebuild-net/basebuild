# schematic-inspector Specification


### Requirement: Schematic parsing and validation
The system SHALL parse `.basebuild/project-schematic.md` into its template sections (Purpose, Vision, Blueprint, End goals, Target users, Tech stack, Architecture notes, Design constraints, Development conventions, Current priorities, Open questions) and validate completeness deterministically — pure Rust, no model calls. Each section SHALL be classified `filled`, `placeholder` (present but empty or still containing template scaffold text), or `missing`. Overall health SHALL be `complete` (all core sections filled), `partial` (schematic exists, some sections placeholder/missing), or `missing` (no schematic file). Legacy schematics SHALL parse with absent sections (e.g. `Vision`, `Blueprint`, `End goals`) reported `missing` and every present section evaluated normally.

#### Scenario: Complete schematic
- **WHEN** a schematic contains all template sections with real content
- **THEN** every section is `filled` and health is `complete`

#### Scenario: Placeholder detection
- **WHEN** a section exists but is empty or contains template scaffold text (e.g. `<one paragraph>`)
- **THEN** that section is classified `placeholder` and health is `partial`

#### Scenario: Missing schematic
- **WHEN** the project has no `.basebuild/project-schematic.md`
- **THEN** health is `missing` and the per-section report lists every section as `missing`

#### Scenario: Legacy schematic
- **WHEN** a pre-v2 schematic without `## Vision`, `## Blueprint`, or `## End goals` is inspected
- **THEN** those sections are reported `missing`, other sections classify normally, and health is at most `partial`

### Requirement: Structured schematic view
The schematic workspace tab SHALL render the parsed schematic as structured section cards in template order by default: Purpose and Vision as prose blocks, Blueprint as labeled facts (archetype, team size, stage), End goals as dated goal rows, Current priorities as a ranked list, Design constraints and Development conventions as the project's core rules, remaining sections as labeled blocks. Each card SHALL show its fill state; `placeholder`/`missing` sections SHALL render as actionable placeholders explaining what the section steers (e.g. "Vision steers idea generation"). A raw markdown view SHALL remain available as an explicit toggle, and editing SHALL remain available from both views. All interactive elements SHALL have `title=` tooltips and 0px radius.

#### Scenario: Structured view is the default
- **WHEN** the user opens the schematic tab for a project with a schematic
- **THEN** section cards render in template order with fill states, not a raw text dump

#### Scenario: Raw view toggle
- **WHEN** the user toggles the raw view
- **THEN** the exact file content renders unmodified, and the toggle state persists while the tab is open

#### Scenario: Missing section affordance
- **WHEN** a section is `placeholder` or `missing`
- **THEN** its card shows what the section is for and an action that starts the wizard scoped to that section

### Requirement: Schematic health surfacing
Schematic health SHALL be visible where planning happens: a badge on the schematic tab header and in the planning inspector, with distinct `complete` / `partial` / `missing` states and explanatory tooltips naming incomplete sections. Health SHALL be recomputed when the schematic tab opens, after any schematic write, and after a wizard turn finishes.

#### Scenario: Badge reflects health
- **WHEN** the schematic is missing or partially filled
- **THEN** the schematic tab and planning inspector show the corresponding badge state with a tooltip naming the incomplete sections

#### Scenario: Health updates after fix
- **WHEN** a wizard turn writes an updated schematic
- **THEN** the badge recomputes without an app restart and reflects the new state
