# schematic-enhance Specification (delta)

## ADDED Requirements

### Requirement: Per-section Enhance action
Each schematic section card SHALL offer an **Enhance** action that rewrites the
section's current text into an agent-optimized description via a chat turn,
preserving the user's meaning and language where possible. The proposal SHALL be
presented as a before/after diff and applied only on explicit approval; the
section text SHALL NOT be replaced on disk (`.basebuild/project-schematic.md`) or
in the view before approval.

#### Scenario: Enhance plain words
- **WHEN** the user clicks Enhance on a section containing plain, informal text
- **THEN** a chat turn proposes an agent-optimized rewrite shown as a diff against the current text, with Approve and Discard actions

#### Scenario: Approve writes once
- **WHEN** the user approves a proposed enhancement
- **THEN** the section's text in `.basebuild/project-schematic.md` is replaced with the approved rewrite exactly once, all other sections are preserved verbatim, and the diff view closes

#### Scenario: Discard leaves text unchanged
- **WHEN** the user discards a proposed enhancement
- **THEN** the section's text is unchanged on disk and in the view

#### Scenario: Empty section
- **WHEN** the user triggers Enhance on a section with no content
- **THEN** the action is unavailable or prompts the user to write something first, rather than fabricating content

### Requirement: Enhance turn transparency and safety
The Enhance turn SHALL run as a visible chat turn consistent with the schematic
wizard, and SHALL degrade safely when it cannot run.

#### Scenario: Turn visible in transcript
- **WHEN** an Enhance turn runs
- **THEN** it appears as a chat turn (reasoning fold + transcript) like other wizard turns, and its output is captured as the proposed rewrite rather than written directly

#### Scenario: Non-tool model
- **WHEN** the selected model lacks tool/agent capability
- **THEN** the Enhance action is disabled with a `title` tooltip explaining why, rather than starting a turn that errors midway

#### Scenario: Turn failure or cancel
- **WHEN** the Enhance turn fails or the user cancels it
- **THEN** the section text is unchanged and the UI shows a dismissible error, never a partial write
