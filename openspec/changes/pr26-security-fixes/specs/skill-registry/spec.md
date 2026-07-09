# skill-registry Security Specification (delta)

## MODIFIED Requirements

### Requirement: Skill Name Validation
The system SHALL validate skill names before using them in any filesystem
path operation. Skill names SHALL match the pattern
`^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$` and SHALL NOT contain path separators
(`/`, `\`), traversal sequences (`..`), null bytes, colons, or whitespace.

#### Scenario: Valid skill name resolves
- **WHEN** a user runs `/skill:basebuild-session-title`
- **THEN** the system reads `SKILL.md` from the resolved skill directory and returns its content

#### Scenario: Path traversal rejected
- **WHEN** a user runs `/skill:../../../etc/passwd`
- **THEN** the system rejects the skill name with a validation error and does not read any file

#### Scenario: Path separator rejected
- **WHEN** a skill name contains `/` or `\`
- **THEN** the system rejects the skill name with a validation error

#### Scenario: Null byte rejected
- **WHEN** a skill name contains a null byte
- **THEN** the system rejects the skill name with a validation error

#### Scenario: Empty skill name rejected
- **WHEN** a skill name is empty
- **THEN** the system rejects the skill name with a validation error

#### Scenario: User override still wins
- **WHEN** a user has a skill in `~/.basebuild/skills/<name>/SKILL.md` and the bundled skills directory has a skill with the same name
- **AND** the skill name passes validation
- **THEN** the user version is returned and the bundled version is not read
