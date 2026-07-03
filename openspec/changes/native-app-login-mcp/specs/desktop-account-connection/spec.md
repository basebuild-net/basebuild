## ADDED Requirements

### Requirement: Optional account connection
Basebuild Desktop SHALL remain usable as a guest while encouraging users to connect their basebuild.net account for native MCP sync.

#### Scenario: first launch guest state
- **WHEN** the app starts with no stored native account token
- **THEN** the shell shows a compact guest/account control at the top right
- **AND** all local project, terminal, file, source, plan, and OMP views remain usable.

#### Scenario: sign-in encouragement
- **WHEN** a guest opens Settings > Account or a usage-sync entry point
- **THEN** the UI explains that signing in enables native MCP sync without API keys
- **AND** presents Sign in as the recommended action without blocking local use.

### Requirement: Browser device sign-in
Basebuild Desktop SHALL start sign-in by opening the user's system browser to basebuild.net and SHALL NOT embed website login forms.

#### Scenario: user starts sign-in
- **WHEN** the user clicks Sign in
- **THEN** the app calls the website `/api/auth/device/start` endpoint
- **AND** opens `verificationUriComplete` with the system browser using the existing desktop `open` dependency or equivalent Tauri-safe opener
- **AND** shows the short `userCode`, expiry, progress state, cancel, and retry controls in the app.

#### Scenario: user approves in browser
- **WHEN** the website returns a successful device poll result after the user clicks Allow
- **THEN** the app stores the native token and profile payload
- **AND** the shell switches to logged-in state with the user's avatar or initials.

#### Scenario: user denies or code expires
- **WHEN** polling returns `authorization_denied` or `expired_token`
- **THEN** the app shows a concise failure state with Retry and remains in guest mode.

### Requirement: Account state persistence
Basebuild Desktop SHALL restore logged-in account state on startup without re-running the browser flow until the token is revoked or expired.

#### Scenario: app starts with valid token
- **WHEN** the app starts with a stored native token
- **THEN** it calls the website native profile endpoint
- **AND** renders the returned username, display name, avatar URL, and account status.

#### Scenario: stored token invalid
- **WHEN** profile refresh returns unauthorized because the token was revoked or expired
- **THEN** the app deletes local token material and returns to guest state.

### Requirement: Sign out
Basebuild Desktop SHALL revoke first-party native access when the user signs out.

#### Scenario: user signs out
- **WHEN** the user clicks Sign out in Settings > Account or the account menu
- **THEN** the app calls the website native revoke endpoint when online
- **AND** deletes local token material regardless of network result.
