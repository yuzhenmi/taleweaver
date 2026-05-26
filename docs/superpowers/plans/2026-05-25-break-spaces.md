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

1. **`WhiteSpace` union** (`styles/style.ts` ~25): add `"break-spaces"`. (Confirm `whiteSpace` stays
   `inherits: true` in property-meta.ts; initial value stays `"normal"`.) Then grep for any EXHAUSTIVE
   `switch`/`satisfies never` over `WhiteSpace` and add the arm (the tokenizer `default: throw` is the
   main one — see #2).
2. **Tokenizer** (`text-tokenize.ts`): add `case "break-spaces":` as a FALL-THROUGH to the `pre-wrap`
   branch body (word tokens + one `" "` per space char, `LINE_BREAK` between `\n` segments). ⚠ The
   `default:` arm THROWS at runtime — adding `break-spaces` to the union WITHOUT this case is a silent
   TS pass + hard runtime crash on any break-spaces layout. The break-spaces TDD fixtures catch it, but
   add the case deliberately.
3. **`preservesWhitespace(ws)`** (ifc.ts): include `break-spaces` → `pre | pre-wrap | break-spaces` (so
   nothing collapses).
4. **`canWrap`** (ifc.ts ~448): the current formula is `ws !== "nowrap" && ws !== "pre"`, which ALREADY
   wraps for `break-spaces` — **NO code change needed**; just confirm (optionally a comment). Do NOT
   convert to an allowlist.
5. **The wrap-unit grouper (the core change — BOTH slurp paths).** Derive `isBreakSpaces` from the SAME
   whiteSpace source each branch already reads (the leading/orphan branch reads `tok.style.whiteSpace`
   at ~529 — use that, so an inline element's own mode is honored consistently). Under `break-spaces`,
   emit ONE wrap unit PER SPACE TOKEN in **both** grouper branches:
   - **(a) non-space (trailing-slurp) branch** (~567-586): gate the trailing-space slurp on
     `!isBreakSpaces` — under break-spaces the word emits alone (advance past the word only).
   - **(b) leading/orphan space branch** (~511-554, the Phase-1-T2 space-run path): ⚠ plan-review C2 —
     this path ALSO slurps a run of consecutive same-sourceKey spaces into ONE unit. Under break-spaces
     that would re-bundle the trailing spaces (word emits alone → its following spaces hit THIS branch →
     get slurped) and reproduce the caret-off-page bug. So gate the leading/orphan slurp on
     `!isBreakSpaces` too: when `isBreakSpaces`, emit exactly ONE unit for the single current space
     token `tok` and advance `i` by 1. (For `pre`/`pre-wrap` keep the space-run bundling; for
     `normal`/`nowrap` keep the existing skip.)
   - A single-space unit flows through `buildLineWithFragments` as a normal text-run (confirm). The
     reverted hang stays gone — the wrap test uses `unit.totalWidth`; a 1-glyph space unit only
     force-places past the edge if `lineInlineSize < one-space-width` (degenerate) ⇒ caret stays
     on-page. Leave `pre-wrap`/`normal` byte-identical.
6. **Editor default:** `document.ts` `whiteSpace: "pre-wrap"` → `"break-spaces"`. Update the doc comment
   (body default is now break-spaces = Google-Docs trailing-space behavior; the old "Google-Docs/Word"
   claim for pre-wrap was aspirational).
7. **`paragraph.ts` `VALID_WHITE_SPACES`:** add `"break-spaces"` (⚠ `ReadonlySet<WhiteSpace>` does NOT
   force this — omission silently makes the per-paragraph `whiteSpace:"break-spaces"` attr fall back to
   inherit; add it deliberately).
8. **Blast-radius audit (plan-review C1):** grep for tests that render through the DOCUMENT DEFAULT
   (no explicit `white-space` pin) AND assert line counts / offsets / x-positions on text with TRAILING
   spaces — confirm each is unaffected by the pre-wrap→break-spaces grouper change or update it. (The
   known default-pipeline tests use interior-space `"a  b"` or explicit modes ⇒ expected safe; CONFIRM,
   don't assume. Phase-1 collapse-pins use explicit `normal` ⇒ unaffected.)

**TDD (write FIRST — `ifc.test.ts` + a default-pipeline test; 8px/char mock shaper; explicit
`white-space: break-spaces` in the IFC fixtures, default pipeline for the document test):**
- **Trailing spaces WRAP (caret on-page), word NOT split:** `"ab cd        "` (8 trailing spaces) at a
  width that fits `"ab cd"` but not all the spaces → `"ab cd"` + some spaces on line 1, remaining
  spaces on line 2 (≥2 lines); assert the LAST space's position (line 2) is within the page width
  (its x + its width ≤ lineInlineSize, i.e. no glyph past the edge), and `"ab cd"` is intact on line 1
  (NOT split). Contrast: this is what the reverted hang got wrong (spaces past the edge).
- **Word not split early (precise width — this discriminates from pre-wrap's slurped unit):**
  `"ab cd   "` at containing inline-size **40px** (`"ab cd"` = 5×8 = 40 fits exactly; `"ab cd "` = 48
  does NOT). Assert `"ab"` and `"cd"` are on the SAME line (line 1). Under the old slurped
  `["cd"," "," "," "]` unit this overflowed and hopped `"cd"` to line 2 — the bug. Under per-token
  units `"cd"` (16px) fits after `"ab "`(24px) = 40 ≤ 40, stays; the trailing spaces wrap.
  This bullet + the trailing-spaces-wrap bullet together are the load-bearing C2 guards — if the
  leading/orphan slurp (5b) is NOT gated, the trailing-space run bundles and the caret-on-page
  assertion below fails.
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
- [x] T1 — break-spaces model + per-token wrap units + editor default flip.
  Implemented 2026-05-25 (pending reviewer gate + commit by controller). WhiteSpace
  union + tokenizer fall-through + preservesWhitespace + grouper (both slurp branches
  gated on per-token isBreakSpaces) + document.ts default + paragraph.ts VALID_WHITE_SPACES.
  TDD: 7 new ifc.test.ts cases (incl. caret-on-page guard) + 1 default-pipeline + 5
  tokenizer fall-through cases. Full core (1682 pass) + dom (149 pass) green; core +
  examples/react build clean. Blast-radius audit: default-pipeline trailing/interior-space
  fixtures (cursor-position #242 abc /abc  , hit-test "a  b") unaffected — interior single
  spaces wrap identically and short trailing-space fixtures fit on one line; stale
  `pre-wrap`-default comments in those test files updated to `break-spaces`.
