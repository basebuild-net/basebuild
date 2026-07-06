# planning-skill-workflow Specification


### Requirement: Portable skill packaging
The skill SHALL be a single directory `skills/basebuild-planning/` whose `SKILL.md` frontmatter contains exactly `name` and `description` (each on a single line), valid for OMP, Claude Code, opencode, and the app's `read_skill` parser. Detailed schema and templates SHALL live in `references/` files that `SKILL.md` instructs the agent to read on demand.

#### Scenario: App parses skill metadata
- **WHEN** `read_skill("basebuild-planning")` runs
- **THEN** it returns the skill name and a non-empty description parsed from frontmatter

#### Scenario: Standalone use outside this repo
- **WHEN** the skill directory is copied into any harness's skill location for an unrelated project
- **THEN** the workflow functions with no Basebuild app installed and no references to app-only features

### Requirement: Grounded project analysis
Before generating categories or ideas the skill SHALL analyze the project: `.basebuild/project-schematic.md` when present, convention files (`AGENTS.md` or equivalents), manifests, and recent git history. Generated ideas MUST cite concrete grounding (real files, functions, or observed gaps); fabricated references are prohibited.

#### Scenario: Schematic present
- **WHEN** `.basebuild/project-schematic.md` exists
- **THEN** generated categories and ideas reflect its priorities and constraints

#### Scenario: Bare repository
- **WHEN** no schematic or convention files exist
- **THEN** the skill analyzes structure and manifests directly and proceeds without fabricating project facts

### Requirement: Category workflow
The skill SHALL load categories from `categories.md` when present, otherwise generate 3–8 project-specific categories and persist them. The user SHALL be able to add, rename, and remove categories before ideation.

#### Scenario: First run
- **WHEN** no `categories.md` exists and the user asks for ideas
- **THEN** the skill proposes generated categories, applies user edits, persists the registry, then proceeds to ideation

#### Scenario: Subsequent run
- **WHEN** `categories.md` exists
- **THEN** the skill uses it as-is and offers (without forcing) regeneration

### Requirement: Iterative ideation loop
Ideation SHALL run in rounds: the user selects one or more categories; the skill presents numbered ideas (title plus one–two sentences of grounding each); the user picks by number; the user then chooses to continue (more in the same category, another category, or freeform) or stop. Picked ideas are written as `status: picked` files; unpicked ideas are not persisted unless the user asks to keep them as `concept`.

#### Scenario: Pick and continue
- **WHEN** the user picks ideas 2 and 5 and asks for more in the same category
- **THEN** ideas 2 and 5 are written to `ideas/` and the next round excludes already-presented suggestions

#### Scenario: Stop
- **WHEN** the user ends the loop
- **THEN** the skill summarizes picked ideas and offers promotion to plans

#### Scenario: Duplicate avoidance
- **WHEN** ideas are generated and `ideas/` already contains entries
- **THEN** existing ideas (any status) are not re-suggested

### Requirement: Engine detection and selection
The skill SHALL determine the planning engine from the `[planning]` table in `config.toml`; when unset it SHALL inspect the harness's available skills for planning/spec workflows (e.g. OpenSpec propose), offer the user a choice between detected engines and the native engine, and persist the answer. When no planning skills are detected the native engine is used without prompting. Detection is skill-based; the skill SHALL NOT probe for foreign plan files or directories.

#### Scenario: Planning skills detected, first run
- **WHEN** the harness exposes OpenSpec skills and `[planning]` has no `engine`
- **THEN** the skill asks the user to choose (native vs each detected engine) and writes the choice to `config.toml`

#### Scenario: Engine already configured
- **WHEN** `engine` is set in `config.toml`
- **THEN** no engine prompt occurs and the configured engine is used

#### Scenario: Nothing detected
- **WHEN** no planning skills are available in the harness
- **THEN** the native engine is used and persisted without interrogation

### Requirement: Idea promotion
Promotion SHALL turn one or more picked ideas into a plan folder; the user MAY bundle several ideas into one plan or promote individually. With the native engine the skill generates `plan.md` + `tasks.md` (+ `design.md` when complexity warrants) and sets `status: planned` after user review. With an external engine the skill hands off to that engine's workflow, records `engine` + `external` in `plan.md`, and sets `status: planned` once the engine's artifacts exist. In both cases each source idea gains a `plan:` back-link.

#### Scenario: Native promotion
- **WHEN** the user promotes picked ideas with `engine = "native"`
- **THEN** a plan folder with executor-proof artifacts is created, the plan status becomes `planned` after review, and idea files are back-linked

#### Scenario: External promotion via OpenSpec
- **WHEN** `engine` names an OpenSpec-style skill
- **THEN** the plan slug is reused as the change name, artifacts are produced by that workflow, and `plan.md` records `external: openspec/changes/<slug>/`

#### Scenario: Bundled promotion
- **WHEN** the user selects three picked ideas for one plan
- **THEN** a single plan folder lists all three slugs in `ideas` and each idea links to the same plan

### Requirement: Executor-proof artifact quality
Native plan artifacts SHALL be written for an executor with zero conversation context, assuming the executing model may be weaker than the planning model. `plan.md` MUST embed the goal, why-now, constraints (project conventions restated inline, not referenced from memory), explicit non-goals, affected paths, and verification commands. `tasks.md` items MUST be small, ordered, reference exact files, and carry acceptance criteria; each phase MUST end with a verification step. Guardrails ("do not touch X") MUST be explicit when analysis identified risk areas.

#### Scenario: Self-containment
- **WHEN** a native plan is generated
- **THEN** an executor reading only the plan folder plus the repository has every constraint, path, and verification command needed, with no dependence on the planning conversation

#### Scenario: Verification embedded
- **WHEN** `tasks.md` is generated for a code change
- **THEN** each phase ends with concrete check commands (build/test/lint appropriate to the project)

### Requirement: Lifecycle management and status board
The skill SHALL report a status board on request (ideas by status; plans by status with task progress) and drive transitions: `ready` on user approval, `running` when execution starts, task checkboxes updated as work completes, `finished` on completion, `cancelled` on abandonment, archive on request. For external-engine plans the skill SHALL derive progress from the engine's artifacts rather than duplicating them.

#### Scenario: Status board
- **WHEN** the user asks for planning status
- **THEN** the skill reads only `.basebuild/` (and recorded `external` paths) and reports counts plus per-plan progress without mutating anything

#### Scenario: Execution handoff
- **WHEN** the user starts work on a `ready` native plan
- **THEN** status flips to `running` and the executor is directed to follow `tasks.md`, checking items off as they complete

#### Scenario: External progress
- **WHEN** a plan's engine is external and its artifacts contain a task list
- **THEN** reported progress reflects the external checkboxes and the plan record gains no duplicate task list

### Requirement: Safety rules
As part of planning the skill SHALL NOT commit, push, install, or modify files outside `.basebuild/` and the configured engine's artifact directory; SHALL NOT overwrite existing planning files without surfacing the conflict; and SHALL NOT invent project facts, ideas grounded in nonexistent files, or statuses outside the schema.

#### Scenario: No silent VCS actions
- **WHEN** planning or promotion completes
- **THEN** no git commit or push has occurred; the skill may report a suggested commit point

#### Scenario: Overwrite guard
- **WHEN** a promotion targets a plan slug that already exists
- **THEN** the skill reports the collision and asks (new slug vs update) instead of overwriting
