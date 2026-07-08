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
The system SHALL render the Project Schematic in a dedicated project modal with
health, section status, raw/edit actions, and a managed questionnaire/activity
region. Starting or continuing the wizard SHALL keep progress and `ask_user`
cards in that modal and SHALL NOT create a schematic workspace chat or route to
Plans & Ideas.

#### Scenario: User starts the schematic wizard
- **WHEN** the user opens Schematic and starts the wizard
- **THEN** repository-prefill activity and the next clickable question appear
  in the Schematic modal and the active chat/workspace remains unchanged

#### Scenario: User reopens an incomplete wizard
- **WHEN** a project has a pending schematic question and the user reopens the
  Schematic modal
- **THEN** the same pending run and question are restored without duplication
### Requirement: Schematic health surfacing
Schematic health SHALL be visible where planning happens: a badge on the schematic tab header and in the planning inspector, with distinct `complete` / `partial` / `missing` states and explanatory tooltips naming incomplete sections. Health SHALL be recomputed when the schematic tab opens, after any schematic write, and after a wizard turn finishes.

#### Scenario: Badge reflects health
- **WHEN** the schematic is missing or partially filled
- **THEN** the schematic tab and planning inspector show the corresponding badge state with a tooltip naming the incomplete sections

#### Scenario: Health updates after fix
- **WHEN** a wizard turn writes an updated schematic
- **THEN** the badge recomputes without an app restart and reflects the new state
