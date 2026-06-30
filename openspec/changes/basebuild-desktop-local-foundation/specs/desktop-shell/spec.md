## ADDED Requirements

### Requirement: Tauri Desktop Shell
The system SHALL provide a Windows-first Tauri v2 desktop application shell with a Rust core and a webview frontend.

#### Scenario: Launch desktop shell on Windows
- **WHEN** the user launches the application on Windows
- **THEN** the app opens a desktop window using the Tauri shell
- **AND** the Rust core is available for process, filesystem, Git, terminal, and update services

#### Scenario: Use custom webview UI
- **WHEN** the app renders its main interface
- **THEN** the UI uses custom webview-rendered components rather than native Win32 controls for core layout and panels

### Requirement: Dark Simple Interface
The system SHALL provide a dark-first, simple, clean interface optimized for local developer workflows.

#### Scenario: Render default theme
- **WHEN** the app starts for a first-time user
- **THEN** it renders the dark theme by default
- **AND** the main layout exposes only essential project, OMP, terminal, source-control, config, and update surfaces

### Requirement: Frontend Build Stack
The system SHALL use a frontend stack suitable for a local desktop webview, not a server-rendered web application.

#### Scenario: Build webview assets
- **WHEN** the frontend is built for production
- **THEN** Vite produces static web assets for Tauri to load inside the native webview
- **AND** no application server is required at runtime
