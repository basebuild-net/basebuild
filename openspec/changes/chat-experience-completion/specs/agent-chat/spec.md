# agent-chat Specification (delta)

## ADDED Requirements

### Requirement: Safe Markdown Rendering
Assistant message bodies, thinking-block bodies, and command notices SHALL
render through an in-house markdown renderer that emits React elements
only. The renderer SHALL NOT produce HTML strings, SHALL NOT use
`dangerouslySetInnerHTML`, and SHALL render raw HTML in the source text as
literal text. Supported constructs: fenced code blocks with language label,
inline code, bold, italic, headings, ordered/unordered lists, blockquotes,
tables, and links. Links SHALL render as non-navigating text with the full
URL in a tooltip. All styling SHALL live in `src/styles/globals.css` with
0px radius.

#### Scenario: Code fence renders as code block with copy
- **WHEN** an assistant message contains a fenced code block with a language tag
- **THEN** the block renders monospace with the language label and a tooltip-covered copy button that copies the verbatim block content

#### Scenario: Unterminated fence during streaming
- **WHEN** a streaming assistant message currently ends inside an unterminated code fence
- **THEN** the renderer treats the remainder as code, renders without error, and re-renders correctly as more deltas arrive

#### Scenario: Raw HTML is inert
- **WHEN** an assistant message contains `<script>` or any HTML tag
- **THEN** the tag text renders as visible literal text and no element or handler is created from it

#### Scenario: Table renders structurally
- **WHEN** an assistant message contains a pipe table
- **THEN** it renders as a real table with header and body rows styled via stylesheet classes

#### Scenario: Link does not navigate
- **WHEN** an assistant message contains a markdown link
- **THEN** the label renders as text with the full URL in the `title` tooltip and clicking does not open a browser

#### Scenario: User messages stay plain
- **WHEN** a user message contains markdown syntax
- **THEN** it renders as plain pre-wrapped text without markdown interpretation

### Requirement: Message Action Rail
Every persisted chat message SHALL expose a Copy action. The latest
assistant message SHALL expose a Retry action. The latest user message
SHALL expose an Edit-and-resend action. All actions SHALL be real buttons,
keyboard reachable, tooltip-covered.

#### Scenario: Copy message source
- **WHEN** the user activates Copy on a message
- **THEN** the message's raw source text (not rendered DOM) is written to the clipboard and a confirmation toast appears

#### Scenario: Retry re-runs the last turn
- **WHEN** the user activates Retry on the latest assistant message
- **THEN** the last user message is re-sent as a new turn with the current provider/model/effort, the prior assistant message remains in history, and the timeline marks the relationship between the original and retried turns

#### Scenario: Retry re-gates tools
- **WHEN** a retried turn issues mutating tool calls under a prompting approval mode
- **THEN** approval prompts appear again; prior approvals do not carry over

#### Scenario: Edit-and-resend prefills the composer
- **WHEN** the user activates Edit-and-resend on the latest user message
- **THEN** the composer is prefilled with that message's text and focused, and sending appends a new turn without mutating history

### Requirement: Typed Turn Failure States
Chat turn failures SHALL render as distinct, actionable states — provider
error (with provider label and retry), setup required (with connect
affordance), and transport unavailable (with explanation and base-URL
affordance) — using text and icon, never color alone.

#### Scenario: Provider error with retry
- **WHEN** a turn fails with a provider/network error
- **THEN** the transcript shows an error row naming the provider and error class with a Retry affordance that re-issues the turn

#### Scenario: Transport unavailable before launch
- **WHEN** the selected model's transport is unavailable on the native profile
- **THEN** no request is started, the composer area shows a transport-unavailable notice explaining why, and the draft message is preserved
