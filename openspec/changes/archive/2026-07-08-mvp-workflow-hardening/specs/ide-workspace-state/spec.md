# ide-workspace-state Specification

## ADDED Requirements

### Requirement: Restore the most recently focused workspace
The system SHALL persist the most recently focused project on every successful project selection and SHALL restore that project, its last session, chat, active panel, and panel layout on restart. “Recent project” ordering SHALL NOT substitute for explicit last-focus state.

#### Scenario: Restart after selecting a non-first project
- **WHEN** project C is focused, its second chat and schematic panel are active, and the app restarts
- **THEN** project C, that chat, and that panel regain focus after the atomic loading boundary completes

### Requirement: Project state is isolated during restore
Project restore SHALL be keyed by project and activation generation. Session/chat/model/planning state SHALL remain isolated, and orphan detection/persistence SHALL not run against a project until its restore has completed.

#### Scenario: Prior project restore completes late
- **WHEN** project A's restore completes after the user has activated project B
- **THEN** A's response is discarded, B remains active, and no false orphan warning, duplicate session, or A-derived model/count is produced
