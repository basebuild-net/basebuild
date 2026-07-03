## ADDED Requirements

### Requirement: Console-Free Packaged Launch

Packaged Windows builds SHALL launch only the Basebuild desktop window and tray icon unless the user explicitly opens an external application.

#### Scenario: Launch from Explorer
- **WHEN** a user launches the installed Basebuild app from Explorer or the Start menu
- **THEN** no separate `cmd.exe`, `powershell.exe`, `omp`, or Rust console window appears

#### Scenario: Startup update check runs
- **WHEN** the automatic startup update check runs
- **THEN** the check does not create any visible console window

### Requirement: Hidden Internal OMP Helpers

Non-interactive OMP helper commands SHALL run as hidden/internal processes on Windows.

#### Scenario: OMP status probe runs
- **WHEN** Basebuild runs `omp --version`, `omp config path`, `omp stats --json`, `omp usage --json`, or `omp config list --json` for diagnostics or account sync
- **THEN** no visible console window or taskbar tab appears for the helper process

#### Scenario: OMP stream command runs
- **WHEN** Basebuild starts an internal OMP stream for a skill, debug panel action, or chat adapter
- **THEN** output is delivered inside Basebuild and no separate `cmd`/`omp` window is shown

#### Scenario: User-created terminal remains visible inside Basebuild
- **WHEN** the user explicitly creates a Terminal workspace tab
- **THEN** the PTY-backed shell is visible only inside the Basebuild terminal panel and not as an external Windows console

### Requirement: Terminal-Free Startup And Restore

Basebuild SHALL NOT create, focus, or imply a running terminal on launch, project selection, or session restore unless the user explicitly requested a terminal.

#### Scenario: Fresh app launch
- **WHEN** Basebuild starts with no active project
- **THEN** the workspace shows the project-open empty state and no terminal process is created

#### Scenario: Project selection without tabs
- **WHEN** the user opens or selects a project whose active session has no live non-terminal tab
- **THEN** the workspace shows a neutral project/schematic empty state instead of an empty terminal panel

#### Scenario: Restore stale terminal tabs
- **WHEN** a previous session contains terminal tabs whose PTY processes are not alive after restart
- **THEN** Basebuild does not auto-focus those stale terminal tabs as if a terminal is running

#### Scenario: Explicit terminal action
- **WHEN** the user clicks `+` → `Terminal` or an explicit `Open in terminal` action
- **THEN** Basebuild creates one internal PTY process, attaches it to the new terminal tab, and records enough state for the Debug panel to list it
