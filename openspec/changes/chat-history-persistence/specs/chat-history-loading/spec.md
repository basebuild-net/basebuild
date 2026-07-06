## ADDED Requirements

### Requirement: Durable chat history persistence
The system SHALL durably persist, per chat session, all chat messages (user and assistant), reasoning, tool events, and approvals, so that the full conversation survives app restarts and is retrievable without loss or reordering. Prompt text, response text, tool output, secrets, and raw absolute paths already excluded from analytics are unaffected — this requirement concerns the local chat store only.

#### Scenario: History survives restart
- **WHEN** a session accumulates 40 messages with reasoning and tool events, and the app is restarted
- **THEN** reopening that session exposes all 40 messages in original order with their reasoning folds and tool cards intact

#### Scenario: No message loss on crash
- **WHEN** the app is force-closed mid-session after messages were committed
- **THEN** on next launch the committed messages are still present; only an in-flight, uncommitted streaming turn may be absent

### Requirement: Windowed initial load
On opening a chat session (newly focused or restored), the system SHALL load and render only the most recent bounded window of messages rather than the entire history, so open time and memory are constant regardless of total history length.

#### Scenario: Open a long session
- **WHEN** the user opens a session containing 2,000 messages
- **THEN** the panel loads and renders only the most recent page (e.g. the last N messages), shows the latest turn at the bottom, and does not fetch or mount all 2,000 at once

#### Scenario: Short session loads fully
- **WHEN** the user opens a session containing fewer messages than one page
- **THEN** the entire history is loaded and rendered, with no lazy-load affordance shown

### Requirement: Lazy load older messages on scroll-up
When the user scrolls toward the top of the transcript, the system SHALL fetch and prepend the next older page of messages via a paginated backend query (bounded `limit` with a `before` cursor / sort order), continuing until the start of history is reached.

#### Scenario: Scroll up loads the previous page
- **WHEN** the user scrolls to the top of the currently loaded window and older messages exist
- **THEN** the next older page is fetched and prepended, and a loading affordance is shown briefly while fetching

#### Scenario: Start of history reached
- **WHEN** the user scrolls up until the first message in the session is loaded
- **THEN** no further fetch is attempted and a subtle start-of-conversation marker is shown

#### Scenario: Paginated query correctness
- **WHEN** older pages are requested successively
- **THEN** each page returns the correct contiguous block of messages in stable order with no duplicates or gaps across page boundaries

### Requirement: Scroll anchor preserved on prepend
When older messages are prepended, the system SHALL preserve the user's current viewport position (anchor to the message that was at the top) so the transcript does not jump or scroll-shift while reading.

#### Scenario: Reading position is stable
- **WHEN** older messages are prepended while the user is reading mid-transcript
- **THEN** the message the user was viewing stays in place visually (no upward jump), and the newly prepended content appears above it

#### Scenario: Live stream keeps bottom-follow
- **WHEN** the user is at the bottom of the transcript and a new assistant turn streams in
- **THEN** the view continues to follow the newest content, independent of any older-page loading

### Requirement: Bounded rendered rows
The system SHALL bound the number of simultaneously mounted message rows (windowing/virtualization) so that a very long history does not mount an unbounded DOM, while keeping scrolling smooth and search/anchor behavior correct.

#### Scenario: Large history stays responsive
- **WHEN** a session with thousands of messages is scrolled through
- **THEN** the number of mounted message rows stays bounded (only the visible window plus a small overscan is mounted), and scrolling remains smooth without loading the whole history into the DOM
