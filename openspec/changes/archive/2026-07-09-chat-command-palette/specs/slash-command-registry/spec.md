# slash-command-registry Specification (delta)

## MODIFIED Requirements

### Requirement: Composer integration
The chat composer SHALL show an autocomplete popup when command entry begins with `/` or when the Commands button opens the command palette. The popup SHALL list matching commands in a large, simplified list with command names, descriptions, source badges, local-only/provider-send behavior, usage strings, examples, and argument hints. Results SHALL rank locally persisted recent command use first, then exact/prefix matches, then substring matches, while preserving provider priority and shadowing metadata from command discovery. Builtin commands (`/login`, `/model`, `/provider`, `/models refresh`, `/clear`, `/new`, `/commands`, `/help`, `/stop`, `/mcp`, `/plan`, `/idea`, `/openspec`, `/skill:<name>`) SHALL execute local UI actions immediately after explicit command submission; file/MCP-prompt commands SHALL expand into the outgoing prompt.

#### Scenario: Autocomplete opens on slash
- **WHEN** the user types `/` in an empty or command-position composer
- **THEN** the popup opens with a large list of available commands showing command names, descriptions, source badges, and usage hints without sending text to the provider

#### Scenario: Filtering narrows commands
- **WHEN** the user types `/mo`
- **THEN** the list filters to matching commands such as `/model` and `/models refresh`, keeps descriptions visible, and shows an empty state if no command matches

#### Scenario: Recent commands rank first
- **WHEN** the user has recently used `/model` and `/clear` and then opens the command popup with `/`
- **THEN** those commands appear before equally relevant commands that have not been used recently, with every other command still reachable by typing a filter

#### Scenario: Keyboard completion
- **WHEN** the command popup is open
- **THEN** ArrowDown and ArrowUp move the active option, Tab fills the active command and its required-argument placeholder into the composer, Enter submits or accepts the active command according to the current composer mode, and Escape closes the popup without changing the draft

#### Scenario: Command argument helpers
- **WHEN** the user types a command with arguments such as `/model son` or `/provider`
- **THEN** the composer shows required and optional arguments, examples, validation messages, and whether the command will execute locally or send a prompt

#### Scenario: Builtin plan commands
- **WHEN** the user runs `/plan list`, `/plan run <ref>`, `/idea generate`, or `/openspec <ref>`
- **THEN** the corresponding pipeline UI action executes without sending the command text to the provider

## ADDED Requirements

### Requirement: Command metadata for palette helpers
Every command exposed to the composer palette SHALL provide normalized metadata for `name`, `description`, `usage`, `arguments`, `examples`, `source`, `localOnly`, and `recentlyUsedAt` when known. Metadata SHALL be generated for builtins and parsed from discovered command sources without evaluating command bodies.

#### Scenario: Builtin metadata is complete
- **WHEN** the palette renders built-in commands
- **THEN** each built-in command has a description, usage string, local-only indicator, and examples suitable for inline help

#### Scenario: File command metadata is safe
- **WHEN** a file-based command contains frontmatter and a body template
- **THEN** the palette displays only safe metadata and placeholder-derived argument hints, not expanded secrets or evaluated command body content

#### Scenario: Shadowed commands remain inspectable
- **WHEN** multiple providers expose the same command name
- **THEN** the active command appears in the main list and shadowed commands remain visible in the complete command reference with their source labels
