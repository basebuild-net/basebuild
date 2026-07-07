# provider-api-routing Specification (delta)

## ADDED Requirements

### Requirement: API-Kind Transport Routing
Every catalog model SHALL carry a wire-protocol kind (`api`), and the system
SHALL select the chat transport for a turn by the model's api kind — never by
provider id alone. Native transports SHALL serve OpenAI-compatible kinds
(`openai-completions`, `openrouter`, and `openai-responses` via the
completions-compatible path where the credential is a standard API key) and
`anthropic-messages`. The system SHALL NOT send a request shaped for one wire
protocol to an endpoint that speaks another.

#### Scenario: OpenAI-compatible model routes natively
- **WHEN** the user sends a message with a model whose api kind is
  `openai-completions` (e.g. a Groq, DeepSeek, Mistral, or xAI model)
- **THEN** the native OpenAI-compatible client handles the turn against the
  model's catalog base URL, streaming deltas into the transcript

#### Scenario: Anthropic model routes natively
- **WHEN** the user sends a message with a model whose api kind is
  `anthropic-messages`
- **THEN** the native Anthropic client handles the turn

#### Scenario: Bespoke protocol never hits a wrong endpoint
- **WHEN** a model's api kind is a bespoke protocol (e.g. `devin-agent`)
- **THEN** the system never issues an OpenAI-style `/chat/completions` request
  to that provider's host, eliminating protocol-mismatch 404s

#### Scenario: Provider base-URL overlay
- **WHEN** a provider has a Basebuild-pinned compatible endpoint that differs
  from the catalog default (e.g. Google via its OpenAI-compatible
  `/v1beta/openai` endpoint with an API key)
- **THEN** the overlay's transport and base URL take precedence for that
  provider, and chat continues to work natively

### Requirement: OMP RPC Provider Transport
For models whose api kind has no native transport, the system SHALL delegate
the turn to Oh My Pi by spawning its RPC mode with the model's OMP provider id
(generalizing the existing one-shot `openai-codex` bridge), streaming text and
reasoning deltas back into the native transcript. The subprocess SHALL run with
session, skills, rules, and extensions disabled so Basebuild retains ownership
of history and context. Turns that require Basebuild-native tool calls SHALL be
declared unsupported over this bridge with a clear message rather than failing
opaquely.

#### Scenario: Devin model chats via OMP
- **WHEN** OMP is installed and the user sends "hi" with a Devin model such as
  `swe-1-6` or `glm-5-2`
- **THEN** the turn is served through `omp --mode rpc --provider devin` with
  the selected model, the reply streams into the transcript, and no HTTP 404
  occurs

#### Scenario: Bespoke model without OMP installed
- **WHEN** OMP is not installed (or fails its probe) and the user selects a
  model whose api kind requires delegation
- **THEN** the model is marked as requiring Oh My Pi in the picker, and a send
  attempt returns an actionable setup message naming OMP — not a protocol error

#### Scenario: Tool-requiring turn over the bridge
- **WHEN** a turn would include Basebuild tool definitions and the selected
  model routes over the one-shot OMP bridge
- **THEN** the system surfaces that tools are unavailable for this transport
  (plain chat only) instead of silently dropping tools or hanging

### Requirement: Custom OpenAI-Compatible Endpoints
The system SHALL continue to support user-supplied OpenAI-compatible providers:
a credential with a custom base URL routes through the native
OpenAI-compatible client regardless of catalog membership.

#### Scenario: Custom base URL keeps working
- **WHEN** the user configures a provider credential with a custom base URL
  (e.g. a self-hosted vLLM endpoint)
- **THEN** sends route through the native OpenAI-compatible client at that base
  URL, unchanged by catalog routing
