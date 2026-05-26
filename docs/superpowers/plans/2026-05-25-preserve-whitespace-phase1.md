# Preserve whitespace — Phase 1 (renders + wraps) Implementation Plan

> **For agentic workers:** subagent-driven-development; one implementer per task; independent
> code-reviewer gate before each commit; TDD with behavior-level layout/cursor tests through the real
> render→layout pipeline. Spec: `docs/superpowers/specs/2026-05-25-preserve-whitespace-pre-wrap-design.md`.

**Goal (Phase 1):** the editor's body text PRESERVES every space (leading, interior runs, trailing)
and a multi-space paragraph still WRAPS at word boundaries. (Phase 2 — trailing-space "hang" at a soft
wrap — is a separate plan.) `white-space: normal` stays the global CSS initial value and the
still-supported collapse mode; only the editor's body default becomes `pre-wrap`.

**Key facts (verified):** `whiteSpace` is an inherited property (`property-meta.ts:57
{ inherits: true }`), so one default on the document-root component cascades to all body text. Single-
space text under `pre-wrap` tokenizes identically to `normal` (one space token), so only MULTI-space
fixtures change. The offset model (`Token.sourceLength` / `TextRunBox.offsetLength`, committed
979f69d) needs NO change: preserved spaces are verbatim chars ⇒ `sourceLength === text.length`.

**Build order:** Task 1 (tokenizer) → Task 2 (leading-space render) → Task 3 (flip default + pin
collapse tests). The default flip is LAST so the tokenizer + leading-space support exist before any
paragraph actually renders in pre-wrap.

---

## Task 1: `pre-wrap` tokenizer → word + per-space tokens (no collapse)

**File:** `packages/core/src/layout/text-tokenize.ts` (the `case "pre-wrap":` branch, ~lines 64-72)
(+ test `text-tokenize.test.ts`).

The current `pre-wrap` branch emits each `\n`-segment as ONE token (can't wrap). Rewrite it to split
each `\n`-delimited segment into word tokens and ONE token per space character — preserving leading,
interior, and trailing spaces — and emit `LINE_BREAK` between segments. Single space ⇒ same shape as
`normal` (`["a"," ","b"]`); double space ⇒ `["a"," "," ","b"]`; leading ⇒ `["  a"` → `[" "," ","a"]`.

- `LINE_BREAK` (text-tokenize.ts:4) is the forced-break sentinel (a DISTINCT codepoint, not U+0020) —
  use the constant; do NOT emit a literal `" "` for `\n`.
- Implementation: for each segment, walk chars accumulating maximal non-space runs (word tokens) and
  emitting each whitespace char as its own `" "` token (preserve the actual char? — Phase 1 emits a
  normalized `" "` per whitespace char to match the existing token contract; tab-width/NBSP fidelity
  is out of scope). Empty segments (e.g. leading `\n`) emit no word token, just the surrounding
  `LINE_BREAK`s.

- [ ] **Step 1 — failing tests** (`text-tokenize.test.ts`): `tokenize("a  b", "pre-wrap")` →
  `["a"," "," ","b"]`; `tokenize("  a", "pre-wrap")` → `[" "," ","a"]`; `tokenize("a  ", "pre-wrap")` →
  `["a"," "," "]`; `tokenize("a\nb", "pre-wrap")` → `["a", LINE_BREAK, "b"]`; `tokenize("a b",
  "pre-wrap")` → `["a"," ","b"]` (single-space parity with normal). Import `LINE_BREAK` from the module.
- [ ] **Step 2** run → fail (current stub returns `["a  b"]` etc.).
- [ ] **Step 3** rewrite the branch.
- [ ] **Step 4** run → pass; full `npm test --workspace=packages/core -- --run text-tokenize` green.
- Reviewer gate, then commit.

## Task 2: IFC renders leading / orphan spaces under preserving white-space (C.1, closes #308 for these modes)

**Files:** `packages/core/src/layout/ifc.ts` (the wrap-unit grouper that currently SKIPS orphan leading-
space tokens — the implementer must locate it; the prior explore cited a `if (tok.isSpace) { /* orphan
leading space — skip */ i++; continue; }` branch) (+ tests in `ifc.test.ts`).

Today the grouper drops orphan/leading space tokens (correct for `normal`, where they collapse away —
this is the #308 gap). Under a PRESERVING white-space (`pre`/`pre-wrap`, and per-line for `pre-line`),
leading/orphan spaces must become a rendered space-run wrap unit that OWNS its state offsets (so the
line's `inlineOffsetStart..End` covers them and the caret can sit among them).

- Gate the change on whether the active `whiteSpace` preserves whitespace (derive from the token's /
  parent's `computedStyle.whiteSpace`; add a small helper `preservesWhitespace(ws)` = ws is `pre` /
  `pre-wrap` / `break-spaces` — NOT `normal`/`nowrap`/`pre-line`-collapsed-interior). For preserving
  modes, emit leading/orphan space tokens as a standalone space-run `WrapUnit` (rendered, breakable
  after) instead of skipping. Keep the skip for `normal`/`nowrap` (unchanged behavior).
- The space-run unit's `sourceLength`/`offsetLength` already flow from Task-1's tokens (each space = 1
  state char). Verify the line offset accumulator includes them.

- [ ] **Step 1 — failing tests** (`ifc.test.ts`, explicit `white-space: pre-wrap` in the cascaded
  fixture, NOT relying on the default): a paragraph `"  abc"` lays out with a leading 2-space run
  rendered before `"abc"` (first text-run/space-run starts at inline offset 0, line `inlineOffsetEnd`
  === 5); a paragraph that is ONLY spaces `"   "` renders a 3-space line with `inlineOffsetEnd === 3`.
- [ ] **Step 2** run → fail (leading spaces dropped today).
- [ ] **Step 3** implement the preserving-mode leading/orphan-space unit.
- [ ] **Step 4** run → pass; full core suite green (the `normal` orphan-skip path unchanged ⇒ existing
  tests unaffected).
- Reviewer gate, then commit.

## Task 3: flip the editor body default to `pre-wrap` + pin collapse tests to explicit `normal`

**Files:** `packages/core/src/components/document.ts` (add `whiteSpace: "pre-wrap"` to the root
ElementBox style); the collapse tests that currently rely on the default `normal`:
`packages/core/src/cursor/hit-test.test.ts`, `cursor-position.test.ts`, `line-flatten.test.ts`, and any
`ifc.test.ts` collapse cases — set `white-space: "normal"` EXPLICITLY in those fixtures so they keep
testing the still-valid collapse path.

- `document.ts`: `createElementBox(view.id, { display: "block", whiteSpace: "pre-wrap" }, childRenderNodes)`.
  Confirm via the cascade that descendants inherit it (whiteSpace `inherits: true`).
- Sweep the multi-space collapse tests: any test that builds text with multiple spaces through the
  render pipeline AND asserts collapse now needs the paragraph/doc fixture to set `white-space: normal`
  explicitly (the offset-drift fix's tests: hit-test "double-space drift", cursor-position "collapsed
  tail", line-flatten "collapsed attribution"). Pin them; their assertions stay byte-identical under
  explicit `normal`.

- [ ] **Step 1 — failing test** (`hit-test.test.ts` or a new integration test, default doc — NO
  explicit white-space): render `"a  b"` through the default pipeline; assert BOTH spaces render (e.g.
  `selectWord` on `b` returns `b`'s span, and the line content width reflects 2 spaces, not 1). This
  fails today (collapse) and after the default flip passes.
- [ ] **Step 2** run → fail.
- [ ] **Step 3** add `whiteSpace: "pre-wrap"` to `document.ts`; run the FULL core + dom suites; pin
  every now-failing collapse test to explicit `white-space: "normal"` (these failures are EXPECTED —
  the default changed; the fix is to pin the fixture, not to revert). Report each pinned test.
- [ ] **Step 4** full `npm test --workspace=packages/core` + `npm test --workspace=packages/dom` green;
  `npm run build --workspace=packages/core` clean; `examples/react` builds.
- Reviewer gate, then commit.

## TDD / no-regression notes
- Single-space and no-space text is byte-identical (pre-wrap single space === normal single space).
- The collapse path stays fully tested via the pinned-`normal` fixtures (don't delete those tests).
- Geometry assertions (line content width reflects N spaces; leading-space indent) — not just token
  counts — per the project's "test geometry, not structure" rule.

## Out of scope (Phase 2 / later)
- Trailing-space "hang" at a soft wrap (Phase 2 plan): trailing spaces currently still count toward the
  wrap-width decision, so a long line with many trailing spaces may wrap slightly early. Acceptable
  interim; full fidelity in Phase 2.
- `break-spaces`, code-block `pre`, tab-stop expansion, NBSP/tab width fidelity.

## Status
- [ ] T1 — pre-wrap tokenizer (word + per-space).
- [ ] T2 — IFC leading/orphan-space render under preserving modes.
- [ ] T3 — flip editor default + pin collapse tests.

## Browser-verify (user, after Phase 1)
Type leading spaces, interior multiple spaces, trailing spaces; all render; the paragraph still wraps;
caret + double-click land correctly among the spaces. (A long line with many trailing spaces wrapping
slightly early is the known Phase-2 item.)
