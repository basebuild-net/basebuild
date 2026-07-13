## ADDED Requirements

### Requirement: Versioned storage initialization
Basebuild SHALL run the full SQLite schema creation and migration sequence only when the persisted schema version requires it, while preserving idempotent preparation for fresh and legacy databases.

#### Scenario: Subsequent application launch
- **WHEN** Basebuild opens an already-current state database
- **THEN** it skips the full table and migration probe sequence and makes recent projects available through the lightweight connection path

#### Scenario: First launch or legacy database
- **WHEN** Basebuild opens a fresh or older state database
- **THEN** it completes required schema preparation before serving dependent reads and records the current schema version

### Requirement: Responsive project discovery
Basebuild SHALL render cached recent-project metadata immediately when available and SHALL refresh authoritative local state without blocking the shell on every project's session history.

#### Scenario: Returning user launch
- **WHEN** a returning user launches Basebuild with a valid recent-project cache
- **THEN** project names are visible on the first interactive render while the local database refresh proceeds

#### Scenario: Project metadata warm-up
- **WHEN** multiple recent projects exist
- **THEN** the active project's sessions are prioritized and remaining project session lists hydrate after the shell is interactive without freezing project selection

### Requirement: Local-only startup cache
The startup project cache SHALL remain local to the desktop webview and SHALL be replaced by authoritative SQLite results after launch.

#### Scenario: Stale cached project
- **WHEN** cached metadata differs from the SQLite recent-project list
- **THEN** Basebuild replaces the stale display with the authoritative local result without opening, modifying, or uploading the cached project
