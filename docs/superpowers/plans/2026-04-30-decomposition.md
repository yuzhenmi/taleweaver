# Decomposition — closing the gap to target architecture

Maps `docs/architecture/state-of-branch.md` to a set of bounded pieces.
Each piece ships independently, has a clean interface to its
neighbors, and implements a specific section of the target-architecture
docs. Order is by dependency; within an unordered batch, pick by
user-visible value.

This doc is roadmap, not architecture — lives in
`docs/superpowers/plans/`. The architecture docs are the spec each
piece implements against.

---

## Pieces

### P1 — Pagination

Implements [`docs/architecture/1-core/1.5-pagination.md`](../../architecture/1-core/1.5-pagination.md).

Ships: `PageBox` type added to the LayoutBox union; `paginateRoot` fragmenter walks a layout tree and emits a sequence of `PageBox`es; whole-block placement first, then within-block fragmentation at line boundaries with widows/orphans + break rules; page templates with headers/footers; footnote slot. Also restores the `EditorConfig.pageConfig` field and wires `editor-controller.ts`'s dormant per-page-canvas path. Schema additions: `widows`, `orphans` consumers wired (already in schema).

Depends on: nothing.

Closes: F3K.A (canvas overflow at ~800 paragraphs), F3K.D (1000p tab freeze, hypothesized canvas-buffer cause), F1.F8.x (`pageHeight`/`pageMargins`/`pageGap` removed in Plan 1), missing-pagination regression vs main.

Out of scope for P1: incremental pagination (whole-doc repagination on any change is acceptable until profiling says otherwise); generated content's `target-counter()` two-pass resolution (lands with P14).

### P2 — Inline-block shrink-to-fit clamping

Implements the auto-inline-size path in `ifc.ts` per CSS Sizing 3 §10.3.5: `min(maxContent, max(minContent, available))`. Currently uses `maxContent` raw.

Depends on: nothing.

Closes: F3J.1.

Tiny piece; could be folded into another but kept separate to land cleanly.

### P3 — Vertical writing-mode

Implements vertical-rl / vertical-lr arithmetic in `logicalToPhysical`; consumers in BFC / IFC / Table FC honor the writing-mode in their geometry; canvas painter rotates glyph context for vertical lines; `physicalBorderSides` helper extended for vertical modes.

Depends on: nothing.

Closes: F3A.7. Also schema-side: removes the throw in `logicalToPhysical` for `vertical-rl`/`vertical-lr`.

### P4 — Mixed-direction bidi

Extends the canvas shaper's `Cluster` to expose per-cluster `bidiLevel`; extends the IFC's reorder pass to handle cluster-level reorder per UAX #9 L1/L2/L3. Hand-rolled UAX #9 implementation.

Depends on: nothing.

Closes: F3C.4.

### P5 — Typography phase 1 (the basics)

Wires consumers for: `textAlign` (start/end/center/justify) in IFC line layout; `textIndent` in IFC first-line offset; `verticalAlign` (sub/super) for inline glyph offset; `letterSpacing` + `wordSpacing` per cluster / per space; `textTransform` (uppercase/lowercase/capitalize) at tokenizer; `textDecoration` full (underline + line-through with style/color) at painter; `fontFeatureSettings` passthrough to canvas font string. Plus the F1.F3.x typography-related editor utilities (cursor-in-broken-word, Home/End on wrapped lines).

Depends on: nothing.

Closes: schema reservations for `textAlign`, `textIndent`, `letterSpacing`, `wordSpacing`, `textTransform`, `textDecoration`, `fontFeatureSettings`. Plus F1.F3.1, F1.F3.3.

### P6 — UAX #14 line-break + UAX #29 grapheme clusters

Replaces the canvas shaper's whitespace+dash heuristic with full UAX #14 line-break property table; replaces canvas-derived cluster boundaries with `Intl.Segmenter` for grapheme clustering. Both are zero-dep (UAX #14 ships embedded; `Intl.Segmenter` is a built-in API).

Depends on: nothing.

Closes: text-subsystem UAX #14 + UAX #29 partial gaps.

### P7 — Hyphenation

Adds the `CanvasShaperOptions.hyphenator` callback wiring in canvas-shaper; IFC consumes `BreakOpportunity` of kind `"hyphen"`; `style.hyphens === "auto"` activates the path.

Depends on: P5 (typography phase 1 — `hyphens` is part of the same schema reservation set; but also needs `Intl.Segmenter`-based clusters from P6 to identify within-word break candidates accurately).

Closes: `hyphens` schema reservation. Pattern dictionaries are host-loaded — engine ships the wiring, not the patterns.

### P8 — Auto-table rowspan/colspan

Schema: add `rowSpan`/`colSpan` on table-cell `StateNode.properties`. Layout: column-width excess distribution per CSS Tables 3 §17.5.2; row-height occupancy-grid layout for spanning cells. Editor: actions for `INSERT_ROW`, `INSERT_COL`, cell navigation.

Depends on: nothing structural for layout. Editor actions can land in a follow-up piece if the layout work needs to land first.

Closes: F3D.1, F3D.6.

### P9 — Generated content + counters

Implements `::before` / `::after` / `::marker` synthesis at cascade-pass time; counter scoping (counter-reset, counter-increment, counter(), counters()); `target-counter()` two-pass resolution (placeholder → page-aware).

Depends on: P1 (pagination — `target-counter()` resolves against `PageBox.pageIndex`).

Closes: generated-content gap. Enables list markers via the same machinery (P10 builds on this).

### P10 — Lists with proper markers

Wires list components (list, list-item) end-to-end. Marker text resolved via the counter machinery from P9 for ordered lists; bullet glyphs for unordered.

Depends on: P9 (counter machinery).

Closes: F2.2 stub.

### P11 — Image and horizontal-line components

End-to-end rendering for image and horizontal-line built-in components: schema in `properties`, renderer paints (image via `ImageCache`, hr as a styled border), editor actions for inserting them.

Depends on: nothing.

Closes: F2.3, F2.4 stubs.

### P12 — Positioning (relative + absolute)

Implements [`docs/architecture/1-core/1.9-positioning.md`](../../architecture/1-core/1.9-positioning.md): position/inset/zIndex schema; absolute-containing-block tracking in `LayoutContext`; two-phase layout (in-flow + abs-pos pending list); stacking-context determination at layout time; painter walks the in-flow tree then `absoluteChildren` per stacking-context order.

Depends on: nothing structural. Plays well with pagination after P1 (a `PageBox` becomes the abs-pos containing block boundary for its content).

Closes: positioning gap.

### P13 — Visual chrome (backgrounds, borders, box-shadow, opacity)

Schema additions: `boxShadow`, `opacity`, `backgroundImage` (linear gradients first; image-url defers to a future piece). Painter enhancements: gradient backgrounds, box-shadow draws (offset/blur/spread), opacity grouping via offscreen canvas.

Depends on: P12 (stacking-context infrastructure for opacity grouping).

Closes: visual-chrome gap.

### P14 — Transforms

Schema: `transform`, `transformOrigin`. Painter applies CSS transform matrix per box; hit-test inverts. Stacking-context implications already handled by P12.

Depends on: P12 (stacking contexts), P13 (offscreen-canvas infrastructure used for opacity is reused for filter regions; though transforms don't strictly need offscreen).

Closes: transforms gap.

### P15 — Table editor actions

End-to-end editor actions for tables: `INSERT_TABLE`, `INSERT_ROW`, `INSERT_COL`, `DELETE_ROW`, `DELETE_COL`, cell-boundary navigation (Tab to move between cells, Enter to split-cell-content), copy/paste of structured table content.

Depends on: P8 (rowspan/colspan layout) for full functionality but can ship the basic case (no spans) earlier.

Closes: F2.5 stub + table-editing gap.

### P16 — Editor utility polish

Cursor-in-broken-word, empty-line indicator on selected empty lines, triple-click paragraph-selection, shift-click selection extension, toolbar bold/italic/underline indicator correctness against the new state-tree shape (no span wrappers per the inline-style strategy in 1.1-state).

Depends on: P5 (typography phase 1 — some of these hinge on the IFC's break behavior).

Closes: F1.F3.x.

### P17 — IME composition

Composition state machine in editor controller; composition rendering with distinct styling; composition-end commits via INSERT_TEXT.

Depends on: nothing.

Closes: IME gap.

### P18 — Cascade + layout incremental polish (perf)

Persist `LayoutBoxCache` across keystrokes (currently rebuilt from `oldLayout` per call). Wire convergence detection from `wrap-incremental.ts` into the IFC's main wrap loop. Hash-stable cascade output for component-emitted anonymous nodes (so generated-content from P9 doesn't break reuse).

Depends on: P1 (pagination changes incremental layout boundaries), P9 (generated content's reference-equality discipline must align).

Closes: F3G.3, F3H.1, F3H.2 (deferred items).

### P19 — Selective compositing (cursor + selection layers)

Promote cursor caret + selection rectangles to dedicated offscreen canvases that composite onto the page canvas. Cursor blink toggles caret-layer visibility without repainting underlying text. Selection drag updates selection-layer geometry without re-rasterizing text.

Depends on: P13 (offscreen-canvas infrastructure).

Closes: F3I.1 (true skip-painting via per-box layers — selective scope only).

---

## Ordering

The recommended sequence:

```
              P1 ──────► P9 ──► P10
              (pagination)
                                                          P15
              P2 (inline-block clamp)                    /
                                                  P8 ──┘
              P3 (vertical writing-mode)         (rowspan/colspan)
              P4 (mixed-direction bidi)
              P5 (typography phase 1) ──► P7 (hyphens)
              P6 (UAX #14 + #29) ────────►
              P11 (image + hr)
              P12 (positioning) ──► P13 (visual chrome) ──► P14 (transforms)
                                                       \
                                                        ──► P19 (selective compositing)
              P16 (editor polish)   [depends P5]
              P17 (IME)
              P18 (perf polish)     [depends P1, P9]
```

Dependencies in plain English:

- **Independent (can ship anytime):** P1, P2, P3, P4, P5, P6, P8, P11, P12, P17.
- **Need P1:** P9, P18.
- **Need P5:** P7 (also wants P6), P16.
- **Need P9:** P10, P18.
- **Need P12:** P13, P14, P19.
- **Need P13:** P14, P19.
- **Need P8:** P15 (basic table editing can land earlier without spans).

## Recommended ship order

1. **P1 — Pagination** (the big one; closes regression + the user's reported scaling pain).
2. **P2 — Inline-block clamp** (one-commit fix; ship en route).
3. **P3 — Vertical writing-mode** (cashes in the Plan 3.A logical-axis investment).
4. **P5 — Typography phase 1** (broad user-visible value; unblocks P7 + P16).
5. **P6 — UAX #14 + #29** (text correctness; no dependencies).
6. **P9 — Generated content + counters** (unlocks P10).
7. **P10 — Lists** (high user value; visible payoff for P9).
8. **P11 — Image + hr** (ship the remaining stub components).
9. **P4 — Mixed-direction bidi** (technical correctness; high-value for non-Latin users).
10. **P8 — Rowspan/colspan** (table correctness).
11. **P15 — Table editor actions** (closes the table feature surface).
12. **P12 — Positioning** (architectural commitment from CLAUDE.md scope).
13. **P13 — Visual chrome** (polish + opacity).
14. **P14 — Transforms** (architectural commitment).
15. **P7 — Hyphenation** (depends on P5 + P6).
16. **P16 — Editor polish** (small fixes after upstream changes settle).
17. **P17 — IME** (composition support).
18. **P18 — Cascade + layout incremental polish** (perf optimization once feature surface is stable).
19. **P19 — Selective compositing** (cursor blink + selection drag perf).

This order optimizes for: closing regressions early (P1), broad user value early (P5/P9/P10), technical correctness next (P4/P8), then architectural completion (P12-P14), then polish (P15-P19).

Re-order at any time if user value or dependencies change.
