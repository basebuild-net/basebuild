## ADDED Requirements

### Requirement: Single resolved skill set
The system SHALL resolve one skill set from defined roots (bundled app skills,
plus a user skills directory) with deterministic precedence (user overrides
bundled on name collision), and both runtimes SHALL consume it: native
harness planning/schematic turns read skill content from the registry, and
OMP sessions launched by the app are provisioned to discover the same skills.
Skill content is instructions, not code: it SHALL be injected as prompt
context only and never executed.

#### Scenario: Both runtimes see the same skill
- **WHEN** a skill exists in the resolved registry
- **THEN** a native planning turn derives its instructions from that content
  and an app-launched OMP session lists the same skill

#### Scenario: User skill overrides bundled
- **WHEN** a user-directory skill shares a name with a bundled skill
- **THEN** the registry resolves to the user version everywhere, and the
  Settings listing marks the override

### Requirement: Skills listing in Settings
Settings SHALL list the resolved skills with name, description, source
(bundled/user/override), and which runtimes consume each. The listing SHALL
refresh without restart when the user skills directory changes.

#### Scenario: Inspect resolved skills
- **WHEN** the user opens Settings → Skills
- **THEN** every resolved skill shows its name, description, source, and
  consuming runtimes, each row with a `title=` tooltip
