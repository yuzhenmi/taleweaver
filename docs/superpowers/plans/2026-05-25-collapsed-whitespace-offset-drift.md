# Collapsed-whitespace cursor-offset drift — Fix Plan

> **For agentic workers:** subagent-driven-development; one implementer; independent
> code-reviewer gate before commit; TDD with behavior-level cursor/hit-test regression tests
> through the real render→layout pipeline (per the project's caret/paint/nav regression rule).

**Goal:** Cursor positions stay aligned with STATE offsets across collapsed whitespace. Today,
consecutive whitespace (e.g. a double space) under `white-space: normal` collapses to one
rendered space, but the IFC's offset accounting counts **rendered** `text.length`, so the
collapsed-away character(s) are owned by no run and every cursor offset after a collapsed run
is short by the collapse count. User-reported symptom: double-clicking the third word (after a
double space) selects the **second** word.

## Root cause (confirmed by reproduction)
- State offsets for `"dsajidosja idoajs  dsajiodj"`: word3 `"dsajiodj"` = `[19,27)` (the two
  spaces are state offsets 17 and 18).
- The tokenizer collapses `"  "` to one rendered space token; `indexOf` correctly finds word3's
  source at 19 (skipping space@18), so **token source positions are right**, but space@18 is
  consumed by NO token.
- `ifc.ts` `unitOffsetContribution` (line ~659) sums `t.text.length`, and `line-flatten.ts`
  `offsetContribution` (line ~245) is `box.text.length`. Both count rendered chars, so the
  per-run/per-line offset cursor under-counts the collapsed char.
- **Reproduction (hit-test):** click at the rendered start of word3 (x≈146) resolves to state
  offset **18** (not 19). `selectWord(18)` → `[11,17)` = word2. ← the bug.
- Single spaces never collapse (rendered == state), so normal typing never tripped it. The
  `L-F/A4` comment in `ifc.ts` (~204-212) flagged this source-position drift as deferred.

## Fix: count SOURCE characters, attributing trailing collapsed whitespace to the preceding run
A text-run owns its rendered chars PLUS any collapsed-away whitespace immediately following it
(up to the next run's first source char). This keeps the NEXT run's base offset equal to the
state offset of its first rendered glyph — so a click on word3's first glyph maps to 19.

Rule: for each token, `sourceLength = (next token's source matchStart) − (this token's
matchStart)`; for the LAST token of a text node, `sourceLength = node.text.length −
matchStart`. (Absorbs the inter-token collapsed gap + any trailing collapsed whitespace into the
preceding token.) Inline-block token: `sourceLength = 1` (embed = 1 state unit). Synthetic
hyphen run: `offsetLength = 0` (rendered glyph, no state char). For the non-collapsing common
case `sourceLength === text.length`, so **no regression** for single-space / no-whitespace text.

## Tasks

### Task 1: thread `offsetLength` through the IFC
**Files:** `packages/core/src/layout/layout-box-v2.ts` (TextRunBox + createTextRunBox),
`packages/core/src/layout/ifc.ts` (Token.sourceLength, collectInlineTokens, unitOffsetContribution,
buildLineWithFragments createTextRunBox call sites).
- `TextRunBox` gains `readonly offsetLength: number` (state chars this run owns). `createTextRunBox`
  takes it as a new param. The two call sites: the merged-token run (sum of its tokens'
  `sourceLength`) and the synthetic hyphen run (`0`).
- `Token` gains `readonly sourceLength: number`. In `collectInlineTokens`, after the per-node token
  loop computes each token's `matchStart`, set `sourceLength` per the rule above (look-ahead to the
  next token's matchStart within the node; last token → `fullText.length − matchStart`). Handle the
  `LINE_BREAK` token (its matchStart is the `\n` position; sourceLength falls out of the rule = 1
  for a lone `\n`). Inline-block token sourceLength = 1.
- **CRITICAL — hyphen-split tokens.** `tryHyphenSplit` (ifc.ts ~544-569) creates synthetic
  `prefixToken` / `suffixToken` literals. They MUST also set `sourceLength`, split by character count
  at the break index: `prefixToken.sourceLength = bestBreakIdx`; `suffixToken.sourceLength =
  original.sourceLength − bestBreakIdx`. (The hyphen GLYPH is separate — the synthetic hyphen
  `TextRunBox` gets `offsetLength: 0`, below.) Without this, summing `t.sourceLength` yields `NaN` for
  hyphenated lines. Do NOT fall back to `?? t.text.length` — set it explicitly so the contract is total.
- The TWO `createTextRunBox` call sites are: ifc.ts ~1199 (`buildLineChildrenForAncestorLevel`, the
  merged-token run → `offsetLength` = sum of its tokens' `sourceLength`) and ifc.ts ~1119
  (`buildLineWithFragments`, the synthetic hyphen run → `offsetLength: 0`).
- `unitOffsetContribution` (ifc.ts) sums `t.sourceLength` (inline-block → 1) instead of `t.text.length`.
  This makes `cursorOffset` / line `inlineOffsetStart`/`inlineOffsetEnd` STATE-correct and keeps the
  `nextLine.inlineOffsetStart === prevLine.inlineOffsetEnd` invariant (the cursor flows continuously
  through flushLine).
- TDD (ifc.test / a new ifc offset test): a paragraph `"a  b"` (double space) ⇒ the run(s) carry
  offsetLength summing to 4 (state length), the line `inlineOffsetEnd === 4`; `"a b"` (single) ⇒
  unchanged (offsetLength === text.length); inline-block + text mix; a `\n` line break.

### Task 2: consume `offsetLength` in the cursor layer (hit-test + cursor-position + selection-geometry)
**Files:** `packages/core/src/cursor/line-flatten.ts` (`offsetContribution`), and verify
`hit-test.ts`, `cursor-position.ts`, `selection-geometry.ts`, `line-navigation.ts` all stay correct.
- `line-flatten.ts` `collectLeavesRec`: text-run `offsetContribution = box.offsetLength` (was
  `box.text.length`); inline-block stays `1`. Update the LineLeaf docstring (offsetContribution is the
  STATE-char span, ≥ rendered text.length when trailing whitespace was collapsed).
- **hit-test** (`hit-test.ts`): step 7 already sums preceding leaves' `offsetContribution` for the
  base, then adds `findCharOffset` over the target leaf's rendered `box.text`. With the corrected
  contributions the base is state-correct; `findCharOffset` clamps to `text.length` so a click in the
  target run never exceeds its rendered chars. (A click in a run's trailing collapsed-whitespace
  region lands at `text.length` of that run = the boundary, acceptable.) No code change beyond the
  contribution source — but ADD a regression test (the repro).
- **cursor-position (X-from-offset inverse)** (`cursor-position.ts` ~293-298): it accumulates
  `leaf.offsetContribution` (now the corrected state span) then does `leaf.box.text.slice(0,
  localOffset)`. An offset inside a run's collapsed-whitespace tail gives `localOffset >
  box.text.length`. Add an EXPLICIT clamp `const localChar = Math.min(localOffset,
  leaf.box.text.length)` before the slice (do NOT rely on JS `slice` silently clamping — the
  project's type-safety standard wants the intent explicit). Add a test: offset 18 (the collapsed
  space) → right edge of "idoajs "; offset 19 → start of "dsajiodj".
- **selection-geometry** + **line-navigation**: both consume the same leaf offsets / `findLineForPosition`
  (state-offset based). Verify no double-counting; add a selection-rect test spanning across a collapsed
  double space (the highlight covers the right state range).

### Task 3 (regression lock): editor-level double-click test
**File:** `packages/dom/src/editor-controller.test.ts` OR a core cursor test.
- The original symptom end-to-end: render the user's text, resolve a click on word3 → offset 19 →
  `selectWord` → `[19,27)`. (Hit-test repro at core level is sufficient if the dom harness is awkward;
  the core repro already exercises render→layout→hit-test→selectWord.)

## TDD matrix (write RED first)
1. **Repro:** click rendered-start of word3 in `"dsajidosja idoajs  dsajiodj saoidj"` → offset 19;
   `selectWord` → `[19,27)`. (Currently 18 → `[11,17)`.)
2. Single space `"a b"` → byte-identical offsets (no regression).
3. Triple space `"a   b"` → "b" at correct state offset (collapse count 2).
4. Leading collapsed space at run start; trailing collapsed space before a soft wrap (multi-line,
   container width forces wrap mid-paragraph) → `nextLine.inlineOffsetStart === prevLine.inlineOffsetEnd`,
   click on first word of line 2 maps to its state offset.
5. cursor-position inverse: offset→X for an offset inside a collapsed-whitespace tail clamps to the
   run's right edge; offset at the next word's start → that word's left edge.
6. **Hyphen-split across a collapsed space:** a hyphenated word followed by a double space then a word,
   wrapping at the hyphen → no `NaN` offsets, the post-double-space word resolves to its state offset
   (exercises the split-token `sourceLength` propagation).
7. **All-whitespace text node** (`"   "` alone) and **leading collapsed whitespace** (`"  word"`):
   confirm this fix does NOT change their behavior (these are PRE-EXISTING separate gaps — orphan/
   all-whitespace tokens are skipped by the unit-grouper today; the fix neither fixes nor worsens
   them). Assert the current `inlineOffsetEnd` is unchanged so we have a regression lock; the real fix
   is a follow-up (see Out of scope).
8. **`collectTokens` external path:** the exported `collectTokens` tests in `ifc.test.ts` assert each
   returned `token.sourceLength` is populated and correct (the field rides the external path too).
9. Full core + dom suites stay green (the existing hit-test/cursor-position/selection tests use
   single-space or no-whitespace fixtures ⇒ `sourceLength === text.length` ⇒ unaffected).

## Out of scope / follow-up
- **Leading collapsed whitespace** (`"  word"`) and **all-whitespace text nodes** (`"   "`): the
  unit-grouper skips orphan/leading space tokens, so their state chars are dropped from the offset
  accumulator TODAY (pre-existing). This fix targets INTER-word trailing collapsed whitespace only; it
  does not fix the leading/all-whitespace case (and the TDD locks that it isn't made worse). Separate
  follow-up task: attribute leading/orphan whitespace so `inlineOffsetEnd === block inlineContent
  length` for whitespace-only and leading-whitespace lines.
- `white-space: pre-wrap` (multiple whitespace survives as rendered chars) — the rule still holds
  (no collapse ⇒ sourceLength == text.length), but add a `pre-wrap` smoke test if cheap.
- The `L-F/A4` dev-mode warning in `ifc.ts` can be removed/retargeted once source positions are
  threaded (the warning was a placeholder for exactly this fix) — fold into Task 1 if clean.

## Status
- [ ] T1 — IFC `offsetLength` threading.
- [ ] T2 — cursor-layer consumption + clamps + tests.
- [ ] T3 — editor-level double-click regression lock.

## Browser-verify (user, after commit)
Type text with a double space, double-click words after it — they select correctly; click-to-place
caret and arrow navigation land correctly after the double space.
