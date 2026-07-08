# schematic-chat-routing Specification

## MODIFIED Requirements

### Requirement: Tool-capable questionnaire delivery
Every schematic, category, and idea generation action SHALL route through one typed planning-action delivery path to a user-selected or explicitly named destination chat. Before sending, the system SHALL verify repository-read and interactive-question capability and SHALL apply the selected provider/model/effort/skill. Delivery SHALL be exactly once in send mode; missing capability or provider failure SHALL render a repair choice rather than falling back to prose or dropping the prompt.

#### Scenario: Schematic wizard begins successfully
- **WHEN** the user starts the schematic wizard and chooses an existing capable chat
- **THEN** the chat reads repository facts, presents one `ask_user` questionnaire card at a time, and writes nothing until the user approves the assembled schematic

#### Scenario: Selected model cannot use planning tools
- **WHEN** the destination model cannot read the repository or call `ask_user`
- **THEN** the system offers compatible model/provider choices or cancel, sends no fallback prose turn, and logs the capability mismatch

#### Scenario: Category generation is launched from the planning modal
- **WHEN** the user clicks Generate categories from project
- **THEN** the planning surface identifies and focuses the destination, the generation turn is visible, and completed categories refresh both the catalog and all planning counts
