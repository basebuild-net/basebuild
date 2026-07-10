# native-chat-transport Security Specification (delta)

## MODIFIED Requirements

### Requirement: Native Profile Transport Isolation
The native chat profile SHALL NOT launch OMP RPC as the chat transport.
Providers without a native transport SHALL return a typed
`SetupRequired` result with an actionable message. OMP RPC SHALL only
be used when the user has explicitly selected an OMP profile or when
the `omp://openai-codex` sentinel base URL is present (backward compat).

#### Scenario: Native provider with native transport
- **WHEN** a native-profile chat session uses a provider with `api_kind` `openai-completions`, `openai-responses`, `azure-openai-responses`, `anthropic-messages`, `openrouter`, or `ollama-chat`
- **THEN** the chat turn routes through the native provider client (OpenAI-compatible or Anthropic)

#### Scenario: Native provider with custom base URL
- **WHEN** a native-profile chat session uses a provider with a bespoke `api_kind` but the credential has a non-empty `base_url`
- **THEN** the chat turn routes through the OpenAI-compatible client with the custom base URL

#### Scenario: Bespoke provider without base URL on native profile
- **WHEN** a native-profile chat session uses a provider with a bespoke `api_kind` and no `base_url`
- **THEN** the system returns a `SetupRequired` result with a message explaining the provider requires an OMP profile or a custom base URL
- **AND** no OMP process is launched

#### Scenario: OMP sentinel backward compat
- **WHEN** a credential has `base_url` equal to `omp://openai-codex`
- **THEN** the system routes through `OmpRpcClient` regardless of profile (backward compat)

#### Scenario: Tool-capable native provider
- **WHEN** a native-profile chat session uses a provider with a native transport and the model supports tools
- **THEN** the chat turn routes through the native agent loop with tool schemas
