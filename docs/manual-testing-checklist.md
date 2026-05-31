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

- **Bug B (CRASH, critical):** inserting a 2nd footnote with the caret just after
  the 1st marker crashes. → 🔧 investigating root cause.
- **Bug A (caret):** clicking after a marker puts the caret before it (the
  inline-block marker's 1-unit offset is mis-resolved). Likely same root cause as B.
  → 🔧
- **Bug D (render):** a long footnote body only shows its first line in the slot;
  the rest doesn't render (so splitting can't be observed either). → 🔧
- **Bug C (render):** the footnote body in the slot has no leading number, so you
  can't tell which footnote a body belongs to. The number IS computed; it just
  isn't reaching the slot's painted box. → 🔧

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
