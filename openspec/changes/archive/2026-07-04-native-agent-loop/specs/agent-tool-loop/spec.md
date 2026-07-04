## ADDED Requirements

### Requirement: Provider tool-call protocol
The provider layer SHALL send registered tool schemas with each turn and parse streamed tool-call requests, normalized to an internal model (id, tool name, JSON arguments), with adapters for the OpenAI-compatible wire format (`tools` / `tool_calls` / role `tool`) and the Anthropic wire format (`tools` / `tool_use` / `tool_result` content blocks). Tool-result messages SHALL round-trip back to the provider in the correct format for the follow-up request.

#### Scenario: OpenAI-compatible tool call
- **WHEN** a model on an OpenAI-compatible provider responds with `tool_calls` deltas
- **THEN** the client assembles complete tool-call requests (id, name, arguments) and the follow-up request contains matching role-`tool` result messages

#### Scenario: Anthropic tool call
- **WHEN** a Claude model responds with `tool_use` content blocks
- **THEN** the client normalizes them to the same internal tool-call model and returns results as `tool_result` blocks in the next user message

#### Scenario: Provider without tool support
- **WHEN** the active provider/model rejects or ignores tool schemas
- **THEN** the turn degrades to a plain chat turn and the UI indicates tools are unavailable for that model

### Requirement: Multi-turn agent loop
The system SHALL run an agentic loop per user turn: stream assistant output; when the response contains tool calls, resolve each through the approval gateway, execute approved calls, append results, and re-request until the model returns no tool calls, an iteration cap is reached, or the run is cancelled. The loop SHALL be backend-owned and survive frontend unmounts.

#### Scenario: Tool loop completes a task
- **WHEN** the user asks the agent to fix a file and the model issues read → edit → run_command calls across three iterations
- **THEN** each iteration streams to the transcript in order, and the loop ends with a final assistant message after a response with no tool calls

#### Scenario: Iteration cap
- **WHEN** the loop reaches the configured maximum iterations (default 25)
- **THEN** execution stops, the transcript shows a cap notice, and the user can continue with a follow-up message

#### Scenario: Cancellation mid-loop
- **WHEN** the user cancels while a tool is executing or a response is streaming
- **THEN** the in-flight request/process is aborted, a `cancelled` tool event is recorded for any interrupted call, and the session returns to idle with partial transcript preserved

#### Scenario: Crash-safe run state
- **WHEN** the app restarts while a loop was running
- **THEN** the session is marked idle with a visible "run interrupted" note; no phantom running state remains

### Requirement: Parallel tool execution safety
When a single model response contains multiple tool calls, the system SHALL execute read-only calls concurrently and mutating calls (`write_file`, `edit_file`, `run_command`) sequentially in response order.

#### Scenario: Mixed batch
- **WHEN** a response contains two `read_file` calls and one `edit_file` call
- **THEN** the reads may run concurrently, the edit runs after approval, and results are returned to the model keyed by tool-call id
