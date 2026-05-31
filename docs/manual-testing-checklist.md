# Manual (browser) testing checklist — footnotes

This is the running list of what to verify **in your own browser** (`npm run dev
--workspace=examples/react`). Tests asserting structure pass; only the browser
exercises real coordinates/pixels/crashes. Update the status column with your
findings and I'll act on them.

> Convention: ✅ works · ❌ broken (with note) · ⏳ awaiting your test · 🔧 I'm
> fixing · 🔁 re-test after a fix landed.

> ## ⚠️ DO THIS FIRST before Round 2: **hard-restart the dev server**
> Stop and restart `npm run dev --workspace=examples/react` (a full restart, not
> just a page refresh). You tested Round 1 against a dev server that was running
> while I committed 12+ footnote changes. **Vite HMR silently misses module-init
> singleton changes** (the component registry, attr registry, EditorConfig
> defaults) — so the browser can keep running stale code even though the source is
> fixed. This is a known gotcha in this project. Bug D in particular is **provably
> correct in the engine** (see below), so a stale HMR module is the leading
> explanation. A restart may clear D — and possibly B — outright.

---

## Round 1 — your results (2026-05-31, night)

| # | Behavior | Status |
|---|----------|--------|
| 1 | Insert footnote → superscript marker at caret + slot at page bottom | ✅ |
| 2 | Type into the footnote body → text appears in the slot | ✅ |
| 3 | Footnote body in the slot shows a **leading number** (which footnote it is) | ❌ **no leading number** — Bug C |
| 4 | Insert a 2nd footnote *earlier* → markers renumber 1,2 and slots reorder | ✅ |
| 5 | Click **into** a footnote body in the slot → caret lands there | ✅ |
| 6 | Backspace over a marker → marker **and** slot vanish; other renumbers | ✅ |
| 7 | Long footnote → body renders all lines (then splits across pages) | ❌ **only first line renders** — Bug D |
| — | Click **after** a marker in body text → caret lands AFTER it | ❌ lands **before** — Bug A |
| — | Insert 2nd footnote with caret just after the 1st marker | ❌ **CRASH** — Bug B |

## Bugs found (Round 1) → fix status

- **Bug A (caret):** ✅ **FIXED** (commit 60742b9). Hit-test hardcoded the
  inline-block caret to the leading edge; now splits at the box midpoint so the
  caret can land *after* the marker. → 🔁 re-test in Round 2.
- **Bug B (CRASH, critical):** ⏳ NOT reproducible in 345 core/dom unit tests at
  any marker adjacency — the crash is in the browser-only canvas/controller layer.
  The Bug A offset fix may clear it (a wrong offset was plausible kindling). →
  🔁 **please re-test first** (insert footnote, click just right of its marker so
  the caret is AFTER it, insert a 2nd). If it still crashes, I'll instrument the
  DOM controller path directly (I can't run the browser).
- **Bug C (render):** ✅ **FIXED** (commit 6ec2251). The slot now emits the body root's number-marker (materialize-side only; FN-5 split path untouched; number only on the page where the footnote starts, not on continuation tails). → 🔁 re-test in Round 2 (confirm a "1/2/…" shows before each footnote body in the slot).
- **Bug D (render):** ⏳ **provably correct in the engine — most likely stale HMR.**
  I drove the REAL incremental edit path (`reduceEditor`: insert footnote → type a
  long body char-by-char, paginated config) and the slot grows correctly: 1→2→3
  lines as you type; a 120-word body → 21 lines; all lines materialize AND paint
  (the canvas walks every slot child). Both layout reuse-gates correctly invalidate
  the footnote page when the body content changes. So the engine is right.
  → **Re-test after the hard dev-server restart above.** If it STILL shows one line
  after a clean restart, tell me:
  (a) is it ONE long line running off the edge (a long *unbroken* word with no
  spaces legitimately doesn't wrap — type spaced prose to check), or wrapped lines
  where only line 1 shows?
  (b) does it happen on an empty page or a nearly-full page?
  Then the remaining suspect is the real CanvasShaper's text metrics differing from
  layout — I'd instrument the live `getPage(slotPage).footnoteSlot` line count vs
  the layout's `footnoteSlotHeight` to isolate it.

Every fix lands a regression test (first principle 8) so these can't silently
recur.

---

## Round 2 — to test after the fixes land (⏳)

(Will be filled in as fixes commit. Anticipated:)

- 🔁 Bug A: click immediately after a footnote marker → caret sits *after* it;
  arrow-left/right step across the marker correctly (one stop).
- 🔁 Bug B: insert footnote, put caret right after its marker, insert another →
  no crash; both markers number 1,2.
- 🔁 Bug C: each footnote body in the slot shows its number (e.g. "1", "2").
- 🔁 **Body-number renumber (render-audit fix, 9c414bd):** with ≥2 footnotes,
  insert a NEW footnote *before* an existing one → the existing footnote's
  **body slot number** must update too (not just its superscript call marker).
  Before the fix the call marker renumbered but the body slot kept the old number.
- 🔁 Bug D: type a multi-paragraph / many-line footnote → the whole body renders
  in the slot (slot grows); type enough to overflow the page → it splits and
  continues on the next page.
- ⏳ Insert footnote inside a footnote body → refused (no nested footnotes).
- ⏳ Undo/redo across footnote insert/delete restores both marker + body + caret.

## Now testable — footnote numbering policy (FN-6 complete)

The toolbar now has a small **"FN: …" dropdown** (continuous / per section / per
page). Round 2:
- ⏳ Make a multi-page doc with footnotes on ≥2 pages → pick **"FN: per page"** in
  the dropdown → each page's footnotes restart at **1** (page 2's first footnote
  shows "1", not its continuous number). Pick **continuous** again → back to 1,2,3…
- ⏳ Pick **"FN: per section"** with a section break between footnotes → numbering
  restarts at each section.
- (Number *format* — roman/alpha — has an action but no toolbar control yet; lower
  priority.)

## Visual polish deferred (engine correct, styling TBD in-browser)

- The footnote body's leading number (Bug C fix) renders as a plain marker at the
  start of the body; Google Docs shows it as a small superscript. Once you confirm
  the number *appears* (Round 2), I'll refine the superscript styling + exact
  spacing — that's a pixel-tuning pass best done against your browser.
