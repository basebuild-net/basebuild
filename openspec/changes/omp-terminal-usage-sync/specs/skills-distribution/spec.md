## ADDED Requirements

### Requirement: Skills are bundled with packaged builds

Packaged builds SHALL include the repository `skills/` directory (each
`<skill>/SKILL.md`) as an application resource, and `read_skill` SHALL
resolve it in both dev (repo-relative) and production (bundled resources)
layouts. A packaged build MUST NOT ship with zero readable skills.

#### Scenario: Installed build reads a skill

- **WHEN** the installed app calls `read_skill("basebuild-planning")`
- **THEN** the skill's frontmatter and content load successfully from the
  bundled resources

#### Scenario: Missing skill surfaces a clear error

- **WHEN** a skill lookup fails at runtime
- **THEN** the caller receives an error naming the skill and the resolved
  search path, and the failure is visible in the log surface (not a silent
  feature no-op)

### Requirement: Skill metadata is enumerable

The system SHALL expose a listing of bundled skills (name, description)
so UI surfaces and sync/export flows can enumerate available skills
without hardcoding skill names.

#### Scenario: List bundled skills

- **WHEN** a caller requests the skill list
- **THEN** every bundled skill directory with a valid SKILL.md appears
  with its parsed name and description
