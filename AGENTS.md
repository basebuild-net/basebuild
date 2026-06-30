# Basebuild Desktop — Agent Guide

## Design System: basebuild Mono Desktop

`DESIGN.md` at the repo root is the canonical source of truth for all visual
design. Read it before any UI change. Key rules:

- **Pure black canvas** (`#000000`), **pure white text** (`#ffffff`), **single orange accent** (`#ff5606`).
- **0px border radius everywhere** — no exceptions. Square geometry.
- **No decorative borders** — layer with whitespace, hover bg lifts, and uppercase typography.
- **Fonts:** Space Grotesk (UI), JetBrains Mono (numbers, paths, code, terminal).
- **Compact and dense** — minimal padding, no wasted space. Desktop tool, not marketing site.
- **Tooltips on every interactive element** (`title` attribute). Non-negotiable.
- **Collapsible columns** — both left sidebar and right rail collapse to icon-only (36px).

### CSS Token Map

CSS custom properties in `src/styles/globals.css` map 1:1 to DESIGN.md tokens:

| Token | CSS var | Value |
|---|---|---|
| background | `--bb-bg` | `#000000` |
| surface-container | `--bb-surface` | `#0a0a0a` |
| surface-container-high | `--bb-surface-high` | `#141414` |
| surface-container-highest | `--bb-surface-highest` | `#1c1c1c` |
| on-surface | `--bb-text` | `#ffffff` |
| on-surface-muted | `--bb-muted` | `rgba(255,255,255,0.55)` |
| outline | `--bb-border` | `#1c1c1c` |
| outline-strong | `--bb-border-strong` | `#2a2a2a` |
| cta | `--bb-cta` | `#ff5606` |
| cta-hover | `--bb-cta-hover` | `#ff7a3d` |
| positive | `--bb-positive` | `#4ade80` |
| negative | `--bb-negative` | `#f87171` |
| warning | `--bb-warning` | `#facc15` |
| info | `--bb-info` | `#818cf8` |

### Reusable CSS Classes

Single CSS file: `src/styles/globals.css`. No CSS modules, no styled-components.

| Class | Purpose |
|---|---|
| `.btn` | Base button (border, transparent bg) |
| `.btn-primary` | Orange CTA button |
| `.btn-ghost` | Borderless secondary button |
| `.btn-icon` | Icon-only button |
| `.btn-icon-sm` | Small icon button |
| `.card` | Bordered container |
| `.badge` | Small uppercase label |
| `.pill` | Status indicator with border |
| `.input` | Text input |
| `.pre` | Monospace preformatted block |
| `.stack` | Vertical flex gap 8px |
| `.stack-sm` | Vertical flex gap 4px |
| `.row` | Horizontal flex gap 6px |
| `.row-between` | Space-between flex |
| `.text-muted` | Muted color |
| `.text-sm` | 11px text |
| `.text-ok` | Green |
| `.text-danger` | Red |
| `.mono` | JetBrains Mono font |

**Never create a new CSS class if an existing one works.** Add new classes to
`globals.css` only if truly reusable, and document them here.

### Collapsible Columns

The app shell uses `data-sidebar="collapsed|expanded"` and
`data-rail="collapsed|expanded"` attributes on the `.app-shell` element. The CSS
handles the grid column width changes and hides text labels in collapsed mode.

### Hover Effects

Every interactive element has a hover state with a 0.08s transition:
- Buttons: bg → `--bb-surface`, border → `--bb-border-strong`
- List items: bg → `--bb-surface`
- Active items: bg → `--bb-surface-high` + orange indicator bar

---

## Project Architecture

Basebuild is a desktop application for managing local development workflows.
It wraps CLI tools (OMP, Git, terminals) in a unified desktop UI built with
Tauri v2 + React + TypeScript.

### Folder Structure

```
src/
  components/
    layout/          # Shell: AppShell, ProjectSidebar, ToolRail, WorkspacePanel, TopBar
    panels/          # Feature panels: TerminalPanel, OmpPanel, SourcePanel, ConfigPanel, DebugPanel
  lib/               # Tauri invoke wrappers — one file per backend domain
  state/             # React state hooks
  styles/
    globals.css      # Single centralized CSS file

src-tauri/
  src/
    commands/        # Tauri command handlers — one file per domain
    services/        # Business logic — one file per domain
    models/          # Serializable data types
    app_state.rs     # Tauri managed state (terminal manager)
    lib.rs           # Tauri builder + handler registration
```

### Adding a New Integration

1. Rust service: `src-tauri/src/services/<name>_service.rs`
2. Rust model: `src-tauri/src/models/<name>.rs`
3. Rust command: `src-tauri/src/commands/<name>.rs`
4. Register: Add to `mod.rs`, add handlers to `lib.rs`
5. Frontend lib: `src/lib/<name>.ts`
6. Frontend panel: `src/components/panels/<Name>Panel.tsx`
7. Tool rail: Add icon button in `ToolRail.tsx`

---

## Visual Inspection Workflow

**After every UI change, visually verify.** Never yield a UI change without
visual verification.

1. Run `npm run tauri dev` to launch the app.
2. Use the browser tool to take a screenshot of the running window.
3. Check: alignment, spacing, hover states, collapsed/expanded modes, tooltips.
4. Test the actual interaction (click, hover, collapse, etc.).

---

## Development

```bash
npm install
npm run tauri dev    # Dev
npm run tauri build   # Production
npx tsc --noEmit      # Type check
```

### Prerequisites

- Node.js 20+, Rust (stable), Visual Studio C++ Build Tools (Windows)

### CSS Guidelines

- Single CSS file (`src/styles/globals.css`). Target: under 350 lines.
- Never inline styles. Never create component-specific CSS files.
- Always use existing utility classes first.
