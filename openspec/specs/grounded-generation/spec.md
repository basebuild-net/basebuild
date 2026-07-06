# grounded-generation Specification


### Requirement: Skill-sourced generation instructions
Planning generation kinds (`category_generation`, `idea_generation`, `plan_generation`) SHALL derive their default instructions from the bundled skill content (`basebuild-planning`; schematic operations from `basebuild-project-schematic`) read at request time through the existing skill-reading path — not from hardcoded prompt strings duplicated in Rust. Planning Settings overrides SHALL take precedence over skill-derived defaults exactly as they take precedence over compiled defaults today.

#### Scenario: Defaults derive from the skill
- **WHEN** a planning generation turn runs with no user override for its kind
- **THEN** the effective instructions are assembled from the bundled skill's workflow content for that kind, and no legacy hardcoded prompt string is used

#### Scenario: Override still wins
- **WHEN** a Planning Settings override exists for a generation kind
- **THEN** the override is used verbatim for that kind's turn

#### Scenario: Skill update propagates
- **WHEN** the bundled skill content changes (e.g. app update) and no override exists
- **THEN** the next generation turn reflects the updated skill content without migration or restart

### Requirement: Agentic context gathering
Planning generation SHALL run as an agent turn with tool access (the existing tool loop and approval gateway, including MCP-provided tools). The turn's instructions SHALL require reading project sources before proposing: the schematic, convention files (`AGENTS.md` or equivalents), manifests, and the existing category/idea catalog. Context reads SHALL be visible in the turn's transcript. One-shot prompt stuffing with no tool phase SHALL NOT be the mechanism for planning generation.

#### Scenario: Reads precede proposals
- **WHEN** an idea or category generation turn runs
- **THEN** the transcript shows the model's context reads (schematic and project files) before any idea or category capture occurs

#### Scenario: Catalog awareness
- **WHEN** ideas are generated for a session that already has ideas
- **THEN** the turn reads the existing catalog and does not re-propose ideas already present (any status)

### Requirement: Grounding anchors on captured ideas
The structured idea-capture tool SHALL require a `grounding` field (concrete evidence: real files, functions, or observed gaps) and SHALL accept an optional `anchor` field naming the schematic element the idea serves (a Vision element, an End goal, or a Current priority). Captures without non-empty `grounding` SHALL be rejected by the tool. Both fields SHALL persist on the idea and survive restart.

#### Scenario: Capture requires grounding
- **WHEN** the model attempts to capture an idea with empty or missing `grounding`
- **THEN** the tool rejects the capture with an error naming the requirement, and no idea row is created

#### Scenario: Anchored idea persists
- **WHEN** an idea is captured with an `anchor` quoting a Current priority
- **THEN** the idea stores both fields, and they reload with the session after restart

### Requirement: Focus directive and drift resistance
Generation instructions SHALL include a focus directive assembled from the schematic: the primary goal, Vision, End goals, and Current priorities come first; work SHOULD serve one of them; the Blueprint (archetype, team size, stage) constrains scope; the project's niche constrains suggestions; generic filler is declined. Ideas captured without an `anchor` SHALL be flagged `outside current focus` wherever ideas render. When schematic health is not `complete`, invoking planning generation SHALL surface a warning naming the gap and offering the wizard first; the user MAY proceed anyway, and the turn then runs with whatever grounding exists.

#### Scenario: Focus directive in assembled instructions
- **WHEN** a generation turn is assembled for a project with a schematic
- **THEN** the instructions contain the schematic's Vision, End goals, Current priorities, and Blueprint constraints, and the directive to serve them first

#### Scenario: Outside-focus flag
- **WHEN** an idea is captured without an `anchor`
- **THEN** the idea is flagged `outside current focus` in the chat card and the inspector

#### Scenario: Soft gate on incomplete schematic
- **WHEN** the user invokes generation while schematic health is `partial` or `missing`
- **THEN** a warning names the incomplete or missing sections and offers the wizard, with an explicit option to proceed anyway

#### Scenario: Proceeding ungated is recorded
- **WHEN** the user proceeds with generation despite a `missing` schematic
- **THEN** the turn runs, and its transcript notes that generation ran without a schematic
