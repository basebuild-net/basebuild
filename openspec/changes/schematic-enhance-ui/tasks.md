# Tasks: Schematic Enhance UI

## 1. Backend Enhance Turn

- [ ] 1.1 Add an enhance-section turn to `src-tauri/src/services/schematic_service.rs` that targets one section, builds a rewrite prompt (preserve meaning/language → agent-optimized), runs the existing wizard turn mechanism, and returns `{ section, before, after }` without writing to `.basebuild/project-schematic.md`.
- [ ] 1.2 Add an approval-commit path (reuse the wizard's per-section write) that replaces only the target section on approval, preserving all others verbatim, exactly once.
- [ ] 1.3 Add `schematic_enhance_section` (propose) and the approval-commit command to `src-tauri/src/commands/schematic.rs`; register in `src-tauri/src/lib.rs`.

## 2. Frontend Enhance UI

- [ ] 2.1 Add `schematicEnhanceSection` (and approval-commit) thin wrappers to `src/lib/schematic.ts`.
- [ ] 2.2 Add enhance lifecycle state (idle → proposing → preview → error) to `src/state/schematic.ts`, including cancel handling.
- [ ] 2.3 Add an **Enhance** button to each schematic section card and a before/after diff view with **Approve** / **Discard**; `title` tooltips on all three controls; 0px radius.
- [ ] 2.4 Disable Enhance with an explanatory tooltip when the selected model is not tool/agent-capable; hide/disable it on empty sections.
- [ ] 2.5 Add any required classes to `src/styles/globals.css` only.

## 3. Verification

- [ ] 3.1 `npx tsc --noEmit`
- [ ] 3.2 `npm run build`
- [ ] 3.3 `cargo check` and `cargo test` in `src-tauri`
- [ ] 3.4 UI smoke: Enhance → diff → Approve writes once; Enhance → diff → Discard leaves text unchanged; non-tool model shows disabled tooltip.
- [ ] 3.5 Update `docs/agents/design-system.md` / `DESIGN.md` if any new UI pattern is introduced.

## 4. Docs & Roadmap

- [ ] 4.1 Refresh `openspec/ROADMAP.md` via `node scripts/openspec-status.mjs --write`.
