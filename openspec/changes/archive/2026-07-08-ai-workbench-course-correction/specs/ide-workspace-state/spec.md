# ide-workspace-state Specification

## MODIFIED Requirements

### Requirement: Restore the most recently focused workspace
The system SHALL restore the most recently focused project, chat, panel, and
valid session provider/model/effort after restart. Restoration SHALL complete
behind a project loading boundary so no default project, stale chat, or fallback
model flashes before the restored state is ready.

#### Scenario: App restarts after provider and project change
- **WHEN** the user last focused project C and an Anthropic chat using model M
- **THEN** restart focuses project C, the same chat/panel, and Anthropic model M
  without first displaying project A or another provider/model

### Requirement: Project state is isolated during restore
The system SHALL clear prior project content immediately on project selection,
commit restored sessions/panels/planning/catalog/source state as one guarded
generation, and ignore late results from prior projects. The loading surface
SHALL remain stable instead of shuffling partially restored screens.

#### Scenario: User switches projects during restore
- **WHEN** project B is selected before project A finishes restoring
- **THEN** only B's final state becomes visible and no A chat, plan count,
  provider selection, branch, modal content, or warning appears under B

