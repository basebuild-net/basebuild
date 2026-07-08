## ADDED Requirements

### Requirement: Tokenized dark theme with vibrant semantic colors
The system SHALL keep a dark, flat, square-cornered desktop style while moving hardcoded visuals into CSS variables. Neutral structure SHALL use black/grey/silver tokens, while chat status, plan status, tool kinds, queue state, and validation results SHALL use vibrant semantic tokens with redundant text/icon labels.

#### Scenario: Design tokens drive colors
- **WHEN** a component renders background, surface, border, text, status, or tool-kind color
- **THEN** it uses a `--bb-*` CSS variable from `src/styles/globals.css` rather than a new hardcoded hex value in component code

#### Scenario: Vibrant status is readable
- **WHEN** plan statuses `draft`, `openspec`, `ready`, `running`, `finished`, and `cancelled` appear in chat or planning UI
- **THEN** each status has distinct text/icon/color treatment and remains understandable without color alone

#### Scenario: Syntax and markdown are readable
- **WHEN** assistant output includes Markdown, code fences, lists, tables, or diffs
- **THEN** the chat renders formatted Markdown and syntax-highlighted code using the theme tokens, not a plain unformatted paragraph blob

### Requirement: User zoom controls
The app SHALL support `Ctrl/Cmd + +`, `Ctrl/Cmd + -`, and `Ctrl/Cmd + 0` zoom controls. Zoom SHALL affect the UI predictably, persist locally, and display the current zoom level in the bottom-right/status area.

#### Scenario: Increase zoom
- **WHEN** the user presses `Ctrl` + `+`
- **THEN** the app increases zoom one step, persists the value locally, and updates a visible `110%`-style indicator

#### Scenario: Decrease zoom
- **WHEN** the user presses `Ctrl` + `-`
- **THEN** the app decreases zoom one step without clipping the composer, status bar, or modal actions

#### Scenario: Reset zoom
- **WHEN** the user presses `Ctrl` + `0`
- **THEN** zoom returns to `100%` and the indicator updates

### Requirement: Design contract is looser but enforceable
`DESIGN.md` SHALL stop requiring pure black plus a single orange accent as the only acceptable visual style. It SHALL preserve enforceable product rules: local-first, 0px radius, one stylesheet, tooltip coverage, clear hierarchy, CSS variables, dark mode, accessible contrast, and screenshot verification.

#### Scenario: Design update is specific
- **WHEN** this change updates `DESIGN.md`
- **THEN** the document describes neutral/silver structure, vibrant semantic chat colors, CSS variable tokens, markdown/code treatment, and zoom support

#### Scenario: UI invariant script remains strict
- **WHEN** UI code is added
- **THEN** existing checks for one stylesheet, 0px radius, and `title=` tooltips remain enforced
