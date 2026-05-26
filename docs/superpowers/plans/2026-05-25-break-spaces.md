# Trailing-space behavior → `break-spaces` (Google Docs) — Design + Plan (#314)

> **For agentic workers:** subagent-driven-development; one implementer; independent code-reviewer gate
> before commit; TDD with behavior-level layout tests through the real render→layout pipeline.

**Decision (user, 2026-05-25, by first principles — not a fork):** the editor's trailing/preserved-space
behavior must match Google Docs = CSS `break-spaces`. The reverted Phase-2 `pre-wrap` "hang" let the
caret go past the page edge (wrong). `break-spaces`: preserved spaces TAKE WIDTH and WRAP independently
to the next line, so the caret stays on-page AND words are never split early.

## The design (why break-spaces is clean + correct)
CSS Text 3 `break-spaces`: preserved white space takes up space (no collapse), and there is a soft-wrap
opportunity AFTER every preserved space, including at line end (so a run of spaces wraps onto
subsequent lines instead of hanging).

**Mechanism: under `break-spaces`, every token is its OWN wrap unit** (each word a unit, each space a
single-glyph unit) — the grouper does NOT slurp trailing spaces into the preceding word's unit. The
existing greedy wrap loop then gives exactly the right behavior:
- A word is its own unit → placed whole or wrapped whole → **never split early** (fixes the
  reverted-Phase-2-and-Phase-1 quirk where a word hopped lines when you typed a trailing space).
- Each space is a one-glyph unit that takes width → when a space overflows the line, the greedy loop
  wraps it to the next line (break "after" the prior space). A run of trailing spaces flows across
  lines.
- **The caret can never leave the page:** the wrap loop only places an overflowing unit when it's the
  FIRST on an empty line (can't-wrap-a-single-unit). A one-glyph space unit fits on any non-degenerate
  line, so a space is never force-placed past the edge — unlike the old atomic word+spaces unit (which
  could overflow alone) or the hang (which rendered spaces past the edge by design).
- Interior single spaces are unaffected: `"a b"` → `[a][sp][b]`; the greedy loop breaks before `b` when
  `b` doesn't fit (= after the space) → normal word wrap, identical to today.

The offset model is unchanged (each space = 1 state char, sourceLength 1 — already true from the
pre-wrap tokenizer). `break-spaces` reuses the pre-wrap tokenizer (word + per-space tokens).

## Tasks (one implementer, sequential within the one diff is fine — it's a cohesive change)

### T1: add `break-spaces` to the whitespace model + make it per-token wrap units + flip the editor default
**Files:** `packages/core/src/styles/` (the `WhiteSpace` union — likely `style.ts`); `packages/core/src/layout/text-tokenize.ts`; `packages/core/src/layout/ifc.ts` (the wrap-unit grouper + `preservesWhitespace` + `canWrap`); `packages/core/src/components/document.ts`; `packages/core/src/components/paragraph.ts` (`VALID_WHITE_SPACES`); tests.

1. **`WhiteSpace` union:** add `"break-spaces"`. (Confirm `whiteSpace` stays `inherits: true` in
   property-meta.ts; the initial value stays `"normal"`.)
2. **Tokenizer:** add a `case "break-spaces":` to `tokenize` that produces the SAME tokens as
   `pre-wrap` (word tokens + one `" "` per space char, `LINE_BREAK` between `\n` segments). Cleanest:
   fall through / share the `pre-wrap` branch body.
3. **`preservesWhitespace(ws)`** (ifc.ts): include `break-spaces` (so leading/orphan spaces render via
   the Phase-1-T2 path and nothing collapses) → `pre | pre-wrap | break-spaces`.
4. **`canWrap`:** `break-spaces` WRAPS (like `pre-wrap`/`normal`, unlike `pre`/`nowrap`). Wherever
   `canWrap` is derived from `whiteSpace`, add `break-spaces` to the wrapping set.
5. **The wrap-unit grouper (the core change):** when the active `whiteSpace` is `break-spaces`, emit
   ONE wrap unit PER TOKEN — do NOT slurp trailing spaces into the word unit (so each space is an
   independent break point + width-taker). Leave the slurp behavior for `pre-wrap`/`normal` unchanged.
   (Implementation: gate the trailing-space-slurp loop on `!isBreakSpaces`; a lone space then forms its
   own single-token unit — confirm a single-space unit flows through `buildLineWithFragments` as a
   normal text-run, like the Phase-1-T2 space-run unit does.) Each space unit's
   `trailingWhitespaceWidth` is moot now (the reverted hang is gone) — do NOT reintroduce the hang;
   the wrap test uses `unit.totalWidth` as normal.
6. **Editor default:** `document.ts` `whiteSpace: "pre-wrap"` → `"break-spaces"`. Update the doc comment
   (the body default is now break-spaces — Google-Docs trailing-space behavior).
7. **`paragraph.ts` `VALID_WHITE_SPACES`:** add `"break-spaces"` so a per-paragraph attr override can
   select it.

**TDD (write FIRST — `ifc.test.ts` + a default-pipeline test; 8px/char mock shaper; explicit
`white-space: break-spaces` in the IFC fixtures, default pipeline for the document test):**
- **Trailing spaces WRAP (caret on-page), word NOT split:** `"ab cd        "` (8 trailing spaces) at a
  width that fits `"ab cd"` but not all the spaces → `"ab cd"` + some spaces on line 1, remaining
  spaces on line 2 (≥2 lines); assert the LAST space's position (line 2) is within the page width
  (its x + its width ≤ lineInlineSize, i.e. no glyph past the edge), and `"ab cd"` is intact on line 1
  (NOT split). Contrast: this is what the reverted hang got wrong (spaces past the edge).
- **Word not split early:** `"ab cd   "` where `"ab cd"` fits → `"ab cd"` together on line 1 (the
  trailing spaces that fit stay; any overflow wraps). Assert `"ab"` and `"cd"` are on the SAME line
  (the reverted Phase-1/-2 quirk split them).
- **Interior single-space wrap unchanged:** `"aaaa bbbb cccc"` at a 2-word width → wraps at the
  interior space exactly as `normal`/today (no regression in word wrapping).
- **Multiple + leading spaces still render** (break-spaces preserves): `"  a   b"` → all spaces render
  (leading 2 + interior 3); line owns all state offsets.
- **A run of spaces longer than a line wraps across multiple lines** (caret never off-page): a 20-space
  run in a 40px width → spaces flow onto several lines, none past the edge.
- **Offset continuity:** `nextLine.inlineOffsetStart === prevLine.inlineOffsetEnd` across a
  space-driven wrap; caret offset after the spaces resolves on the correct line.
- **Default-pipeline:** with the document default now `break-spaces`, the existing whitespace browser
  behaviors (multiple spaces render, double-click) still hold; the Phase-1 collapse-pin tests (explicit
  `white-space: normal`) are unaffected.
- **NO-REGRESSION:** `normal`/`nowrap`/`pre`/`pre-wrap` behavior byte-identical (the per-token grouping
  is gated on `break-spaces` only). Full core + dom green.

## Verify
- `npm run build --workspace=packages/core` clean; FULL core + dom green; `examples/react` builds.
  Reviewer gate, then commit.

## Out of scope / notes
- Per-token units mean ~1 unit per space char; fine for normal text. A space-run-coalescing perf
  optimization (one breakable multi-space unit) is a possible later refinement, not needed for
  correctness.
- Alignment of trailing spaces (center/right/justify) still depends on textAlign (#312, unimplemented)
  — out of scope.

## Status
- [ ] T1 — break-spaces model + per-token wrap units + editor default flip.
