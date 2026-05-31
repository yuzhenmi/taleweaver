# Manual (browser) testing checklist — footnotes

This is the running list of what to verify **in your own browser** (`npm run dev
--workspace=examples/react`). Tests asserting structure pass; only the browser
exercises real coordinates/pixels/crashes. Update the status column with your
findings and I'll act on them.

> Convention: ✅ works · ❌ broken (with note) · ⏳ awaiting your test · 🔧 I'm
> fixing · 🔁 re-test after a fix landed.

> 💡 **The toolbar now reflects your cursor.** All the formatting controls
> (font/size/spacing/color selects + the bold/italic/etc. toggles) should show
> the ACTIVE formatting at the cursor — move the caret through differently-styled
> text and watch the toolbar update; a selection spanning mixed values shows the
> control blank. This makes verifying every formatting feature below much easier.

> ## 🧭 Design decisions needing your input (non-blocking)
> I hit genuine forks the first principles + codebase don't settle, so I'm
> surfacing them per the coordination protocol instead of guessing:
>
> 0. **Find & Replace** (Ctrl+F / Ctrl+H) — the single biggest remaining gap. I
>    wrote a **design brief** while you slept so the morning is "read → decide → I
>    build," not a from-scratch brainstorm:
>    `docs/superpowers/specs/2026-05-31-find-and-replace-design-brief.md`. It's
>    grounded in existing APIs (extractText for search, replaceRange for replace,
>    the selection-overlay for highlights) and mostly unit-testable pure functions
>    — low risk. **Two open questions** for you: (D1) regex in the first cut or
>    phase it after plain find? (D8) search only the main body first, or also
>    headers/footers/footnotes/embeds? The rest has proposed defaults you can
>    rubber-stamp. The search primitive (slice 1) is forkless — buildable
>    immediately regardless.
>
> 1. **Superscript / subscript** (Format ▸ Superscript, Ctrl+. / Ctrl+,) — the
>    next inline-format feature. The *render* foundation exists (`vertical-align:
>    super/sub` already raises/lowers). The catch: Google-Docs superscript is also
>    **smaller** (≈0.75× font), and that scale must compose *multiplicatively* with
>    a custom font-size (superscript of 20px text → 15px, not 0.75em-of-the-block).
>    In our flat per-item attr model a plain `font-size: 0.75em` interpreter can't
>    express that (em resolves against the parent, and it collides with an explicit
>    `fontSize` attr); the clean fix is a small **new ComputedStyle scale notion**
>    tied to the superscript/subscript command (NOT to `vertical-align`, since
>    footnote markers already set both and would double-scale). That's a
>    cross-cutting cascade change → I want your ✅ before building it, rather than
>    ship a superscript that breaks on custom font sizes. **Default I'd take:** add
>    `ComputedStyle.fontScale` (1 by default), resolved in used-style as
>    `fontScale × resolvedFontSize`; super/sub set it to 0.75. OK?
> 2. **Embedded-in-a-scroll-`<div>` editor** — the IntersectionObserver canvas pool
>    is built against the viewport, not a non-window scroll parent. The React
>    example scrolls the *window*, so this is correct today. Fixing it (pass
>    `root: scrollParent`) only matters if you intend to embed the editor inside a
>    scrollable container. **In scope?** If yes I'll fix + test it; if not I'll
>    leave a note and move on.
>
> (Neither blocks the typography/footnote testing below.)

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
- **Bug B (CRASH, critical):** ⏳ **DOM-audit (2026-05-31) could not reproduce it
  through ANY controller path** — state op, caret-resolve, materialize, paint,
  click hit-test, selection all clean. **Leading conclusion: already fixed by the
  Bug-A commit (60742b9)** — the crash was reported BEFORE that fix, back when an
  inline-block click hardcoded offset 0 (so "click right of the marker" resolved
  to a wrong offset). → 🔁 **re-test** (insert footnote, click just right of its
  marker, insert a 2nd). If it STILL crashes, the one thing I need is the **live
  console error + stack trace** — every code path I can drive is clean, so a real
  stack is required to localize it (likely a React-render or IME/textarea path
  none of my probes touch).
- **Bug C (render):** ✅ **FIXED** (commit 6ec2251). The slot now emits the body root's number-marker (materialize-side only; FN-5 split path untouched; number only on the page where the footnote starts, not on continuation tails). → 🔁 re-test in Round 2 (confirm a "1/2/…" shows before each footnote body in the slot).
- **Bug D (render):** ⏳ **engine AND DOM paint both proven correct — most likely
  stale HMR or an unbroken word.** Beyond the earlier engine proof, the DOM audit
  (2026-05-31) drove the REAL `paintPage` + paint-cache with a 5-line slot: all 5
  lines paint at distinct y's and the dirty rects cover the grown slot. So the
  whole chain (layout → getPage → paint) is correct end to end. Two real-world
  suspects remain: (1) **stale Vite HMR** (you tested across 12+ commits on a
  long-running server) — the hard restart is the fix; (2) **a long *unbroken* word
  legitimately not wrapping** (the shaper breaks only on whitespace, no UAX-14).
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
- 🔁 **Footnote separator rule (NEW — commit 6af5a9b):** a thin short rule should
  now appear ABOVE the footnotes at the page bottom (Google Docs draws this; it
  was previously missing entirely). Confirm it appears; colour (`#000`) and length
  (~1.5in) are first-pass defaults I'll tune to match Docs once you see it.

## P5 Typography (NEW this session — testable)

- 🔁 **Strikethrough (P5.3):** select text → **Ctrl+Shift+X** OR the new
  Strikethrough toolbar button → a line through the text. Re-apply to remove. The
  toolbar button should HIGHLIGHT when the selection is struck. (Strike y-position
  is browser-tunable.) Note: underline + strikethrough can't currently combine
  (single-value limitation, tracked) — that's expected for now.
- 🔁 **Bonus bug fixes found while building strikethrough:** (a) **Ctrl+Shift+Z
  REDO** now works (it was silently dead in-browser — a key-casing bug); confirm
  redo via Ctrl+Shift+Z. (b) The **Bold/Italic/Underline toolbar buttons now
  HIGHLIGHT** when the selection has that style (their pressed-state was dead).
- 🔁 **Text color (NEW):** select text → the new color-swatch control in the
  toolbar (native color picker) → text repaints in that color. The **reset button**
  (Ban/⦸ icon next to it) clears back to default. Whole chain is real (attr →
  cascade → glyph paint); pick a few colors and confirm they apply to exactly the
  selection.
- 🔁 **Highlight color (NEW):** select text → the Highlighter-icon control →
  text gets a background-color block behind it (the glyphs stay their own color).
  Reset button clears it. Known limitation: selecting *highlighted* text won't
  show the blue selection tint over the highlight (the highlight is opaque — same
  as block backgrounds; a selection-compositing follow-up is tracked). The caret
  stays visible.
- ⭐🔁 **Indent / outdent (NEW — HIGH-PRIORITY browser check):** put the cursor in
  a paragraph → the **Increase-indent** toolbar button → the whole paragraph
  shifts RIGHT by ~48px (half inch). Press it again → shifts further. **Decrease
  indent** steps it back, stopping at the left margin (never past it). This is the
  FIRST feature that exercises the new BFC inline-margin code path (all prior
  content had zero margins), so please confirm the geometry looks right — text
  reflows into the narrower width, cursor/clicks land correctly in the indented
  paragraph, and multi-paragraph selections each indent. (Tab-to-indent isn't
  wired yet — use the toolbar buttons.)
- 🔁 **Heading + list keyboard shortcuts (NEW):** Ctrl/Cmd+Alt+**0** = normal
  text, +**1..6** = Heading 1–6; Ctrl/Cmd+Shift+**7** = numbered list, +**8** =
  bulleted list. (Matched by physical key, so they work regardless of keyboard
  layout. On intl Windows layouts Ctrl+Alt is AltGr — Google Docs hijacks these
  for headings too; confirm the editor wins.)
- 🔁 **Alignment keyboard shortcuts (NEW):** Ctrl/Cmd+Shift+**L** (left), +**E**
  (center), +**R** (right), +**J** (justify) align the current paragraph(s) —
  the standard Google Docs chords. (Note: Ctrl+Shift+R is normally browser
  hard-reload and Ctrl+Shift+J opens DevTools — Google Docs overrides these too;
  confirm the editor intercepts them rather than the browser. If the browser
  wins, that's a preventDefault gap to flag.)
- 🔁 **Paragraph spacing (NEW):** the toolbar "Before"/"After" selects add space
  above/below the selected paragraph(s). NOTE (by design): spacing **collapses**
  per CSS — if para A has "after: 40" and para B has "before: 20", the gap is 40
  (the larger), NOT 60 (sum). Google Docs *adds* them; we follow the CSS/browser
  convention here (it's a layout question). Flag if you'd rather have the
  Google-Docs additive behavior — it'd be a deliberate non-collapsing mode.
- 🔁 **Line spacing (NEW):** put the cursor in (or select) a paragraph → the
  line-spacing `<select>` (1.0/1.15/1.5/2.0) near the alignment buttons → the
  paragraph's lines space out / tighten (the page reflows). Works on headings and
  list items too (scales to their font size). First block-paragraph feature beyond
  alignment.
- 🔁 **Font size + font family (NEW):** select text → the two `<select>`
  dropdowns in the toolbar (size: 10–64px; family: Arial/Times/Courier/…). Size
  should **reflow** (bigger text → taller line, wrapping shifts); family should
  change the glyph shapes. Confirm both apply to exactly the selection and that a
  larger size in the middle of a line grows that whole line (baseline-aligned).
- (text-indent (P5.1) also shipped but has no toolbar control yet, so it's not
  directly testable without seeding `text-indent` in a doc — UI exposure is a
  follow-up.)

**Inline-format toolbar is now ~feature-complete vs Google Docs:** Bold, Italic,
Underline, Strikethrough, Text color, Highlight, Font family, Font size, Link.
Remaining: Superscript/Subscript (awaiting your fontScale decision above).
- 🔁 **Clear formatting (NEW — Ctrl+\ or the RemoveFormatting toolbar button):**
  select text that has bold/color/font-size/highlight/link/etc. → all inline
  character formatting is stripped in one go (one **undo** brings it all back).
  Scope is character formatting only — it does NOT reset heading/alignment (open
  question: should Google-Docs Ctrl+\ also reset those? your call).
