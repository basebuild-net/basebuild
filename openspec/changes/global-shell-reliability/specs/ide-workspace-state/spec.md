# Spec Delta: ide-workspace-state

## ADDED Requirements

### Requirement: Startup Restore Phase Visibility

The system SHALL expose a restore phase state during workspace restore that the shell can surface to the user. The phases SHALL include at minimum: starting, restoring, detecting, resolving, and ready. The system SHALL set the phase to ready only after all restore subsystems have resolved or failed.

#### Scenario: Restore phases progress
- **WHEN** the app launches and the workspace restore pipeline runs
- **THEN** the restore phase state transitions through starting → restoring → detecting → resolving → ready, and each phase is observable by the shell

#### Scenario: Ready phase set on completion
- **WHEN** all restore subsystems have resolved or failed
- **THEN** the restore phase is set to ready, signaling the shell to dismiss the startup splash

### Requirement: Project-Switch Transition State In Restore

The system SHALL support a project-switch transition state that is set immediately when a project switch is requested and cleared when the target project's restore completes. The transition state SHALL identify the target project by path.

#### Scenario: Switch state set immediately
- **WHEN** the user requests a project switch to project B
- **THEN** a transition state identifying project B is set immediately, before any restore subsystem resolves

#### Scenario: Switch state cleared on completion
- **WHEN** project B's restore subsystems resolve or fail
- **THEN** the transition state is cleared, signaling the shell to render project B's panels
