# Preserve multiple spaces (white-space: pre-wrap for body text) — Design

**Status:** design (awaiting user spec review) · **Decided model (user, 2026-05-25):** "Preserve
spaces + wrap (Google Docs / CSS `pre-wrap`)" over `break-spaces` or leave-as-is.

## Goal
The editor's body text PRESERVES every typed space (multiple spaces show as multiple spaces, like
Google Docs / Word) while still wrapping at word boundaries. Today body text defaults to
`white-space: normal`, which collapses runs of whitespace to one rendered space (browser behavior) —
this is both the user-reported "multiple spaces show as one space" and the root cause behind the
just-fixed double-click offset drift (no collapse ⇒ no drift).

## Behavior spec (what `pre-wrap` means here — CSS Text 3 §3, matching Google Docs)
- **Preserve:** every space character renders — leading, interior runs, and trailing. No collapsing.
- **Wrap:** lines still break at word/space boundaries when content exceeds the available inline size
  (UNLIKE `pre`, which never wraps).
- **Forced breaks:** `\n` produces a hard line break (already handled via the `LINE_BREAK` sentinel).
- **Trailing-space "hang" at a soft wrap:** when a line soft-wraps, the run of preserved spaces at the
  break is rendered but is NOT counted toward the available-width decision and does not shift
  alignment/justification (CSS "hang"). This is what distinguishes `pre-wrap` from `break-spaces`
  (where trailing spaces take width and can themselves wrap). Without the hang, trailing spaces would
  force premature wrapping.
- **Out of scope here:** `break-spaces`; code-block `pre` (no-wrap, separate component); tab-stop
  expansion; bidi reordering of space runs beyond what already works.

## Architecture

### A. Editor default `white-space` (do NOT change the global CSS initial value)
`property-meta.ts` keeps the CSS-faithful initial `whiteSpace: "normal"` (a document may still
explicitly use `normal`, e.g. imported content / tests of collapse). Instead, the editor's BODY text
defaults to `pre-wrap`.

`white-space` is an INHERITED CSS property, so the preferred insertion is a single default on the
**document-root component's** default style (cascades to all body text — paragraphs, headings,
list-items, table cells). **Task-1 must verify** `whiteSpace` is wired as inherited in the cascade
(`property-meta.ts` inherit flag + `composeComputed`). If inheritance is reliable, one root default
covers everything; if not, set `whiteSpace: "pre-wrap"` on each text-bearing component's default
(`paragraph.ts`, `heading.ts`, `list-item.ts`, table cell, …). Decide in Task 1 and document the
choice. Code-block-style components that need `pre` (no wrap) set their own value (future).

### B. Tokenizer `pre-wrap` branch (`text-tokenize.ts`) — word + per-space tokens
Current `pre-wrap` branch emits each `\n`-delimited segment as ONE token ⇒ can't wrap. Rewrite it to
tokenize like `normal` but WITHOUT collapsing: split each segment into word tokens and ONE TOKEN PER
SPACE CHARACTER (no `trim`, no `split(/\s+/)` collapse), preserving leading, interior, and trailing
spaces; emit `LINE_BREAK` between `\n` segments. E.g. `"  a  b "` → `[" "," ","a"," "," ","b"," "]`.
This matches the shape the `WrapUnit` grouper + IFC consume (non-space token + slurped trailing
spaces = one breakable unit). The just-landed `Token.sourceLength` second pass is correct unchanged
(verbatim substrings ⇒ `sourceLength === text.length`; `indexOf` always matches — no fallback hit).

### C. IFC (`ifc.ts`) — leading-space rendering + trailing-space hang
1. **Leading / orphan spaces must RENDER under pre-wrap.** The wrap-unit grouper currently SKIPS
   orphan leading-space tokens (correct for `normal` where they collapse away; this is the #308
   gap). Under a preserving white-space, leading spaces at a line/paragraph start must become a
   rendered run owning their state offsets. Task 3 makes the grouper preserve leading/orphan spaces
   when `whiteSpace` preserves (pre / pre-wrap / pre-line per-line) — closing #308 for these modes.
2. **Trailing-space hang at a soft wrap.** At the wrap decision (`currentWidth + unit.totalWidth >
   lineInlineSize`), a unit's trailing preserved-space tokens must be excluded from the overflow
   comparison (use the unit's WORD-only width for the fit test) while still being rendered (full unit
   incl. spaces emitted into the line, the spaces "hanging" past the content edge). Implement by
   partitioning a unit's width into word-prefix vs trailing-space width and testing fit on the
   word-prefix. The hung spaces still advance the state-offset cursor (so caret/selection over them
   work) but don't push the next unit to a new line prematurely.

### D. Offset model — unchanged
No change. For preserved whitespace each space is a real rendered char, so `sourceLength ===
text.length` and `offsetLength === text.length`; hit-test / cursor-position / selection-geometry /
line-nav already handle one-state-char-per-space correctly.

## Phasing
- **Phase 1 (renders + wraps):** B (tokenizer) + A (editor default) + C.1 (leading-space render) +
  pin existing collapse tests to explicit `white-space: normal`. Result: multiple spaces show and the
  paragraph wraps. (Interim: trailing spaces count toward width ⇒ possible slightly-early wrap.)
- **Phase 2 (hang fidelity):** C.2 (trailing-space hang) so trailing spaces don't force early wrap and
  don't shift alignment — full Google-Docs fidelity.

## Test plan (TDD; behavior-level through render→layout, per the caret/paint/nav regression rule)
- Tokenizer: `"a  b"` (pre-wrap) → `["a"," "," ","b"]`; leading `"  a"` → `[" "," ","a"]`; trailing
  `"a  "`; `\n` → LINE_BREAK; every token `sourceLength === text.length`.
- Layout: a paragraph with a 5-space run renders 5 space advances (line inline content width reflects
  all 5); a long paragraph with interior double spaces WRAPS at word boundaries (multi-line) with the
  spaces preserved on each line; leading spaces indent the first line.
- Hang (Phase 2): a line whose content + trailing spaces exceed the width but content-alone fits keeps
  the next word on the SAME line (no early wrap); the trailing spaces render past the edge; the
  following line starts at the next word's state offset.
- Cursor/selection: caret places between each of N preserved spaces (offset i for the i-th space);
  double-click selects words across a preserved double space (the offset-drift repro now trivially
  holds since nothing collapses); selection highlight covers preserved spaces.
- **No-regression / blast radius:** the collapse tests added by the offset-drift fix
  (cursor-position "collapsed tail", hit-test "double-space drift", line-flatten "collapsed
  attribution", ifc collapse cases) PIN `white-space: normal` explicitly so they keep testing the
  still-valid collapse path. Confirm full core + dom green; the example seed has no multi-space runs
  so it's visually unchanged except where the user types spaces.

## Closes / relates
- Directly fixes "multiple spaces show as one space."
- Subsumes #308 (leading/all-whitespace offset gap) for preserving white-space modes via C.1.
- Built on the source-offset model from the collapsed-whitespace fix (979f69d).

## Browser-verify (user, after each phase)
Type multiple spaces (leading, interior, trailing); they render; the paragraph still wraps; caret and
double-click land correctly among them. Phase 2: a long line with trailing spaces doesn't wrap early.
