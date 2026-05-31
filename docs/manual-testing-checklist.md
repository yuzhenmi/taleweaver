# Manual (browser) testing checklist — footnotes

This is the running list of what to verify **in your own browser** (`npm run dev
--workspace=examples/react`). Tests asserting structure pass; only the browser
exercises real coordinates/pixels/crashes. Update the status column with your
findings and I'll act on them.

> Convention: ✅ works · ❌ broken (with note) · ⏳ awaiting your test · 🔧 I'm
> fixing · 🔁 re-test after a fix landed.

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
- **Bug D (render):** ⏳ **NOT reproducible in any unit test** — a 5-line footnote
  body materializes AND paints all 5 lines correctly; the canvas paint recurses
  every slot child. So D is some real-app input the harness can't see. **Please
  help me pin it when you re-test** — tell me:
  (a) is it ONE long line running off the edge (no wrapping), or wrapped lines
  where only line 1 shows?
  (b) does it happen on an otherwise-empty page, or a nearly-full page?
  (c) does the rest appear if you scroll / resize / click away and back?
  That detail will localize it (candidates: body paragraph not wrapping in the
  slot width, or stale incremental reuse of the embed-body layout while typing).

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
- 🔁 Bug D: type a multi-paragraph / many-line footnote → the whole body renders
  in the slot (slot grows); type enough to overflow the page → it splits and
  continues on the next page.
- ⏳ Insert footnote inside a footnote body → refused (no nested footnotes).
- ⏳ Undo/redo across footnote insert/delete restores both marker + body + caret.

## Not yet user-testable (no UI yet)

- restart-per-page numbering (FN-6.4) works in the engine but has no toolbar
  control to *select* the policy — you'll see continuous numbering until that UI
  lands. (Tracked.)
