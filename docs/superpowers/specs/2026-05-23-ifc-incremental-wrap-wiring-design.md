# IFC Incremental Wrap Wiring — Design Spec

> Spec for L-E of the layout-module cleanup plan
> (`docs/superpowers/plans/2026-05-23-layout-module-cleanup-plan.md`).
> Status: design needed. The original L-E task was "wire
> rewrapIncremental into IFC" — investigation shows the integration
> is non-trivial because the IFC's existing wrap loop is monolithic
> and the WrapOneLineFn interface requires extracting "wrap one line
> at a time" as a callable. Implementation gated on the open
> questions below.

## Goal

The IFC currently does full O(N) re-wrap on any token change, even
single-character edits in long paragraphs. The `rewrapIncremental`
algorithm in `wrap-incremental.ts` (fully implemented + tested) can
reduce this to O(changed lines + convergence detection) but is never
called by the IFC — only by tests and the (also-unused)
`WrapOneLineFn` interface.

Wiring it in is the largest incremental-layout performance hole in
the engine.

## What rewrapIncremental needs from the IFC

```ts
function rewrapIncremental(
  prev: IFCState | null,
  newTokens: readonly Token[],
  availableInlineSize: number,
  wrapOneLine: WrapOneLineFn,
  lineMeta: WeakMap<LineBox, { startTokenIdx: number; endTokenIdx: number }>,
): readonly LineBox[];

type WrapOneLineFn = (
  tokens: readonly Token[],
  startTokenIdx: number,
) => { line: LineBox; startTokenIdx: number; endTokenIdx: number; availableInlineSize: number };
```

The IFC must supply:
- `prev: IFCState | null` — from `ctx.ifcStateCache.get(parent.key)`. Already
  available; the existing fast-path cache check uses it.
- `newTokens` — already computed.
- `availableInlineSize` — already computed at the layout-pass level.
- `wrapOneLine` — **the hard part**. Today's IFC loop is monolithic;
  there's no "wrap one line from token index N" function.
- `lineMeta` — the IFC already maintains a `WeakMap<LineBox, {start, end}>`
  (line ~364), ready to share.

## What the IFC's current wrap loop looks like

`layoutInlineContent` (ifc.ts ~280-700, the main producer). The wrap
proceeds token-by-token, accumulating units, and finalizes a line
when:
- a hard break is hit,
- the line's accumulated width would exceed the available inline size
  (and `canWrap` is true),
- or the token stream is exhausted.

Within this loop, several concerns are interleaved:
- **Float-aware line dimensions:** each line's `effectiveLineDims(lineBlockOffset)`
  consults `floatEnv.availableInlineSizeAt(...)`. So the available
  inline size is NOT a single pass-level constant — it varies per
  line-block-offset.
- **Hyphen split:** `tryHyphenSplit` may break a long word at a
  hyphenation opportunity (UAX-14 + per-language dictionaries).
  Affects which token ends the line and which starts the next.
- **Strut line:** if zero tokens, emit a single empty line for the
  IFC's strut behavior (paragraph height = at least one line-height).
- **Per-line baseline / vertical-align:** `applyVerticalAlign` runs
  AFTER all lines are wrapped; it positions inline children within
  their line per `verticalAlign`. Not part of wrap-one-line — runs
  later.
- **Fragmentation fit-check:** when `fragmentation !== undefined`, the
  IFC stops emitting lines once the page block size is exhausted and
  returns a `breakToken`. Today's incremental fast-path bypass at
  line 345 skips the cache when fragmentation is active, for this
  reason.

## Open questions for the spec

### Q1 — How do we extract WrapOneLineFn?

The IFC's wrap loop captures a lot of closure state: ancestor stacks,
hyphenation context, float environment, per-pass measurer. A
`wrapOneLine` closure built inside `layoutInlineContent` can capture
all of this. The body of the existing while-loop becomes the closure
body, with the loop-condition becoming the closure's exit.

**Option A: in-place closure.** Define `wrapOneLine` as a local
function inside `layoutInlineContent`. The body wraps tokens until
one line is full, returns `{ line, startTokenIdx, endTokenIdx,
availableInlineSize }`. The outer loop calls `rewrapIncremental(...)`
once and consumes its result; the existing inline-loop in
`layoutInlineContent` is replaced.

**Option B: separate function.** Lift `wrapOneLine` to a top-level
function that takes a `WrapContext` carrying the closure state. More
testable but more refactoring.

Recommended: A. Less code change; the closure pattern fits the
existing structure.

### Q2 — How does rewrapIncremental handle float-varying availableInlineSize?

`rewrapIncremental`'s convergence detector compares
`r.availableInlineSize === availableInlineSize` (a single per-IFC
value), but the IFC actually has DIFFERENT available inline sizes at
different block offsets (when floats are present). A reused tail of
lines might be valid at the old block offsets but not the new ones.

**Two sub-questions:**
- Q2a: Does the convergence check need to additionally compare
  block offsets / float environments?
- Q2b: If floats are present, is incremental rewrap unsafe in
  general? (The current cache fast-path may or may not be — needs
  checking.)

**Conservative answer**: when the float environment has any active
floats inside or above the IFC's block range, skip
`rewrapIncremental` and do a full re-wrap. Only enable incremental
rewrap when `floatEnv` is unused at the IFC's range. This matches
the existing `prevFloatEnv` hardcoded-null in `layoutTreeIncremental`
(noted in the audit as a known conservative gap).

**Permissive answer**: pass the new line's actual `availableInlineSize`
at its block offset; rewrapIncremental compares against the prev
line's availableInlineSize at the prev block offset (which lineMeta
should carry). Requires extending `lineMeta` to store
`availableInlineSize` per line.

The permissive answer is the right end-state but adds complexity.
Conservative answer ships first, permissive answer is a follow-up.

### Q3 — How does the vertical-align pass interact with reused lines?

`applyVerticalAlign` runs over the entire line array after wrapping.
If `rewrapIncremental` returns reused-from-prev `LineBox` references
mixed with newly-wrapped ones, the vertical-align pass walks them
all uniformly — applying the same algorithm to both. As long as the
per-line vertical-align is determined intra-line (which it is — the
function reads `c.computedStyle.verticalAlign` per child), there's
no cross-line dependency. Reuse is safe.

### Q4 — Fragmentation interaction?

Today's cache fast-path bypasses the cache when fragmentation is
active. `rewrapIncremental` doesn't know about fragmentation — it
treats every token as one continuous wrap. If we wrap incrementally
and THEN apply fragmentation's fit-check, we may over-wrap (extra
work for lines that get cut by the page break). Two options:

- **Conservative**: when fragmentation is active, skip
  rewrapIncremental and full-wrap (matches today's bypass). Most edits
  on the current page don't touch off-page content anyway.
- **Permissive**: pass a `maxLines` hint to `rewrapIncremental` and
  stop early. Possible but adds API surface.

Recommended: conservative. Matches the audit's "biggest perf hole"
focus on the common case (single-page editing) without complicating
fragmentation.

### Q5 — Tests?

`rewrapIncremental` has its own unit tests with synthetic
`wrapOneLine`. New integration tests should exercise:
- IFC wrap-one-line closure produces correct output for simple input.
- Single-token edit in long paragraph → only the affected line is
  re-wrapped; head + tail lines are reference-equal.
- Multi-line edit with convergence detection — middle of paragraph
  changes; head and unaffected tail are reused.
- Width change → full re-wrap fallback (no reuse).
- Float present in BFC → full re-wrap fallback (per Q2 conservative).
- Fragmentation active → full re-wrap fallback (per Q4 conservative).

## Decisions

Recorded by controller per first principles, reversible by user
direction.

- **Q1 → A: in-place closure.** Smaller diff; matches existing
  structure.
- **Q2 → Conservative.** Skip incremental rewrap when float
  environment has active floats overlapping the IFC's block range.
  Permissive answer (per-line availableInlineSize comparison) is a
  follow-up — tracked separately when the use case demands it.
- **Q3 → No action needed.** Vertical-align is intra-line; reuse
  is safe.
- **Q4 → Conservative.** Skip incremental rewrap when fragmentation
  is active. Matches the existing cache-bypass discipline.
- **Q5 → Add the six integration tests listed above.**

## Implementation plan (when scheduled)

1. Extract the IFC's wrap loop body into a local `wrapOneLine`
   closure inside `layoutInlineContent`. Closure captures: tokens
   (via param), ancestor state, measurer, shaper, hyphen-break,
   float-aware effectiveLineDims, parentCs.
2. Replace the inline while-loop with:
   ```ts
   const lines = (
     fragmentation === undefined &&
     prevState !== null &&
     prevState.availableInlineSize === availableInlineSize &&
     !floatEnvHasOverlappingActiveFloats(ctx.floatEnv, blockOffset, ...)
   )
     ? rewrapIncremental(prevState, tokens, availableInlineSize, wrapOneLine, lineMeta)
     : wrapAll(tokens, wrapOneLine, lineMeta);  // current fallback
   ```
3. The `applyVerticalAlign` pass after wrap continues unchanged.
4. Update `ifcStateCache.set(...)` to store the new state at the end.
5. Add the six tests.

Estimated scope: 1 substantial commit. The refactor of the IFC's
wrap loop into a closure is the bulk of the work; the
rewrapIncremental call site is trivial. Existing tests in
ifc.test.ts will catch any wrap-correctness regression.

## What's NOT in L-E scope

- Permissive float / fragmentation handling (deferred).
- Cross-IFC convergence (each paragraph wraps independently; that's
  fine).
- Rewriting `rewrapIncremental` itself — the algorithm is correct
  per its existing tests.

## Implementation gate

L-E ships after the L-A...L-D cleanup commits are stable on the
branch (they are, as of HEAD `a9db383`). The next session can
pick up the implementation directly per the plan above; this spec
preserves the design context durably so no re-investigation is
needed.
