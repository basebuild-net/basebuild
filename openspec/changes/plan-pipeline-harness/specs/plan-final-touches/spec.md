## ADDED Requirements

### Requirement: Configurable final-touch pipeline
The system SHALL support a per-project ordered list of final-touch steps executed when a plan run completes. Built-in step kinds SHALL include: run shell command (e.g. tests/build), validation prompt (harness reviews the diff against the plan's specs), git commit, and open pull request. Each step SHALL be individually enabled/disabled and configured in Settings.

#### Scenario: Steps run in order after completion
- **WHEN** a plan run completes and final touches are configured as [run tests, validation prompt, commit]
- **THEN** the steps execute sequentially, each recording status/output on the plan run, and the plan reaches `finished` only after all enabled steps succeed or are explicitly skipped

#### Scenario: Failing step blocks completion
- **WHEN** the "run tests" step exits non-zero
- **THEN** the pipeline halts, the plan stays `running` with a failure badge showing the step output, and the user can retry the step, skip it, or send the failure back to the run's chat session for fixing

### Requirement: No silent side effects
Final-touch steps that create commits, pushes, or pull requests SHALL only run when the user has explicitly enabled that step for the project, and the step configuration SHALL show exactly what will execute. Destructive or remote-writing steps SHALL default to disabled.

#### Scenario: PR step disabled by default
- **WHEN** a project has never configured final touches
- **THEN** completing a plan run performs no commits, pushes, or PRs; only explicitly enabled steps ever execute
