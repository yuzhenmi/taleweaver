# Decomposition — closing the gap to target architecture

Maps `docs/architecture/state-of-branch.md` to a set of bounded pieces.
Each piece ships independently, has a clean interface to its
neighbors, and implements a specific section of the target-architecture
docs. Order is by dependency; within an unordered batch, pick by
user-visible value.

This doc is roadmap, not architecture — lives in
`docs/superpowers/plans/`. The architecture docs are the spec each
piece implements against.

**Per-piece agents:** before picking up a piece below, read CLAUDE.md
("Coordination protocol for per-piece agents"). The architecture has
been derisked to ~95% confidence (see
[`docs/superpowers/specs/2026-05-02-architecture-derisk-memo.md`](../specs/2026-05-02-architecture-derisk-memo.md));
each piece below fits a known architectural slot. If implementation
surfaces a need for cross-cutting architectural change, stop and
surface it before unilaterally restructuring.

---

## Pieces

### P1 — Pagination

Implements [`docs/architecture/1-core/1.5-pagination.md`](../../architecture/1-core/1.5-pagination.md).

Ships: `PageBox` type added to the LayoutBox union; `paginateRoot` fragmenter walks a layout tree and emits a sequence of `PageBox`es; whole-block placement first, then within-block fragmentation at line boundaries with widows/orphans + break rules; page templates with headers/footers; footnote slot. Also restores the `EditorConfig.pageConfig` field and wires `editor-controller.ts`'s dormant per-page-canvas path. Schema additions: `widows`, `orphans` consumers wired (already in schema).

Depends on: nothing.

Closes: F3K.A (canvas overflow at ~800 paragraphs), F3K.D (1000p tab freeze, hypothesized canvas-buffer cause), F1.F8.x (`pageHeight`/`pageMargins`/`pageGap` removed in Plan 1), missing-pagination regression vs main.

Out of scope for P1: incremental pagination (whole-doc repagination on any change is acceptable until profiling says otherwise); generated content's `target-counter()` two-pass resolution (lands with P14).

**Status:** P1.A (foundation — whole-block placement) shipped. P1.B
(within-block fragmentation, widows/orphans, break-* properties; plus
page-margin offset and per-page paint-coords fixes from browser smoke
testing) shipped. P1.C designed (spec at
[`docs/superpowers/specs/2026-05-02-p1c-pagination-templates-design.md`](../specs/2026-05-02-p1c-pagination-templates-design.md));
not yet implemented. P1.C decomposes into 5 sub-pieces (P1.C.1 through
P1.C.5) per the spec's Decomposition section.

Follow-ups deferred:
- All P1.C sub-pieces.
- Cross-page floats (P1.D-or-P12).
- Cross-page table header row (`<thead>`) repetition (requires
  `Display: "table-header-group"` schema addition).
- Bottom-side margin truncation across breaks for the parent-with-bottom-
  padding/border edge case (top side already shipped in P1.B).

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

Wires consumers for: `textAlign` (start/end/center/justify) in IFC line layout; `textIndent` in IFC first-line offset; `verticalAlign` (sub/super) for inline glyph offset; `letterSpacing` + `wordSpacing` per cluster / per space; `textTransform` (uppercase/lowercase/capitalize) at tokenizer; `textDecoration` full (underline + line-through with style/color) at painter; `fontFeatureSettings` passthrough to canvas font string; `tabSize` honored in tokenizer for tab characters; `textWrap` (`wrap` / `nowrap` / `balance` / `pretty` / `stable`) in IFC wrap algorithm. Plus the F1.F3.x typography-related editor utilities (cursor-in-broken-word, Home/End on wrapped lines).

Depends on: P3 (textAlign in vertical writing modes uses the inline-axis derived from writing-mode + direction; without P3 first, the textAlign integration is exercised only on horizontal-tb and may regress when vertical modes activate).

Closes: schema reservations for `textAlign`, `textIndent`, `textWrap`, `letterSpacing`, `wordSpacing`, `textTransform`, `textDecoration`, `fontFeatureSettings`, `tabSize`. Plus F1.F3.1, F1.F3.3.

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

### P9a — Generated content + same-tree counters

Implements `::before` / `::after` / `::marker` synthesis at cascade-pass time; counter scoping (`counter-reset`, `counter-increment`, `counter()`, `counters()`). All resolution happens in a single cascade walk against the in-tree counter state; no pagination required.

Depends on: nothing.

Closes: generated-content gap (except `target-counter()`). Enables list markers via the same machinery (P10 builds on this).

### P9b — `target-counter()` two-pass resolution

Implements the two-pass resolution for `target-counter(href, name)` references — first pass emits placeholder content; after pagination produces `PageBox`es, walk the placeholders, look up each target's `pageIndex`, and substitute the resolved value back. Re-cascade and re-layout only the affected pseudo-elements.

Depends on: P1 (pagination produces the `PageBox.pageIndex` lookup), P9a (counter machinery + pseudo-element synthesis).

Closes: `target-counter()` gap. Enables P22's cross-reference work for "see page 42"-style references.

### P10 — Lists with proper markers

Wires list components (list, list-item) end-to-end. Marker text resolved via the counter machinery from P9a for ordered lists; bullet glyphs for unordered.

Depends on: P9a (counter machinery — does NOT need P1 or P9b).

Closes: F2.2 stub.

### P11 — Image and horizontal-line components

End-to-end rendering for image and horizontal-line built-in components: schema in `properties`, renderer paints (image via `ImageCache`, hr as a styled border), editor actions for inserting them.

Depends on: nothing.

Closes: F2.3, F2.4 stubs.

### P12 — Positioning (relative + absolute)

Implements [`docs/architecture/1-core/1.9-positioning.md`](../../architecture/1-core/1.9-positioning.md): position/inset/zIndex schema; absolute-containing-block tracking in `LayoutContext`; two-phase layout (in-flow + abs-pos pending list); stacking-context determination at layout time; painter walks the in-flow tree then `absoluteChildren` per stacking-context order.

Depends on: nothing structural. Plays well with pagination after P1 (a `PageBox` becomes the abs-pos containing block boundary for its content).

Closes: positioning gap.

### P13 — Visual chrome (backgrounds, borders, box-shadow, opacity, overflow)

Schema additions: `boxShadow`, `opacity`, `backgroundImage` (linear gradients first; image-url defers to a future piece), `overflow` (`visible` / `hidden` / `clip` / `scroll` / `auto`). Painter enhancements: gradient backgrounds, box-shadow draws (offset/blur/spread), opacity grouping via offscreen canvas, overflow clipping (`hidden`/`clip`) via canvas clipping region. `establishesNewBFC` updated to consume `overflow` per CSS spec (non-`visible` overflow establishes a new BFC).

Depends on: P12 (stacking-context infrastructure for opacity grouping).

Closes: visual-chrome gap; `overflow` schema gap.

### P14 — Transforms

Schema: `transform`, `transformOrigin`. Painter applies CSS transform matrix per box (`ctx.save` / `ctx.translate` / `ctx.rotate` / `ctx.scale` / `ctx.restore`); hit-test inverts. Stacking-context implications already handled by P12.

Depends on: P12 (stacking contexts).

Closes: transforms gap.

### P15a — Table editor actions (no spans)

Basic editor actions for tables: `INSERT_TABLE`, `INSERT_ROW`, `INSERT_COL`, `DELETE_ROW`, `DELETE_COL`, cell-boundary navigation (Tab to move between cells, Enter to split-cell-content), copy/paste of structured table content. Cells are 1×1 only.

Depends on: nothing (existing Table FC handles 1×1 cells).

Closes: F2.5 stub for the common case.

### P15b — Span-aware table editor actions

Adds rowspan/colspan to the editor actions: `MERGE_CELLS`, `SPLIT_CELL`, navigation across spanned cells, copy/paste preserving spans.

Depends on: P8 (rowspan/colspan layout), P15a.

Closes: full table editing.

### P16 — Editor utility polish

Cursor-in-broken-word, empty-line indicator on selected empty lines, triple-click paragraph-selection, shift-click selection extension, toolbar bold/italic/underline indicator correctness against the new state-tree shape (no span wrappers per the inline-style strategy in 1.1-state).

Depends on: P5 (typography phase 1 — some of these hinge on the IFC's break behavior).

Closes: F1.F3.x.

### P17 — IME composition

Composition state machine in editor controller (idle → composing → idle); composition rendering with distinct underline styling; composition-end commits via INSERT_TEXT. While `state === "composing"`, non-composition keydown events (arrow keys, Enter, etc.) are suppressed — the IME owns input until `compositionend`.

Depends on: nothing.

Closes: IME gap.

### P18 — Cascade + layout incremental polish (perf)

Persist `LayoutBoxCache` across keystrokes (currently rebuilt from `oldLayout` per call). Wire convergence detection from `wrap-incremental.ts` into the IFC's main wrap loop. Hash-stable cascade output for component-emitted anonymous nodes (so generated-content from P9 doesn't break reuse).

Depends on: P1 (pagination changes incremental layout boundaries), P9 (generated content's reference-equality discipline must align).

Closes: F3G.3, F3H.1, F3H.2 (deferred items).

### P19 — Selective compositing (cursor + selection layers)

Promote cursor caret + selection rectangles to dedicated offscreen canvases that composite onto the page canvas. Cursor blink toggles caret-layer visibility without repainting underlying text. Selection drag updates selection-layer geometry without re-rasterizing text.

Depends on: nothing structural. (Independent of P13 — uses its own offscreen canvases for cursor/selection layers.)

Closes: F3I.1 (true skip-painting via per-box layers — selective scope only).

### P20 — Tab stops

IFC extension: tab-stop positions, alignments (left/center/right/decimal), leaders. A tab character resolves against the nearest containing tab-stop set declared on the paragraph. Schema: `tabStops?: readonly TabStop[]` on `Style`.

Depends on: P5 (tabSize / tab character handling lands first as the simple case).

Closes: tab-stops gap (CLAUDE.md "word-processor primitives" list).

### P21 — Hyperlinks

Inline-range `href` model. Schema: hyperlink as a state-tree node type (`hyperlink`) wrapping inline content with `properties.href`. Render: hyperlink children participate in the inline pipeline normally; the rendered nodes carry a metadata flag the painter consumes for default link styling (underlined + accent color). Editor actions: `INSERT_LINK`, `EDIT_LINK`, `REMOVE_LINK`. Click handling in the editor controller: meta-click (or configurable trigger) on a hyperlink fires a callback the host registered.

Depends on: nothing.

Closes: hyperlinks gap (CLAUDE.md "word-processor primitives" list).

### P22 — Cross-references and bookmarks

Schema: bookmark as a state-tree node type (`bookmark`) with `properties.id`. Render: zero-width anchor in the layout tree (a special `BookmarkBox` at the bookmark's position). `target-counter(href, name)` in pseudo-element content resolves against bookmark IDs. Editor actions: `INSERT_BOOKMARK`, `INSERT_CROSS_REFERENCE`. Cross-references render as plain text whose content is a `target-counter()` (e.g., page number) computed via P9b.

Depends on: P9b (target-counter resolution), P21 (cross-references navigate via the hyperlink click mechanism).

Closes: cross-references / bookmarks gap.

### P23 — Comments / annotations

Range-overlay decoration layer for comments. Schema: comment as an out-of-tree annotation set carried alongside `EditorState`, each comment carrying `{ id, range: Span, body, author, timestamp, replies?: Comment[] }`. Rendering: a separate decoration-overlay subsystem paints comment indicators (margin marks, range highlights) on top of the layout. Editor actions: `INSERT_COMMENT`, `RESOLVE_COMMENT`, `REPLY_TO_COMMENT`. Range remapping under edits: as content is edited, comment ranges update via the same `remapPosition` machinery already in `state/formatting.ts`.

Depends on: nothing structural. The decoration overlay subsystem is its own paint layer.

Closes: comments / annotations gap.

### P24 — Change tracking

Insertion / deletion markup as inline-style + decoration overlay. Schema: track-change state (off / suggesting / accepting) carried alongside `EditorState`. When tracking is on, INSERT_TEXT marks new text as inserted (visible as colored + underlined); DELETE_BACKWARD marks text as deleted (visible as strikethrough but retained in the state tree until accept/reject). Editor actions: `TOGGLE_TRACK_CHANGES`, `ACCEPT_CHANGE`, `REJECT_CHANGE`, `ACCEPT_ALL`, `REJECT_ALL`.

Depends on: P23 (comments/annotation overlay infrastructure for the markup layer).

Closes: change-tracking gap.

### P25 — Spell-check decoration overlays

Range-overlay decorations for misspelled words. The dictionary / detection backend is OUT of scope per CLAUDE.md; the engine ships only the overlay rendering and the API hosts use to register misspelled ranges (`registerMisspelling(range, suggestions?)`). The overlay subsystem from P23 paints squiggly underlines under registered ranges; right-click (or configurable trigger) shows host-supplied suggestions.

Depends on: P23 (overlay subsystem).

Closes: spell-check decoration gap.

### P26 — Multi-column

CSS Multi-column Module. Schema: `columnCount`, `columnWidth`, `columnGap`, `columnRule*`, `columnSpan`. New formatting context (Column FC) that fragments block content into multiple columns within a containing block. Establishes a new BFC. Pagination interacts via column-then-page fragmentation order.

Depends on: P1 (pagination — column fragmentation interleaves with page fragmentation; without P1 we have nothing to interleave with).

Closes: multi-column gap.

---

## Dependencies

Plain-English summary:

- **Independent (can ship anytime):** P1, P2, P3, P4, P6, P8, P9a, P11, P12, P15a, P17, P19, P21, P23.
- **Needs P1 (pagination):** P9b, P18, P26.
- **Needs P3 (vertical writing-mode):** P5 (textAlign in vertical modes).
- **Needs P5 (typography phase 1):** P7 (hyphens), P16 (editor polish), P20 (tab stops).
- **Needs P6 (UAX #14/#29):** P7 (hyphens — needs accurate cluster boundaries).
- **Needs P9a (counters + pseudo-elements):** P9b (also needs P1), P10 (lists).
- **Needs P9b (target-counter):** P22 (cross-references).
- **Needs P12 (stacking contexts):** P13, P14.
- **Needs P15a (basic table actions):** P15b (span-aware table actions; also needs P8).
- **Needs P21 (hyperlinks):** P22 (cross-reference click navigation).
- **Needs P23 (overlay subsystem):** P24 (change tracking), P25 (spell-check overlays).

## Recommended ship order

1. **P1 — Pagination** (the big one; closes regression + canvas-overflow scaling pain).
2. **P2 — Inline-block clamp** (one-commit fix; ship en route).
3. **P3 — Vertical writing-mode** (cashes in the Plan 3.A logical-axis investment; unblocks P5 textAlign correctness).
4. **P5 — Typography phase 1** (broad user-visible value; unblocks P7, P16, P20).
5. **P6 — UAX #14 + #29** (text correctness; no dependencies).
6. **P9a — Generated content + counters** (unlocks P10).
7. **P10 — Lists with proper markers** (high user value; visible payoff for P9a).
8. **P11 — Image + horizontal-line** (ship the remaining stub components).
9. **P4 — Mixed-direction bidi** (technical correctness; high-value for non-Latin users).
10. **P8 — Rowspan/colspan** (table correctness).
11. **P15a — Table editor actions (no spans)** (basic table editing).
12. **P9b — `target-counter()` resolution** (now that P1 is in).
13. **P12 — Positioning** (architectural commitment from CLAUDE.md scope).
14. **P13 — Visual chrome + overflow** (polish + opacity + clipping).
15. **P14 — Transforms** (architectural commitment).
16. **P21 — Hyperlinks** (high user value; word-processor primitive).
17. **P22 — Cross-references and bookmarks** (depends on P21 + P9b).
18. **P15b — Span-aware table editor actions** (closes the table feature surface).
19. **P7 — Hyphenation** (depends on P5 + P6).
20. **P20 — Tab stops** (depends on P5).
21. **P23 — Comments / annotations** (overlay subsystem; foundation for P24, P25).
22. **P24 — Change tracking** (depends on P23).
23. **P25 — Spell-check decoration overlays** (depends on P23).
24. **P26 — Multi-column** (depends on P1).
25. **P16 — Editor polish** (small fixes after upstream changes settle).
26. **P17 — IME** (composition support).
27. **P18 — Cascade + layout incremental polish** (perf optimization once feature surface is stable).
28. **P19 — Selective compositing** (cursor blink + selection drag perf).

This order optimizes for: closing regressions early (P1), broad user value early (P5/P9a/P10), technical correctness next (P4/P8), then architectural completion (P12-P14), then word-processor primitives (P21/P22/P23/P24), then polish/perf at the end. P19 is independent and could ship earlier if cursor-blink perf becomes a noticeable concern.

Re-order at any time if user value or dependencies change.
