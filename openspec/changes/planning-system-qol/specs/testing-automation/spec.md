## ADDED Requirements

### Requirement: Test database isolation
Automated tests (Rust unit/integration and any harness that exercises
storage) SHALL run against an isolated `BASEBUILD_HOME` (temp directory) and
MUST NOT read or write the developer's real `~/.basebuild/state.db`. A
shared test-util constructor SHALL provision the isolated home, and CI/test
review SHALL treat writes to the real profile as failures.

#### Scenario: Tests leave the user DB untouched
- **WHEN** `cargo test` runs on a developer machine with an existing
  `~/.basebuild/state.db`
- **THEN** no rows are added, modified, or deleted in that database (e.g. no
  `/test/project-*` fixtures appear in `chat_model_defaults`)

#### Scenario: Test home auto-provisioned
- **WHEN** a storage-touching test constructs its service under test
- **THEN** the test helper sets `BASEBUILD_HOME` to a fresh temp directory
  scoped to that test and cleans it up afterward
