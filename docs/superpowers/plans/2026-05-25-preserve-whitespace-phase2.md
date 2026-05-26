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

## Mechanism (CORRECTED + verified against CSS — plan-review of 2026-05-25 got this wrong; recorded so it isn't re-litigated)

The wrap test changes ONLY the INCOMING unit's term: `currentWidth + wordWidth(unit)` (not
`+ unit.totalWidth`), where `wordWidth(unit) = unit.totalWidth − unit.trailingWhitespaceWidth`.
`currentWidth` stays FULL (pushUnit unchanged). Rationale, with the two discriminating cases (8px/char):

- `"ab cd   "` @ 40px (the early-wrap the hang FIXES): unit1=`"ab "`(24, word16/trail8), unit2=`"cd"`+3sp
  (40, word16/trail24). After pushing unit1 (cW=24), test unit2: `24 + wordWidth(16) = 40 ≤ 40` ⇒ NO
  wrap. `"ab cd"`(40) fits; the 3 trailing spaces HANG. **1 line.** (OLD: `24+40=64>40` ⇒ 2 lines.)
- `"aaaa   bb"` @ 56px (the over-hang we must NOT do): unit1=`"aaaa"`+3sp(56, word32/trail24),
  unit2=`"bb"`(16, word16/trail0). After pushing unit1 (cW=56), test unit2: `56 + wordWidth(16) = 72 >
  56` ⇒ WRAP. **2 lines** — CORRECT, because the 3 spaces are now BETWEEN `aaaa` and `bb` (INTERIOR)
  so they count. `currentWidth` must stay full to preserve this.

**REJECTED alternative (the plan-review's proposed "fix"):** subtracting the PRIOR unit's
`trailingWhitespaceWidth` from `currentWidth` in the test (`(currentWidth − lastTrailing) + wordWidth`)
is WRONG — it would give `(56−24)+16 = 48 ≤ 56` for `"aaaa   bb"` ⇒ 1 line, dropping the now-interior
spaces. Prior trailing spaces become interior the instant a worded unit follows, so they MUST keep
counting (they're already in `currentWidth`). Only the INCOMING unit's trailing spaces hang.

## Task 1: trailing-whitespace hang in the wrap DECISION (the user-visible win — Phase 2 ships this)

**Files:** `packages/core/src/layout/ifc.ts` (`WrapUnit` + the unit builders + the 3 wrap-decision
sites + the float-loop inner check) (+ tests `ifc.test.ts`).

- **`WrapUnit` gains a REQUIRED `readonly trailingWhitespaceWidth: number`** (NOT optional — a missing
  construction site must be a COMPILE error, else `undefined` → `NaN` silently disables the hang) =
  the summed width of the maximal trailing run of `isSpace` tokens at the END of `unit.tokens` (0 if it
  ends in a non-space). For a standalone all-space unit it is the whole width ⇒ `wordWidth = 0` (see
  I1 below — that's correct). Set it at EVERY construction site: the main grouper word-unit (slurped
  trailing spaces), the Phase-1 leading/orphan space-run unit (whole width), the LINE_BREAK unit (0),
  and BOTH `tryHyphenSplit` outputs (prefix: 0 — ends at the break; suffix: its own trailing run).
- **The wrap-decision comparisons.** When `preservesWhitespace(parentCs.whiteSpace)`, replace
  `unit.totalWidth` with `wordWidth(unit)` in the overflow test at ALL of: ~873 (line has units),
  ~900 (empty line + float-push OUTER check), ~916 (empty line + hyphen), **AND the float-loop INNER
  check at ~908 (`lineInlineSize >= unit.totalWidth`)** → `>= wordWidth(unit)` (I2: else the loop
  over-advances past floats when only the trailing spaces overflow). When NOT preserving, keep
  `unit.totalWidth` everywhere (byte-identical to today — no normal-mode regression). `currentWidth`
  accumulation in `pushUnit` is UNCHANGED. The hung spaces still RENDER (pushUnit adds the full unit to
  `currentUnits`; the space glyphs paint past the content edge — no ink, harmless).
- **I1 — standalone interior space-runs.** A space-run can be INTERIOR (not only leading): with inline
  spans of different `sourceKey`, spaces from a different source node than the preceding word become a
  standalone space-run unit mid-line. Such a unit has `wordWidth = 0`, so the test `currentWidth + 0 ≤
  lineInlineSize` always accepts it onto the current line (when the line isn't already over) — which is
  the correct CSS outcome (the spaces hang/flow). No special case; just confirm a test covers it.
- `tryHyphenSplit`'s `available = lineInlineSize − currentWidth` (~875, ~917): leave as-is; add a
  comment that hang × hyphenation refinement is out of scope (a preserved-space unit rarely hyphenates).
- `preservesWhitespace` is exported from Phase-1 T2; `parentCs` is in scope at the wrap sites (confirm).

**TDD (write FIRST — `ifc.test.ts`, explicit `white-space: pre-wrap`, 8px/char mock shaper):**
- **Hang prevents early wrap (DISCRIMINATING):** `"ab cd   "` @ 40px ⇒ **1 line** (`"ab cd"` fits,
  3 trailing spaces hang). Assert `lines.length === 1` AND the line reaches `"cd"`. (Confirm the
  pre-change code gives 2 lines — capture that the fixture actually distinguishes old vs new.)
- **Interior spaces still wrap (NO over-hang):** `"aaaa   bb"` @ 56px ⇒ **2 lines** (the spaces are
  interior between `aaaa` and `bb` — they count). Assert `lines.length === 2`. This guards against the
  rejected over-correction.
- **Trailing spaces at paragraph end hang:** `"abc        "` (8 trailing) @ 40px ⇒ 1 line; the line
  OWNS all state offsets (`inlineOffsetEnd` = full length) but doesn't wrap.
- **NO-REGRESSION (normal):** `"ab cd   "` under `white-space: normal` wraps exactly as today (collapse
  ⇒ unchanged). Assert against current normal behavior.
- **Offset correctness:** hung trailing spaces own their state offsets; `nextLine.inlineOffsetStart ===
  prevLine.inlineOffsetEnd` holds across a wrap.
- **I1 case:** an interior cross-`sourceKey` space-run lays out on the same line as its neighbors (no
  spurious wrap) — if the inline-span fixture is awkward in `ifc.test.ts`, a unit-level assertion on the
  grouper output (space-run unit has `wordWidth 0`) plus a note is acceptable.

## TDD / no-regression notes
- The hang is GATED on `preservesWhitespace` ⇒ `normal`/`nowrap`/`pre-line` byte-identical; existing
  wrap/alignment tests for those modes unaffected.
- Test line GEOMETRY (line count, content reach, first-glyph x), not just structure.

## Out of scope (follow-ups)
- **Alignment hang (was Task 2) — DESCOPED.** Plan-review I3 (confirmed): `textAlign`
  center/right/justify is NOT implemented anywhere in the layout/paint pipeline (`buildLineWithFragments`
  always lays children from inline-offset 0; `textAlign` lives in Used/Computed style but is never
  consulted). So "exclude trailing whitespace from the alignment content width" has no alignment
  computation to modify — it requires first implementing `textAlign` generically, which is separate,
  larger work. Tracked as a follow-up (#312). Default `start`/left alignment (the only mode today) is
  unaffected by trailing-space hang, so Phase 2 = Task 1 alone fully delivers the user-visible fix.
- Extending the trailing-whitespace hang to `normal` mode (CSS-correct; separate change with its own
  normal-mode wrap-test blast radius).
- `break-spaces` (trailing spaces take width + can wrap) — the opposite of hang; not in the WhiteSpace
  union yet.
- Hyphenation × hang interaction refinement.

## Status — PHASE 2 COMPLETE (browser-verify owed)
- [x] T1 — trailing-whitespace hang in the wrap decision (incl. float-loop inner check). Commit `84ba1b5`.
  **This is all of Phase 2** (Task 2 / alignment hang descoped to follow-up #312 — textAlign isn't
  implemented in layout/paint). Reviewer-approved (mechanism CSS-verified twice); full core 1672 green;
  normal/nowrap/pre-line byte-identical.

## Browser-verify (user, after Phase 2)
A long line ending in many spaces no longer wraps early (trailing spaces hang past the content edge).
