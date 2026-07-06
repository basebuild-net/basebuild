## MODIFIED Requirements

### Requirement: Configurable final-touch pipeline
The system SHALL support a per-project ordered list of final-touch steps executed when a plan run completes. Built-in step kinds SHALL include: run shell command (e.g. tests/build), validation prompt (harness reviews the diff against the plan's specs), git commit, and open pull request. Each step SHALL be individually enabled/disabled and configured in Settings. The open-pull-request step SHALL use the `gh` CLI when it is installed and authenticated; otherwise it SHALL push the run's branch and open the provider's compare / new-pull-request URL in the system browser. No token is stored for this step. The step SHALL always require explicit user confirmation at execution time and SHALL show exactly what will be pushed and opened.

#### Scenario: Steps run in order after completion
- **WHEN** a plan run completes and final touches are configured as [run tests, validation prompt, commit]
- **THEN** the steps execute sequentially, each recording status/output on the plan run, and the plan reaches `finished` only after all enabled steps succeed or are explicitly skipped

#### Scenario: Failing step blocks completion
- **WHEN** the "run tests" step exits non-zero
- **THEN** the pipeline halts, the plan stays `running` with a failure badge showing the step output, and the user can retry the step, skip it, or send the failure back to the run's chat session for fixing

#### Scenario: Pull request via gh CLI
- **WHEN** the open-pull-request step runs, `gh` is installed and authenticated, and the user confirms
- **THEN** the system pushes the run's branch and runs `gh pr create` targeting the repository's default branch, recording the resulting PR URL on the run

#### Scenario: Pull request via browser fallback
- **WHEN** the open-pull-request step runs, `gh` is not available, and the user confirms
- **THEN** the system pushes the run's branch and opens the GitHub compare / new-pull-request URL for `bb/<ref>-<slug>` → default branch in the system browser, recording the opened URL on the run

#### Scenario: No confirmation, no remote write
- **WHEN** the open-pull-request step is reached but the user does not confirm (or dismisses the recommendation)
- **THEN** no branch is pushed and no pull request is opened; the branch stays local and the run stays `finished`

### Requirement: No silent side effects
Final-touch steps that create commits, pushes, or pull requests SHALL only run when the user has explicitly enabled that step for the project, and the step configuration SHALL show exactly what will execute. Destructive or remote-writing steps SHALL default to disabled.

#### Scenario: PR step disabled by default
- **WHEN** a project has never configured final touches
- **THEN** completing a plan run performs no commits, pushes, or PRs; only explicitly enabled steps ever execute
