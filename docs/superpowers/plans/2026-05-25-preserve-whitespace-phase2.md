# Preserve whitespace — Phase 2 (trailing-space hang at soft wrap) Implementation Plan

> **For agentic workers:** subagent-driven-development; one implementer per task; independent
> code-reviewer gate before each commit; TDD with behavior-level layout tests through the real
> render→layout pipeline. Spec: `docs/superpowers/specs/2026-05-25-preserve-whitespace-pre-wrap-design.md`
> (§C.2). Phase 1 (T1-T3) is committed: multiple spaces render + wrap; `pre-wrap` is the editor default.

**Goal (Phase 2):** under `white-space: pre-wrap`, a run of preserved spaces at a soft-wrap line end
"hangs" — it RENDERS but does NOT count toward the available-width wrap decision and does NOT shift
alignment/justification (CSS Text 3 trailing-whitespace hang; matches Google Docs). Without it, many
trailing spaces force a premature wrap. `normal` mode is intentionally LEFT UNCHANGED (its single
collapsed trailing space is a negligible over-count, and changing it risks regressing established
normal-mode wrap tests — extending the hang to `normal` is a separate CSS-fidelity follow-up).

**Scope gate:** the hang applies only when `preservesWhitespace(parentCs.whiteSpace)` (= `pre-wrap`;
`pre` doesn't wrap so the decision never fires; `normal`/`nowrap`/`pre-line` keep current behavior).

**Why this is correct + low-risk:** in the wrap loop (`ifc.ts` ~850-930) a `WrapUnit` is "a non-space
token + slurped trailing space tokens". A unit's trailing spaces are the line's trailing whitespace
when that unit is last on the line. Standalone space-run units (from Phase-1 T2) only form from
LEADING / post-break spaces, so they are never a line's trailing run — no special case needed.

---

## Task 1: trailing-whitespace hang in the wrap DECISION (the user-visible win)

**Files:** `packages/core/src/layout/ifc.ts` (`WrapUnit` + the unit builders + the 3 wrap-decision
sites + `tryHyphenSplit`'s `available`) (+ tests `ifc.test.ts`).

- **`WrapUnit` gains `readonly trailingWhitespaceWidth: number`** = the summed width of the maximal
  trailing run of `isSpace` tokens at the END of `unit.tokens` (0 if the unit ends in a non-space; for
  a standalone all-space unit it is the whole width — but those are only ever LEADING, never tested as
  trailing). Compute it wherever a `WrapUnit` is constructed: the main grouper (non-space unit that
  slurps trailing spaces), the Phase-1 leading space-run unit, the LINE_BREAK unit (0), and BOTH
  `tryHyphenSplit` outputs (prefix: its own trailing run — normally 0 since it ends at the hyphen
  break; suffix: its trailing run). Define `wordWidth(unit) = unit.totalWidth − unit.trailingWhitespaceWidth`.
- **The 3 wrap-decision comparisons** (`ifc.ts` ~873, ~900, ~916, all `currentWidth + unit.totalWidth >
  lineInlineSize`): when `preservesWhitespace(parentCs.whiteSpace)`, compare against
  `currentWidth + wordWidth(unit)` instead (the pending unit's trailing spaces hang → don't trigger the
  wrap). When NOT preserving, keep `unit.totalWidth` (byte-identical to today — no normal-mode
  regression). `currentWidth` accumulation in `pushUnit` is UNCHANGED (full width incl. trailing
  spaces) — prior units' trailing spaces are interior once another unit follows and must keep counting.
  The hung spaces still RENDER: `pushUnit` adds the full unit to `currentUnits`, so the space glyphs
  are emitted at their x positions (past the content edge, harmless — spaces have no ink).
- `tryHyphenSplit`'s `available = lineInlineSize − currentWidth` (~875, ~917): leave as-is for now
  (hyphenation interacts with the content edge, not trailing spaces; a preserved-space unit rarely
  hyphenates). Note in a comment that hang + hyphenation refinement is out of scope.
- Add `preservesWhitespace` usage here (already exported from Phase-1 T2).

**TDD (write FIRST — `ifc.test.ts`, explicit `white-space: pre-wrap`, 8px/char mock shaper):**
- **Hang prevents early wrap:** container inline-size = 80px (10 glyphs). Text `"aaaa      bb"` =
  `"aaaa"`(4) + 6 spaces + `"bb"`(2). Under the OLD (no-hang) decision, `"aaaa"`(32px) + 6 spaces(48px)
  = 80px fills the line, and `"bb"` wraps to line 2 → 2 lines. With the hang, the wrap decision for the
  unit carrying `"bb"`… set the numbers so the WORD content fits 1 line but total-with-trailing-spaces
  would have wrapped: choose a fixture where `wordWidth` sum ≤ width < `totalWidth` sum, and assert the
  result is ONE line (the trailing spaces hang past the edge) — i.e. fewer lines than the no-hang
  computation. (Pick exact widths so the assertion is unambiguous; assert `lines.length` AND that the
  single line's content reaches `"bb"`.)
- **Trailing spaces at the very end of a paragraph hang** (don't create a spurious extra line / don't
  change line count): `"abc        "` (8 trailing spaces) at width 40px → 1 line; the trailing spaces
  render (line owns all state offsets, `inlineOffsetEnd` = full length) but don't wrap.
- **Interior spaces still wrap normally:** `"aaaaa bbbbb ccccc"` at a width that fits two words →
  wraps at the interior space as before (interior spaces are NOT trailing — they count). Assert the
  break is unchanged from current behavior.
- **NO-REGRESSION (normal):** the same `"aaaa      bb"` under `white-space: normal` collapses the
  6-space run to one and wraps exactly as today (assert against current normal behavior — unchanged).
- **Offset correctness:** the hung trailing spaces still own their state offsets (`inlineOffsetEnd`
  covers them) and `nextLine.inlineOffsetStart === prevLine.inlineOffsetEnd` holds.

## Task 2: exclude trailing whitespace from line content width for alignment

**Files:** `packages/core/src/layout/ifc.ts` (where `textAlign` center/right/justify offsets the line
content using the line's used content width) (+ tests).

- Under `preservesWhitespace`, the line's content width used for alignment offset (center/right) and
  for justify distribution must EXCLUDE the last unit's trailing whitespace run (the hung spaces). Find
  the alignment computation (in `buildLineWithFragments` / wherever the line's content inline-size vs
  `lineInlineSize` drives the start offset) and subtract the trailing run width for preserving modes.
  Default `start`/left alignment is unaffected (offset 0) — so this task only matters for
  center/right/justify; if it proves large, it MAY split to Phase 2b, but the wrap-decision win (T1)
  ships independently.

**TDD:** a `text-align: center` (or right) line with trailing preserved spaces → the inked content is
centered/right-aligned as if the trailing spaces weren't there (assert the first glyph's x equals the
no-trailing-space centered position). Left-aligned unaffected. NO-REGRESSION for `normal`.

## TDD / no-regression notes
- The hang is GATED on `preservesWhitespace` ⇒ `normal`/`nowrap`/`pre-line` byte-identical; existing
  wrap/alignment tests for those modes unaffected.
- Test line GEOMETRY (line count, content reach, first-glyph x), not just structure.

## Out of scope (follow-ups)
- Extending the trailing-whitespace hang to `normal` mode (CSS-correct; separate change with its own
  normal-mode wrap-test blast radius).
- `break-spaces` (trailing spaces take width + can wrap) — the opposite of hang; not in the WhiteSpace
  union yet.
- Hyphenation × hang interaction refinement.

## Status
- [ ] T1 — trailing-whitespace hang in the wrap decision.
- [ ] T2 — exclude trailing whitespace from alignment content width.

## Browser-verify (user, after Phase 2)
A long line ending in many spaces no longer wraps early; center/right-aligned lines with trailing
spaces align by their inked content.
