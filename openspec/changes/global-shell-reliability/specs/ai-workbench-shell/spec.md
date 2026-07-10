# Spec Delta: ai-workbench-shell

## ADDED Requirements

### Requirement: Left Column Shows Repo Identity And Agent Status

The system SHALL show git repo identity (host favicon, repo name, branch) and agent status indicators (animated dot: running/questioning/standby/idle) in each project row in the left column. All projects SHALL be visible without folding. This information SHALL be available at a glance without expanding or hovering.

#### Scenario: User identifies projects at a glance
- **WHEN** the left column renders with multiple projects
- **THEN** each project row shows its repo favicon, name, branch (if git), and agent status dot without requiring any expansion or hover

#### Scenario: User identifies active agent
- **WHEN** two projects have agent sessions and one is actively running
- **THEN** the running project shows a pulsing dot and the idle project shows a solid dot, distinguishable at a glance
