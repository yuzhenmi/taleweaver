# P17 — Final greening pass

**Subject:** Run all checks (typecheck, unit tests, integration tests, browser smoke, perf benchmarks). Confirm everything green. State-redesign migration complete.

**Reference:** Master spec migration step 16; spec lines 533-540 (Build/test acceptance criteria).

## Goal

The migration's terminal gate. After P5-P16, run the full battery of checks one more time. Everything passes = migration done.

Per spec lines 533-540:
- `npm run build --workspace=packages/core` succeeds with no TypeScript errors.
- `npm test --workspace=packages/core` passes 100% of tests.
- `npm test --workspace=packages/core/src/integration` (or equivalent) passes 100%.
- `npm run dev --workspace=examples/react` launches the editor; manual smoke (insert text in multiple paragraphs, format text bold/italic, create lists, undo/redo, copy/paste a multi-paragraph selection) works without errors.
- Performance benchmarks pass per the criteria in P14.

## Dependencies

P5-P16 all complete.

## Current state

By the time we reach P17, the codebase is post-migration. P17 is verification, not change.

## Files involved

**Modified:**
- Possibly: a final commit to fix any small issues that surface during the check (e.g., a missed import, a flaky test). Otherwise no code changes.
- A summary commit message describing "migration complete" milestone.

## Key technical considerations

1. **Every check from the spec.** Don't skip the perf benchmarks. Don't skip browser smoke.

2. **Smoke test checklist.** Per master spec line 538:
   - Insert text in multiple paragraphs.
   - Format text bold / italic.
   - Create lists (ordered + unordered).
   - Undo / redo.
   - Copy / paste a multi-paragraph selection.
   Plus anything else accumulated as smoke checks during P11.x phases.

3. **Perf benchmarks from P14.** Run the full suite. All within thresholds.

## Risks and patterns to apply

- **If something fails at this gate, ESCALATE.** Don't try to "just fix it" silently. Document the failure, file it as a follow-up phase if it requires real work, or fix-and-document if trivial.

## Test strategy

The existing test suite IS the test strategy. Plus benchmarks. Plus manual smoke.

## Open questions

None. P17 is gate-checking.

## Success criteria

All of:
- `npm run build --workspace=packages/core` clean.
- `npm test --workspace=packages/core` 100% pass.
- Integration tests 100% pass.
- Browser smoke checklist passes.
- All perf benchmarks pass.
- `grep -r "StateNode" packages/core/src/` returns empty (per spec line 503).
- All architectural invariants pass (per spec lines 502-512).

## Review cycle expectations

Pre-execution: brief (verify scope of checks). Post-execution: replaced by green confirmation per Strategy Decision 5 exception.

## Estimated commits

~1-2 (often just the "migration complete" commit; possibly 1 extra for any last-minute fix).
