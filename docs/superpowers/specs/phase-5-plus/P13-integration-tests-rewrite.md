# P13 — Integration tests rewrite

**Subject:** Migrate the 19 integration test files in `packages/core/src/integration/` from constructing legacy `StateNode` trees to constructing new `State` blocks. Verify end-to-end pipelines continue to produce correct output.

**Reference:** Master spec migration step 12; spec line 519 ("Integration tests in `packages/core/src/integration/` rewritten to construct new-shape state and exercise editor operations end-to-end").

## Goal

Integration tests exercise the full editor pipeline (state → render → cascade → layout → paint). They've been the backstop for catching regressions across modules. P13 rewrites their fixtures to use new `State`. The tests themselves don't change behavior — they verify the pipeline still works post-migration.

## Dependencies

P11.x + P12 complete (the pipeline produces correct output for new state).

## Current state

Per directory survey 2026-05-08, `packages/core/src/integration/` has at least 19 test files:
- `anonymous-boxes.test.ts`, `container-resize.test.ts`, `delete-unwrap.test.ts`, `empty-document.test.ts`, `floats-real.test.ts`, `incremental-layout.test.ts`, `incremental-pipeline.test.ts`, `incremental-wrap.test.ts`, `inline-formatting.test.ts`, `intrinsic-sizing.test.ts` ... (more not surveyed).

Most build a `StateNode` tree, run the pipeline, assert RenderNode shapes / pagination outputs / etc.

## Files involved

All integration test files in `packages/core/src/integration/`. ~19 files.

May share helper utilities; survey at P13 plan time.

## Key technical considerations

1. **Bulk fixture migration.** Mechanical — swap fixture builders from legacy `createNode`/`StateNode` to new `buildBlock`/`buildState`. Verify each test still passes (or fix small discrepancies).

2. **No new test coverage in P13.** Integration tests come along for the ride. New coverage was added in Phase 4 + P11.x.

3. **Helpers.** Integration tests probably share fixture-construction helpers. Update once; consumers benefit.

## Risks and patterns to apply

- **Test parity** ensured: same assertions, just new fixtures. If a test passes today and fails after migration, that's a real regression to investigate.
- **Implementer escalation:** if a test fails after fixture migration and the production code is correct, the test may have been asserting an artifact of the legacy state structure (e.g., depth-of-tree, path lengths). Flag and fix the assertion, not the code.

## Test strategy

Build + tests green at end. No net new test coverage.

## Open questions

1. **Helper consolidation.** If many integration tests share fixture-construction logic, extract to `integration/test-helpers.ts` (or use the existing test-utils builders).

## Success criteria

- All integration tests pass with new state fixtures.
- No legacy type refs in `packages/core/src/integration/`.
- Build + tests green.

## Review cycle expectations

Pre-execution: yes (verify scope is right). Post-execution: yes (regression catch).

## Estimated commits

~7-10 (per-test-file commits or grouped commits).
