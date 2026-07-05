## ADDED Requirements

### Requirement: Terminal-first project use

Opening a project and creating/running terminal tabs (plain Terminal or
Oh My Pi) SHALL NOT create chat tabs, native chat session rows, or any
chat-related state. Chat state SHALL be created lazily on the user's first
explicit chat action (opening a Chat tab or sending a message). A user who
only ever uses terminals accumulates zero chat sessions.

#### Scenario: Terminal-only day leaves no chat rows

- **WHEN** the user opens a project, runs an OMP terminal for an hour, and
  closes the app without touching chat
- **THEN** no native chat session rows were created and the sidebar shows
  no new chat entries

#### Scenario: First chat action creates the chat lazily

- **WHEN** the user later opens a Chat tab and sends a message
- **THEN** exactly one native chat session is created at that moment,
  bound to the current project session

### Requirement: Empty chat hygiene

Chat tabs/sessions that were auto-created and never received a user
message SHALL NOT accumulate: re-opening a project reuses the existing
empty chat instead of minting another, and empty never-used chats are
pruned or hidden from the session/chat lists.

#### Scenario: Restart reuses the empty chat

- **WHEN** the app restarts on a project whose only chat is empty
- **THEN** the same chat is shown again and no additional empty chat
  appears in any list

#### Scenario: Old empty chats do not clutter the sidebar

- **WHEN** historical sessions contain chats with zero user messages
- **THEN** those entries are hidden or collapsed behind an explicit "show
  empty" affordance rather than listed alongside real work
