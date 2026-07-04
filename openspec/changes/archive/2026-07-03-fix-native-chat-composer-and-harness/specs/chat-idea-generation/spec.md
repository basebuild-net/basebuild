## ADDED Requirements

### Requirement: Generate Ideas From Chat
The chat workspace SHALL let users generate structured ideas from the current conversation and project context, and promote those ideas into the existing plan pipeline.

#### Scenario: Generate ideas from a conversation
- **WHEN** the user invokes "Generate ideas" in a chat with an available provider
- **THEN** the system sends the conversation plus the project schematic to the active provider and returns a set of structured Idea records (title + short description) shown in the Ideas surface

#### Scenario: Promote idea to plan
- **WHEN** the user promotes a generated idea
- **THEN** the system creates a plan in the existing plan pipeline seeded from the idea's title and description, linked back to the originating chat session

#### Scenario: No provider available
- **WHEN** the user invokes "Generate ideas" with no configured provider
- **THEN** the system prompts the user to connect a provider instead of producing empty or fabricated ideas

#### Scenario: Ideas persist with the session
- **WHEN** ideas are generated in a session and the app is reopened
- **THEN** the generated ideas reload with that session and retain their status in the Ideas surface
