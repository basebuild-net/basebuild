## ADDED Requirements

### Requirement: OMP-compatible MCP configuration
The system SHALL read MCP server definitions from `<project>/.omp/mcp.json` and `~/.omp/agent/mcp.json` (plus root `mcp.json`/`.mcp.json` fallbacks) using oh-my-pi's schema: `mcpServers` map, `disabledServers` list, stdio (`command`/`args`/`env`/`cwd`), http/sse (`url`/`headers`), `enabled`, `timeout`, `auth`, and `oauth` fields, with `${VAR}` / `${VAR:-default}` expansion and `!command` env/header resolution. Config written by Basebuild SHALL remain readable by oh-my-pi.

#### Scenario: Shared config with omp
- **WHEN** a project contains `.omp/mcp.json` defining a stdio server
- **THEN** Basebuild connects to the same server definition omp would, without any Basebuild-specific config file

#### Scenario: Validation errors surfaced
- **WHEN** a server entry sets both `command` and `url`, or omits `command` for stdio
- **THEN** the server is rejected with a UI-visible error naming the file and server, and other servers still load

### Requirement: Transports and auth
The MCP client SHALL support stdio, streamable HTTP, and SSE transports, and OAuth authorization for http/sse servers (browser-based flow, locally stored credentials keyed per server URL). Server processes and connections SHALL be supervised: crash/disconnect is reported and reconnectable without app restart.

#### Scenario: stdio server lifecycle
- **WHEN** a stdio server is enabled
- **THEN** its process starts on demand, tools are listed after initialize, and disabling the server terminates the process

#### Scenario: OAuth flow
- **WHEN** an http server responds unauthorized and defines/discovers OAuth metadata
- **THEN** the user is prompted to authorize in the browser, tokens are stored locally, and subsequent connections reuse and refresh them

### Requirement: MCP tools in native chat
Connected servers' tools SHALL be exposed to native chat turns as callable tools, namespaced `mcp:<server>/<tool>`, and SHALL pass through the existing tool-approval gateway before execution. Tool results (text/images) SHALL render in the chat transcript.

#### Scenario: Tool call with approval
- **WHEN** the model calls an MCP tool during a native chat turn
- **THEN** the approval UI shows server, tool, and arguments; on approval the call executes and its result is returned to the model; on denial a denial result is returned

### Requirement: MCP prompts as slash commands
Prompts exposed by connected servers SHALL register as slash commands (`/<prompt-name>`, prefixed on collision), with prompt arguments mapped from command arguments.

#### Scenario: Prompt command
- **WHEN** a connected server exposes prompt `summarize-pr`
- **THEN** `/summarize-pr 42` retrieves the prompt with `42` bound and injects the rendered messages into the conversation

### Requirement: Server management UI
Settings SHALL include an MCP section: list discovered servers with source file, connection state, and tool/prompt counts; enable/disable (writing `disabledServers`); add/edit stdio and http servers (writing `.omp/mcp.json` or the user file); test connection; reauthorize; and reload. All state SHALL be local-only.

#### Scenario: Add a server
- **WHEN** the user adds a stdio server via Settings choosing project scope
- **THEN** `<project>/.omp/mcp.json` is created/updated with the schema reference and the server connects without restart

#### Scenario: Disable a discovered server
- **WHEN** the user disables a server discovered from a project file
- **THEN** the name is added to `disabledServers` in the user file, the connection closes, and its tools/prompts disappear from chat
