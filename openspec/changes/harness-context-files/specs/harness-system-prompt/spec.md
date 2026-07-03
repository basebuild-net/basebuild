## ADDED Requirements

### Requirement: Deterministic prompt assembly
Native chat sessions SHALL assemble their system prompt in a fixed order: (1) base harness prompt, (2) project schematic, (3) context files (repo-root-first, project-dir-last so nearer files override), (4) skills metadata list. Each part SHALL be individually token-accounted and the assembly SHALL be identical for identical inputs.

#### Scenario: Ordered assembly
- **WHEN** a session starts in a project with a schematic, a root AGENTS.md, and discovered skills
- **THEN** the system prompt contains all four parts in the fixed order, each delimited and attributed to its source path

#### Scenario: Deterministic output
- **WHEN** two sessions start in the same project with unchanged files
- **THEN** both receive byte-identical system prompts

### Requirement: Size caps and budget integration
Each context part SHALL respect a configurable size cap (head-truncated with an explicit truncation marker naming the source file). Total context-part tokens SHALL be reported into the session's context budget accounting so the `native-agent-loop` budget guard sees the true baseline.

#### Scenario: Oversized context file
- **WHEN** an AGENTS.md exceeds its cap
- **THEN** the injected part is head-truncated with a marker naming the file and omitted size, and the session still starts

### Requirement: Skills metadata not bodies
The system prompt SHALL list discovered skills as name + description only; skill bodies SHALL only enter the conversation on demand (e.g. `read_skill`, `/skill:<name>`).

#### Scenario: Skill listed then fetched
- **WHEN** a session starts with 10 discovered skills
- **THEN** the prompt grows by only the metadata lines, and requesting one skill injects only that skill's body
