# Tasks: Diff Review Workflow

## 1. Changeset Backend

- [ ] 1.1 `changeset_service.rs`: baseline ref creation (stash-create style + untracked list), diff computation vs baseline, per-file states; `run_changesets` migration.
- [ ] 1.2 File revert in `git_service.rs`: restore baseline blob, delete added, restore deleted; post-run-edit guard (hash compare + confirmation flag).
- [ ] 1.3 Baseline cleanup on terminal review state + startup orphan prune.
- [ ] 1.4 Rust tests in temp repos: baseline invisibility (`git status` unchanged), add/modify/delete attribution, untracked handling, revert matrix, guard on post-run edits, orphan prune.

## 2. Run Integration

- [ ] 2.1 Hook baseline creation into run start (`plan_runner_service`) for native and OMP runs; fail run start on baseline failure; non-git degradation notice.
- [ ] 2.2 Persist changeset + review states on run records; compute at completion and on review open (OMP lazy path).
- [ ] 2.3 Review gate in final-touches executor: write-kind steps wait for reviewed/skipped on queue runs; skip event recorded; ad-hoc sessions ungated; `review.gateEnabled` flag.
- [ ] 2.4 Rust tests: gate matrix (queue vs ad-hoc × reviewed/pending/skipped), queue continues while gate waits.

## 3. Review UI

- [ ] 3.1 Commands + `src/lib/changesets.ts` wrappers (list, diff, approve, revert, skip, send-back).
- [ ] 3.2 Run-scoped review surface reusing SourcePanel diff rendering: file list with badges, per-file approve/revert/send-back, approve-all, revert-all with confirmation; tooltips; `globals.css` only.
- [ ] 3.3 Send-back-to-chat: diff + note posted to run session; file state resets to pending on subsequent change.
- [ ] 3.4 Run card + queue gate states (`awaiting review`, `reviewed`, `skipped`, `n/m reviewed`).
- [ ] 3.5 Frontend tests (mocked Tauri): review flow, revert confirmation, gate state rendering, restart persistence.

## 4. Verification & Docs

- [ ] 4.1 Smoke: queue run changes 3 files → review shows 3 diffs → revert 1, approve 2 → commit step fires; skip path; non-git project notice.
- [ ] 4.2 `npx tsc --noEmit`, `npm run build`, `cargo check`, `cargo test`.
- [ ] 4.3 Update `docs/agents/agent-runtime.md` + `docs/agents/desktop-shell.md`; refresh roadmap via `node scripts/openspec-status.mjs --write`.
