# planning-file-schema Specification (delta)

## ADDED Requirements

### Requirement: Planning data layout
The planning file schema SHALL live under the project's `.basebuild/` directory as `categories.md`, `ideas/` (one markdown file per idea), and `plans/` (one folder per plan, with `plans/archive/` for archived plans), coexisting with app-managed entries (`config.toml`, `prompts/`, `workflows/`, `cache/`, `logs/`) without modifying them.

#### Scenario: Fresh initialization
- **WHEN** the skill initializes planning in a project with no `.basebuild/` directory
- **THEN** it creates `.basebuild/categories.md`, `.basebuild/ideas/`, and `.basebuild/plans/` plus a minimal `config.toml` containing a `[planning]` table, and does not create app-owned entries (`cache/`, `logs/`, `prompts/`, `workflows/`)

#### Scenario: Coexistence with app data
- **WHEN** the skill initializes planning in a project where the desktop app already created `.basebuild/`
- **THEN** planning files are added alongside; existing files are preserved byte-for-byte except `config.toml`, which gains only the `[planning]` table

#### Scenario: Version-control visibility
- **WHEN** planning files are created in a project whose `.basebuild/.gitignore` follows the app default (`cache/`, `logs/`, `runs/`, `state.db`)
- **THEN** `categories.md`, `ideas/`, and `plans/` remain committable (not ignored)

### Requirement: Category registry format
`categories.md` SHALL hold the category registry: one entry per category with a kebab-case slug, display name, and a one-line scope description. Regeneration SHALL merge — user-added or user-edited categories are preserved, never silently dropped.

#### Scenario: Generated categories persisted
- **WHEN** the skill generates categories for a project
- **THEN** each category is written to `categories.md` with slug, name, and description

#### Scenario: Regeneration preserves user entries
- **WHEN** categories are regenerated and `categories.md` already contains user-defined categories
- **THEN** existing entries stay; new categories are appended or proposed for merge, and removals occur only with explicit user confirmation

### Requirement: Idea file format
Each idea SHALL be one file `ideas/<slug>.md` with YAML frontmatter containing at least `title`, `category` (slug), `status`, `created` (ISO date), and — once promoted — `plan` (relative path to the plan folder). The body holds the description and its grounding. Idea `status` SHALL be one of `concept`, `picked`, `archived`.

#### Scenario: Picked idea written
- **WHEN** the user picks a generated idea
- **THEN** `ideas/<slug>.md` is written with `status: picked`, the generating category slug, and a body citing the concrete files or observations that grounded the idea

#### Scenario: Promotion back-links the plan
- **WHEN** an idea is promoted into a plan
- **THEN** the idea file gains `plan: plans/<plan-slug>/` and keeps `status: picked`

#### Scenario: Slug collision
- **WHEN** a new idea derives a slug that already exists in `ideas/`
- **THEN** the skill suffixes a numeric increment (`<slug>-2`) instead of overwriting

### Requirement: Plan folder format
Each plan SHALL be a folder `plans/<slug>/` containing `plan.md` — YAML frontmatter with at least `title`, `status`, `created`, `ideas` (list of source idea slugs), `engine` (`native` or the engine skill name), and `external` (path to external artifacts, present only when an external engine owns them). Native-engine plans SHALL additionally contain `tasks.md` (ordered checkbox list) and MAY contain `design.md`. Plan `status` SHALL be one of `draft`, `planned`, `ready`, `running`, `finished`, `cancelled`.

#### Scenario: Native plan artifacts
- **WHEN** a plan is generated with the native engine
- **THEN** `plans/<slug>/` contains `plan.md` (goal, context, constraints, non-goals, verification) and `tasks.md`, and `plan.md` frontmatter reads `engine: native` with no `external` key

#### Scenario: External-engine plan record
- **WHEN** a plan is generated through a detected planning skill (e.g. OpenSpec)
- **THEN** `plans/<slug>/plan.md` records `engine: <skill-name>` and `external: <path>` (e.g. `openspec/changes/<slug>/`), contains no duplicate task list, and still owns the `status` field

#### Scenario: Task progress is parseable
- **WHEN** a native plan's `tasks.md` contains `- [ ]` / `- [x]` items
- **THEN** completion is derivable by counting checkboxes, with no other progress bookkeeping required

### Requirement: Plan status lifecycle
Plan statuses SHALL be snake_case with lifecycle `draft → planned → ready → running → finished`; `cancelled` SHALL be reachable from any non-terminal status. `planned` means planning artifacts are complete and thought out, independent of which engine produced them.

#### Scenario: Draft to planned
- **WHEN** a plan's artifacts are fully generated (native files written, or the external engine's artifacts exist)
- **THEN** status moves `draft → planned`

#### Scenario: Cancelled from running
- **WHEN** the user cancels a `running` plan
- **THEN** status becomes `cancelled` and all artifacts are kept

### Requirement: Archive semantics
Archiving SHALL move a `finished` or `cancelled` plan folder to `plans/archive/<slug>/` with contents intact; ideas SHALL archive in place via `status: archived`.

#### Scenario: Plan archived
- **WHEN** the user archives a finished plan
- **THEN** the folder moves to `plans/archive/<slug>/` with files unmodified, and any idea linking to it is updated to the archive path

### Requirement: Config integration
Planning configuration SHALL live in a `[planning]` table inside `.basebuild/config.toml` (created minimally when absent), recording at least `engine`. The skill SHALL never remove or rewrite other tables or keys in that file.

#### Scenario: Existing app config preserved
- **WHEN** `config.toml` exists with `version`, `active_pack`, and `[project]` entries
- **THEN** adding `[planning]` with `engine = "native"` leaves every other line unchanged

#### Scenario: Missing config created minimally
- **WHEN** no `config.toml` exists at engine-selection time
- **THEN** the skill writes one containing `version = 1` and the `[planning]` table only
