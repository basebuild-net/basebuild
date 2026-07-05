# schematic-skill-workflow Specification (delta)

## ADDED Requirements

### Requirement: Portable schematic skill packaging
The schematic skill SHALL remain a single directory `skills/basebuild-project-schematic/` whose `SKILL.md` frontmatter contains exactly `name` and `description` (each on a single line), valid for OMP, Claude Code, opencode, and the app's `read_skill` parser.

#### Scenario: App parses skill metadata
- **WHEN** `read_skill("basebuild-project-schematic")` runs
- **THEN** it returns the skill name and a non-empty description parsed from frontmatter

### Requirement: Schematic template
The skill SHALL emit `.basebuild/project-schematic.md` with the fixed section order: Purpose, Vision, Target users, Tech stack, Architecture notes, Design constraints, Development conventions, Current priorities, Open questions. `Vision` describes what the project should become — the gap between Vision and today is explicit fuel for idea generation. Core rules (invariants an agent must never break) live in Design constraints and Development conventions.

#### Scenario: Emitted document structure
- **WHEN** a schematic is created or fully regenerated
- **THEN** the document contains exactly the template's sections in order, each filled from user answers or verified project facts — never fabricated

#### Scenario: Legacy schematic without Vision
- **WHEN** the skill updates a schematic created before v2
- **THEN** it offers to add the `Vision` section, preserving all existing sections verbatim unless the user changes them

### Requirement: Guided questionnaire
Creating a schematic SHALL run as a section-by-section interview: focused questions, one section at a time, user's own language preferred, no fabricated answers. When information already exists in the repository (manifests, README, conventions files) the skill SHALL propose it as a prefill for confirmation instead of asking cold.

#### Scenario: New schematic
- **WHEN** no `.basebuild/project-schematic.md` exists and the user invokes the skill
- **THEN** the interview walks the template sections in order and writes the file only after the user confirms the final document

#### Scenario: Prefill from repository facts
- **WHEN** the tech stack is derivable from manifests (e.g. `package.json`, `Cargo.toml`)
- **THEN** the skill presents the derived stack for confirmation rather than asking the user to recite it

### Requirement: Update mode
Updating SHALL be per-section: show the current text, ask whether it still applies, rewrite only sections whose answers changed, and preserve unchanged sections verbatim.

#### Scenario: Single-section update
- **WHEN** the user updates only Current priorities
- **THEN** every other section survives byte-for-byte

### Requirement: Re-alignment mode
Re-alignment SHALL compare the schematic against observable reality — repository structure, manifests, conventions files, and `.basebuild` planning data (categories, idea themes, finished/running plans) — and produce a per-section drift report with proposed edits. Edits SHALL be applied only with explicit user approval, never silently.

#### Scenario: Drift detected
- **WHEN** finished plans or repo changes contradict the schematic (e.g. a Current priority shipped, a new subsystem exists, the stack changed)
- **THEN** the skill lists each drift with evidence (files, plan slugs) and a proposed section edit, applying only what the user approves

#### Scenario: No drift
- **WHEN** re-alignment finds the schematic accurate
- **THEN** the skill reports that explicitly and changes nothing

#### Scenario: Approval protection
- **WHEN** any mode would modify `.basebuild/project-schematic.md`
- **THEN** the full proposed content or diff is shown and written only after explicit user approval

### Requirement: Planning pairing
The schematic skill SHALL feed the planning skill: Vision and Current priorities are primary inputs for category and idea generation. When re-alignment observes newly `finished` plans in `.basebuild/plans/`, it SHALL offer a priorities/Vision refresh reflecting the completed work.

#### Scenario: Post-completion refresh offer
- **WHEN** re-alignment runs and `.basebuild/plans/` contains plans finished since the schematic's last update
- **THEN** the skill offers updated Current priorities text citing those plan slugs

#### Scenario: Planning skill consumes schematic
- **WHEN** the planning skill generates categories in a project with a schematic
- **THEN** the schematic's Vision and Current priorities demonstrably shape the proposed categories
