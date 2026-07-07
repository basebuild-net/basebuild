# source-control-resilience Specification (delta)

## ADDED Requirements

### Requirement: Empty And Unborn Repositories Are First-Class
The source control surface SHALL handle repositories whose HEAD does not
resolve (fresh `git init`, no commits) as a normal state: status, staging, and
the untracked file list SHALL work; commit history SHALL present a
"No commits yet" empty state; and the initial commit SHALL be creatable from
the panel. Raw git fatal output (e.g.
`fatal: your current branch appears to be broken`) SHALL never render as the
panel body.

#### Scenario: Unborn HEAD shows untracked files
- **WHEN** the active project is a git repository with no commits and has
  untracked or staged files
- **THEN** the Changes view lists them with working stage/unstage actions and
  no error banner

#### Scenario: History empty state instead of fatal
- **WHEN** the History view opens for a repository with no commits
- **THEN** it shows a "No commits yet" empty state — commit-log failures caused
  by an unresolvable HEAD are treated as an empty history, not an error

#### Scenario: Initial commit from the panel
- **WHEN** the user stages files in a no-commit repository and commits
- **THEN** the initial commit is created, and the panel transitions to the
  normal populated state (branch resolves, history shows the commit)

### Requirement: Actionable Git Error Surfacing
When a git operation genuinely fails, the surface SHALL show a concise,
classified message (what failed, in which repository state) with the raw
output available behind an expandable detail — never a bare `exit Some(128)`
dump as the primary UI.

#### Scenario: Real failure stays readable
- **WHEN** a git command fails for a reason other than a recognized benign
  state (unborn HEAD, non-repo)
- **THEN** the panel shows a one-line classified error with the full output
  expandable, and the rest of the panel (tabs, other views) remains usable
