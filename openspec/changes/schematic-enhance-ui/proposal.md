# Proposal: Schematic Enhance UI

## Why

`schematic-grounded-planning` (PR #22) shipped the schematic wizard and its
structured section-card view, but left the per-section **AI-enhanced
descriptions** action (its task 2.3, a spec requirement in `schematic-wizard`)
**unshipped**. Users still hand-write section text with no assisted path from
plain words to the precise, structured phrasing agents consume best. This change
delivers that missing Enhance action as an approval-gated before/after diff.

## What Changes

- Add an **Enhance** action to each schematic section card.
- Run a visible chat turn that rewrites the section's current text into an
  agent-optimized description, preserving the user's meaning and language.
- Present the result as a **before/after diff** with **Approve** / **Discard**;
  nothing is written to `.basebuild/project-schematic.md` until approval.
- Degrade to a disabled control with an explanatory tooltip when the selected
  model lacks tool/agent capability.

## Capabilities

### New Capabilities
- `schematic-enhance`: per-section Enhance action, approval-gated before/after
  diff, and safe degradation.

### Modified Capabilities
- (none canonical) — `schematic-wizard` is defined in the unarchived
  `schematic-grounded-planning` change, not yet in `openspec/specs/`. This change
  delivers that spec's unshipped "AI-enhanced descriptions" requirement; when
  both archive, the canonical `schematic-wizard` requirement is satisfied here.

## Impact

- **Rust:** extend `src-tauri/src/services/schematic_service.rs` with an
  enhance-section turn that reuses the wizard's agentic turn mechanism
  (`agent_loop_service.rs` / `native_chat_service.rs`) and returns a proposed
  rewrite without writing; add a command in `src-tauri/src/commands/schematic.rs`
  and register it in `lib.rs`.
- **Frontend:** add `schematicEnhanceSection` to `src/lib/schematic.ts` (thin
  invoke wrapper); add enhance lifecycle state (idle → proposing → preview →
  error) to `src/state/schematic.ts`; add the Enhance button and before/after
  diff view to the schematic section-card UI.
- **Styles:** `src/styles/globals.css` only, 0px radius, `title` tooltips on the
  Enhance / Approve / Discard controls.
- **Tests/verification:** `npx tsc --noEmit`, `npm run build`, `cargo check` /
  `cargo test` in `src-tauri`, and a UI smoke of Enhance → diff → approve and
  Enhance → diff → discard.
