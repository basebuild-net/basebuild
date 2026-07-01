# Testing and Verification

Every change MUST be verified before yielding. The verification path depends
on what changed.

## By change type

| Change type | Required verification |
|---|---|
| TypeScript/React | `npx tsc --noEmit`, `npm run build` |
| Browser workflow / regression | `npm run test:e2e` |
| UI/CSS | Screenshot of the changed view in the running app |
| Settings/permissions | Test default values, reset, and persistence |
| Analytics | Test that collection and upload are disabled on fresh install |
| Agent/chat | Test adapter start, message send, draft injection, and error states |
| Plans | Test CRUD end-to-end (create, edit, status change, delete) |
| Docs | Verify all cross-references resolve and content matches code |

## Commands

```bash
npx tsc --noEmit     # Type check
npm run build        # Frontend build
npm run test:e2e     # Playwright browser regression tests with mocked Tauri commands
cargo check          # Rust check (run in src-tauri/)
cargo test           # Rust tests (run in src-tauri/)
```

## Visual verification

After every UI change, visually verify. Never yield a UI change without a
screenshot.

1. Run `npm run tauri dev` and open the app.
2. Use the browser/screenshot tool to capture the window.
3. Check alignment, spacing, hover states, collapsed/expanded modes, tooltips,
   and the active tool tab highlight.
4. Test the actual interaction.

## Test boundaries

- Test behavior, not implementation state.
- Assert logical behavior: what the user sees and what persists.
- Aim at conditional branches, edge values, invariants across fields, and error
  handling versus silent broken results.
- Run only tests you added or modified unless asked otherwise.
- Rust tests for services: test the service methods directly, not through Tauri commands.
- Frontend tests: test hooks and pure functions, not React component internals.
- Browser workflow tests use Playwright against the Vite dev server with mocked
  Tauri commands (`BASEBUILD_E2E=1`) so renderer crashes are visible in CI.

## What NOT to do

- Do not disable tests to make them pass.
- Do not suppress warnings to hide real problems.
- Do not ship stubs, placeholders, mocks, or `TODO: implement` as delivered work.
- Do not skip visual verification for UI changes.
