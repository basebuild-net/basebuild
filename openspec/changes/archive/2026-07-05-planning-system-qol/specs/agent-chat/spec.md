## ADDED Requirements

### Requirement: Reasoning channel separation
Reasoning/thinking tokens (e.g. `reasoning_content` from Umans GLM or
DeepSeek-style models) SHALL be stored separately from the assistant
message content, SHALL render as a collapsed, visually distinct "thinking"
section, and SHALL NOT be sent back to providers as part of prior assistant
turns. The system MUST NOT concatenate reasoning and content into one
persisted string (the current `{reasoning}\n\n---\n\n{content}` fold).

#### Scenario: Reasoning hidden by default
- **WHEN** a model streams reasoning followed by the answer "GLM52-OK"
- **THEN** the message bubble shows "GLM52-OK" with a collapsed expandable
  thinking section, not "The user wants me to reply with exactly … ---
  GLM52-OK"

#### Scenario: Thinking visually distinct from reply
- **WHEN** a thinking section is expanded (or streaming live)
- **THEN** it renders with clearly distinct styling (muted/labelled
  "Thinking" treatment per DESIGN.md) so it can never be confused with the
  assistant's reply text at a glance

#### Scenario: Reasoning excluded from context
- **WHEN** a follow-up message is sent in a session whose history contains
  reasoning
- **THEN** the provider request contains only the content portions of prior
  assistant turns

#### Scenario: Stray think tags sanitized
- **WHEN** a provider emits literal `<think>`/`</think>` markers inside the
  content channel
- **THEN** the persisted content has the markers stripped and the enclosed
  text routed to the reasoning store
