## ADDED Requirements

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
