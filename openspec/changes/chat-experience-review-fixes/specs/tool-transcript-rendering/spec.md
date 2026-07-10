# tool-transcript-rendering Specification (delta)

## ADDED Requirements

### Requirement: Lossless Syntax Highlighting
The in-house code highlighter SHALL be a cursor-anchored lexer: every
token is matched at the current position, and the concatenation of all
emitted token texts SHALL equal the input exactly. Line comments SHALL
only be recognized when the comment marker is at the cursor, never on a
later line. Lexing SHALL be single-pass without per-iteration string
copies of the remaining input.

#### Scenario: Code block with a line comment after line one
- **WHEN** the assistant streams a ts fence containing
  `const x = 1;\n// a comment\nconst y = 2;`
- **THEN** the rendered code block shows the three lines verbatim in order,
  with only the comment line styled as a comment

#### Scenario: Reassembly property
- **WHEN** `highlightCode` tokenizes any input for any supported language
- **THEN** joining the token texts reproduces the input byte-for-byte

### Requirement: Link Scheme Allowlist
Inline markdown links SHALL only be recognized when the URL is `http://`,
`https://`, or scheme-less relative. URLs carrying any other scheme
(`javascript:`, `data:`, `vbscript:`, `file:`, …) SHALL render as literal
text. Recognized links SHALL remain non-navigating (no `href`, no click
handler) with the full URL exposed only as tooltip text.

#### Scenario: javascript: URL in assistant markdown
- **WHEN** the assistant output contains `[click](javascript:alert(1))`
- **THEN** no link node is produced and the source text renders literally
