# terminal-output-replay Specification (delta)

## ADDED Requirements

### Requirement: Server-Side Scrollback Replay
The terminal backend SHALL keep a bounded per-session scrollback buffer of PTY
output with monotonically increasing sequence numbers, and SHALL expose a
replay operation returning the buffered output plus the last sequence number.
Output events SHALL carry their sequence number so a panel that attaches after
output was produced can replay the buffer and then consume live events without
gaps or duplicates. The buffer SHALL be bounded (oldest bytes dropped first)
and freed when the session closes.

#### Scenario: New terminal shows its prompt
- **WHEN** the user creates a terminal and the shell prints its startup prompt
  before the panel's output listener attaches
- **THEN** the panel replays the buffered output on attach and the prompt is
  visible — the terminal never opens blank while the shell is alive

#### Scenario: Reattach repaints the screen
- **WHEN** the user switches away from a terminal tab and back (the panel
  remounts against the same live session)
- **THEN** the panel repaints from the scrollback buffer and continues with
  live output, without duplicated or missing bytes at the replay/live boundary

#### Scenario: Buffer stays bounded
- **WHEN** a session produces more output than the scrollback cap
- **THEN** the oldest bytes are discarded, memory stays within the cap, and
  replay returns the retained tail

### Requirement: Mount-Resilient Terminal Panel
Terminal panel initialization SHALL converge to exactly one live xterm
instance attached to the session under development-mode double-mounting
(React StrictMode) and container-size races: an aborted first mount MUST NOT
consume or lose output needed by the successful mount. The production terminal
surface SHALL NOT render developer debug overlays; diagnostic logging SHALL be
removed or gated behind a developer flag.

#### Scenario: StrictMode double-mount still renders
- **WHEN** the panel mounts under StrictMode (mount → dispose → remount)
- **THEN** the surviving mount replays the buffer, attaches exactly one
  listener, and renders the live shell — typed input echoes on screen

#### Scenario: No debug overlay in the panel
- **WHEN** a terminal tab renders in a normal build
- **THEN** the panel shows only the terminal surface (plus its documented
  header/status affordances), with no on-screen init/debug log
