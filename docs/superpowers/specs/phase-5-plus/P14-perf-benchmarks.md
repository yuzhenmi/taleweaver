# P14 — Performance benchmarks

**Subject:** Add performance benchmarks for the spec's acceptance criteria. Verify benchmarks pass per the targets.

**Reference:** Master spec migration step 13; spec lines 521-531 (Performance acceptance criteria).

## Goal

Per spec lines 521-531, the migration is gated on these performance targets:

- Per-keystroke `insertText` at 10,000 blocks: < 1 ms (target = "smooth").
- Per-keystroke `insertText` at 100,000 blocks: < 16 ms (target = "graceful degradation, sub-frame").
- Per-cursor-move at 10,000 blocks: < 1 ms.
- Cross-block `compareBlocksInDocOrder` at 10,000 blocks, typical depth 5: < 100 µs.
- Memory usage of 100 undo snapshots at 10,000 blocks: < 100 MB.

P14 lands the benchmark suite that measures these and gates "definition of done."

## Dependencies

All of P5-P13 complete (the system is the final shape that we're measuring).

## Current state

`packages/core/src/state/perf.bench.ts` doesn't exist yet (per spec line 523). New file.

`vitest` supports benchmark tests via the `bench` API. No additional infrastructure needed — possibly a `vitest.config.ts` adjustment to include `.bench.ts` files in a separate run.

## Files involved

**Created:**
- `packages/core/src/state/perf.bench.ts` (or similar path) — the benchmark suite.
- Possibly helpers for generating large test documents (10K, 100K blocks).

**Modified:**
- Possibly `vitest.config.ts` or scripts in `package.json` to add a benchmark run.

## Key technical considerations

1. **Document generators.** Need helpers to build a 10,000-block document deterministically. E.g., `buildLargeDocument({ blockCount: 10_000, depth: 5, blockType: "paragraph", textPerBlock: "Hello World" })`. Lives in test-utils or in the .bench.ts file itself.

2. **Operation isolation per benchmark.** Each `bench(...)` block measures a specific operation. The setup builds the state once; the measured operation runs many times against the immutable state.

3. **Warmup and iterations.** vitest's bench API handles this. Default settings probably fine; tune if measurements are noisy.

4. **Memory measurement.** The "100 undo snapshots, 100MB" criterion requires actually measuring memory. Node's `process.memoryUsage()` works but is per-process. Measure RSS or heap-used. Need to GC between snapshots for stability.

5. **CI integration.** Benchmarks run as part of `definition of done` greening. Decide: do they run in CI on every PR (slow), only on the migration-complete commit, or as a manual `npm run bench` step? Probably manual for migration; CI gating for the final greening pass.

## Risks and patterns to apply

- **Benchmark stability.** Random fluctuations can flake CI. Run multiple iterations, take median.
- **No production-code changes for performance.** P14 is measurement, not optimization. If a benchmark fails the target, ESCALATE — that's a Phase 5+ scope question, not a P14 problem.

## Test strategy

Benchmarks ARE the test strategy. Each benchmark `bench(...)` block has an explicit threshold from the spec, and the suite asserts against the threshold.

Optionally: add a few correctness assertions in each bench setup (e.g., "the 10K-block document we generated has 10,000 blocks") to catch fixture-generation bugs.

## Open questions

1. **Threshold tolerance.** The spec says "< 1 ms" for insertText at 10K blocks. CI variance might cause flakes. Add tolerance (e.g., < 1.2 ms) for CI gating, but log the actual measurement for visibility.
2. **Failure escalation.** If `compareBlocksInDocOrder` measures 150 µs instead of < 100 µs at 10K blocks, what's the path? File a perf followup, optimize via memoization or different data structures, then revisit.

## Success criteria

- Benchmark file exists, exercises every spec performance criterion.
- All benchmarks pass per their thresholds.
- A `npm run bench --workspace=packages/core` (or equivalent) script invokes them.

## Review cycle expectations

Pre-execution: yes. Post-execution: yes. (Benchmarks are code — code reviewer pass for sanity of the measurement.)

## Estimated commits

~5-7.
