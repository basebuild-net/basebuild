# schematic-wizard Specification


### Requirement: Wizard flows
The system SHALL provide a schematic wizard as one of the app's two primary planning features: guided **create** (no schematic), **edit** (per section), and **re-align** (drift audit) flows, each running as a visible chat turn driven by the bundled `basebuild-project-schematic` skill with the health report provided as turn context. Schematic writes SHALL be approval-gated: the proposed document or per-section diff is shown and written only on explicit user approval.

#### Scenario: Create walks blueprint first
- **WHEN** the user starts the wizard with no schematic
- **THEN** the turn asks the blueprint questions first (archetype, team size, stage), then walks the remaining sections with repository-fact prefill, and writes only after the user approves the assembled document

#### Scenario: Section-scoped edit
- **WHEN** the user starts the wizard from a specific section's card
- **THEN** the turn targets that section, preserves all other sections verbatim, and applies only approved edits

#### Scenario: Re-align from the wizard
- **WHEN** the user triggers re-align
- **THEN** the turn produces a per-section drift report with evidence (files, plan slugs) and applies only the edits the user approves

#### Scenario: No silent writes
- **WHEN** any wizard turn proposes schematic changes
- **THEN** nothing is written to `.basebuild/project-schematic.md` before the user approves the shown content

### Requirement: Blueprint context
The schematic template SHALL include a `## Blueprint` section capturing the project archetype (e.g. SaaS product, game, CLI tool, library, mobile/desktop app, website), team size (solo developer or N people), and stage (prototype, MVP, production). The wizard SHALL ask archetype-appropriate questions modeled on real-world blueprints for that archetype (e.g. a SaaS product is asked about its market/tenant/pricing shape; a solo-dev game is scoped with solo-developer assumptions). The blueprint SHALL feed planning generation: category and idea instructions include the archetype, team size, and stage as constraints.

#### Scenario: SaaS blueprint questioning
- **WHEN** the user identifies the project as a SaaS product in the wizard
- **THEN** subsequent questions follow the SaaS blueprint shape, and the written Blueprint section records archetype, team size, and stage

#### Scenario: Solo-dev scoping
- **WHEN** the blueprint records a solo developer
- **THEN** planning generation instructions include the solo-dev constraint, and generated ideas are scoped accordingly rather than assuming a team

#### Scenario: Blueprint feeds generation
- **WHEN** categories or ideas are generated for a project with a filled Blueprint
- **THEN** the assembled instructions contain the archetype, team size, and stage

### Requirement: End goals with nudges
The schematic template SHALL include an `## End goals` section holding time-boxed goals in the form `End goal of <period>: <plain statement>` (e.g. `End goal of 2026: …`, `End goal of July 2026: …`). Validation SHALL classify an end goal `missing` (none for the period kind) or `stale` (its period has passed). When the year-end or month-end goal is missing or stale, the app SHALL show a nudge — "Set a year-end and a month-end goal to keep things on track" — in the schematic tab and planning inspector, linking into the wizard. End goals SHALL feed the planning focus directive alongside Vision and Current priorities.

#### Scenario: Nudge when goals missing
- **WHEN** the schematic has no year-end or no month-end goal
- **THEN** the nudge appears in the schematic tab and planning inspector with an action that opens the wizard scoped to End goals

#### Scenario: Stale goal nudge
- **WHEN** an end goal's period has passed (e.g. `End goal of July 2026` in August 2026)
- **THEN** the nudge names the stale goal and offers the wizard to refresh it

#### Scenario: Goals steer generation
- **WHEN** planning generation runs with end goals present
- **THEN** the assembled instructions include the end goals, and ideas may anchor to them

### Requirement: AI-enhanced descriptions
Each schematic section SHALL offer an **Enhance** action: the user's plain words are rewritten by a chat turn into an agentic-optimized description (precise, structured, consumable by agents) while preserving the user's meaning and language where possible. The result SHALL be presented as a before/after diff and applied only on approval; the user's original text is never silently replaced.

#### Scenario: Enhance plain words
- **WHEN** the user clicks Enhance on a section containing plain, informal text
- **THEN** a turn proposes an agent-optimized rewrite shown as a diff against the current text, with approve and discard actions

#### Scenario: Enhancement is approval-gated
- **WHEN** the user discards a proposed enhancement
- **THEN** the section's text is unchanged on disk and in the view
