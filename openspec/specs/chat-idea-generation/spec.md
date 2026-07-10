# chat-idea-generation Specification

## Requirements

### Requirement: Generate Ideas From Chat
The chat workspace SHALL let users generate structured ideas from the current
conversation and project context, and promote those ideas into the existing
plan pipeline. Generation SHALL run as a visible in-context **agentic** chat
turn: the request is recorded as a user message, the model gathers context
through the tool loop (schematic, convention files, manifests, existing
catalog — reads visible in the transcript) before proposing, the model's
reasoning renders in the turn's thinking fold, progress streams live in the
transcript, and captured ideas appear as idea cards **incrementally** as they
arrive (never only after the run completes). Idea capture SHALL require
non-empty `grounding` evidence and SHALL accept an optional schematic `anchor`.
Generated ideas SHALL be persisted in the single `ideas` catalog (there is no
separate proposals store); each idea card SHALL offer Promote and Reject
actions.

#### Scenario: Generation is visible in the transcript
- **WHEN** the user invokes idea generation in a chat with an available provider
- **THEN** a user message describing the request is recorded, the assistant
  turn streams context reads and reasoning (thinking fold) into the transcript,
  and idea cards appear one by one as ideas are captured — the composer never
  shows a spinner that collapses to empty output

#### Scenario: Context reads precede capture
- **WHEN** an idea generation turn runs for a project with a schematic
- **THEN** the transcript shows the schematic (and other project source) reads
  before the first idea capture

#### Scenario: Capture without grounding is rejected
- **WHEN** the model attempts to capture an idea with no grounding evidence
- **THEN** the capture tool rejects it and no idea row is created

#### Scenario: Promote idea to plan
- **WHEN** the user promotes a generated idea
- **THEN** the system creates a plan in the existing plan pipeline seeded from
  the idea's title and description, linked back to the originating chat session,
  and the idea moves to `picked`

#### Scenario: Reject a generated idea
- **WHEN** the user rejects a generated idea
- **THEN** the idea moves to `rejected`, is removed from the active idea cards,
  and remains visible in the inspector's history filtered by status

#### Scenario: No provider available
- **WHEN** the user invokes idea generation with no configured provider
- **THEN** the system prompts the user to connect a provider instead of
  producing empty or fabricated ideas

#### Scenario: Ideas persist with the session
- **WHEN** ideas are generated in a session and the app is reopened
- **THEN** the generated ideas reload with that session and retain their status
  (concept / picked / rejected / archived)

### Requirement: Categorical idea generation
Idea generation SHALL support a categorical direction. The user MAY request
ideas for a specific category from the session's **project-derived** category
registry, or run a quick freeform generation; category-directed generation
SHALL instruct the model to stay within that category's theme and SHALL tag
every resulting idea with that category. Freeform generation SHALL still
associate ideas with a category when the model attributes one. No category is
hardcoded or seeded by the system.

#### Scenario: Suggest more for a category
- **WHEN** the user triggers "Suggest more ideas" for a category
- **THEN** the generation turn is grounded in that category's name and
  description, and every captured idea is tagged with that category id

#### Scenario: Quick ideas from the chat menu
- **WHEN** the user selects "Quick ideas" from the chat planning menu
- **THEN** a freeform generation turn runs in the transcript and its ideas are
  saved to the catalog for the active session

### Requirement: Idea browser entry point
The chat composer's Ideas entry point SHALL open an idea browser over the
existing catalog — not only generation actions. The browser SHALL list the
session's ideas with status filters (`concept`/`picked`/`rejected`/`archived`),
category grouping, and each idea's grounding summary; and SHALL offer per-idea
actions: **Promote to plan** (existing promotion path), **Send to chat**
(insert the idea as a prompt into a chat chosen via the destination chooser),
and **Open in planning surface**. Generation actions (quick ideas, by
category) SHALL remain available as a secondary section of the same surface.
An empty catalog SHALL show a call-to-action into generation.

#### Scenario: Browse and assign an existing idea
- **WHEN** the user opens the Ideas browser, filters to `concept`, and picks
  "Send to chat" on an idea, choosing the open "Chat 3" tab
- **THEN** a prompt seeded from the idea's title, description, and grounding
  is delivered to Chat 3 per the targeted-delivery contract, and the idea's
  status is unchanged until explicitly promoted

#### Scenario: Promote from the browser
- **WHEN** the user clicks Promote on a concept idea in the browser
- **THEN** a plan is created through the existing promotion path, the idea
  moves to `picked`, and the browser row reflects it

#### Scenario: Generation remains reachable
- **WHEN** the user opens the Ideas browser in a session with no ideas
- **THEN** an empty state offers the quick and by-category generation actions,
  which behave per the existing generation requirements
