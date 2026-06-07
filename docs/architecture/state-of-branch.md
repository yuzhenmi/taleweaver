# State of the Branch

This is the audit of current implementation against the target
architecture. Each module is annotated with a status flag:

- **`[implemented]`** — present, working, broadly aligned with the
  target architecture.
- **`[partial]`** — present, but with known gaps or shortcuts.
- **`[broken]`** — present but failing one of its declared invariants.
- **`[missing]`** — absent from the codebase.

When the architecture docs and the code disagree, the architecture is
the source of truth; the gap is logged here.

---

## `core`

### `styles/` `[implemented]`

Full vocabulary present: `Style`, `ComputedStyle`, `UsedStyle`, `Length`,
`Color`, `Display`, `WritingMode`, `Direction`, etc. Every other module
imports from here.

Schema reservations (present in `Style` and `ComputedStyle` but not yet consumed by any code path):
- `widows`, `orphans` — required by pagination.
- `hyphens`, `fontFeatureSettings`, `tabSize` — required by typography phase 1 (P5); resolved into `UsedStyle` but not yet read by any tokenizer/layout/paint consumer. (`textAlign` incl. justify, `textWrap`/`whiteSpace`, `textIndent`, `letterSpacing`/`wordSpacing`, and `textTransform` are NOW consumed — `letterSpacing`/`wordSpacing` via `layout/text-spacing.ts` (applied in the shapers + IFC trailing-trim + renderer); `textTransform` via the `textTransformInterpreter` cascade interpreter + the IFC's per-token display transform (`layout/text-transform.ts`) + the `SET_TEXT_TRANSFORM` editor action + toolbar — so they are no longer schema-only.)
Schema items genuinely missing:
- `overflow` — required by `establishesNewBFC`'s full check.
- `position: absolute / fixed`, `transform`, `opacity` — required by positioning + visual-chrome work.

### `state/` `[implemented]`

Y.Doc-backed block-tree-of-styled-runs (the 2026-05-02 redesign; see
`1.1-state.md`): a `Map<BlockId, Block>` over a Yjs document, each block
carrying `inlineContent: InlineItem[]`, with ID-based positions
(`{ blockId, offset }`). Layered operations (Layer-1 Y-primitives →
Layer-2 read utilities → Layer-3 mutations: insertText, deleteRange,
replaceRange, splitBlock, mergeBlocks, set/mergeBlockAttrs, clonePastedSubtree).
History is a `Y.UndoManager` wrapper that welds each undo unit's before/after
selection onto its `StackItem.meta` (no parallel array), with Google-Docs-style
typing coalescing: same-kind text edits within a pause window merge into one
undo unit, with the boundary owned explicitly by `beginEntry` /
`breakCoalescing` (the reducer classifies actions via `coalesceKeyOf`).
Dirty tracking is write-time: `dirtyIds` captured from Yjs's
`afterTransaction` change event (not tree diffing), consumed by the
incremental render/cascade/layout passes. `applyOperation` returns the input
`State` reference unchanged on a no-op, so `result.state === state` is an
O(1) "did anything change?" guard. The old path-based `StateNode` immutable
tree is fully removed.

Known follow-ups (low urgency): `Y.Map.set(key, sameValue)` fires
change events → scattered same-value-write guards in ops like
`reparent-children.ts` self-move; consolidate via a `setIfChanged`
Y-utils helper (#358).

### `components/` `[partial]`

Built-in components register and render. Plugin registry works.

Built-in component behavior:
- `imageComponent`, `horizontalLineComponent` are complete end-to-end:
  they render AND paint (canvas-renderer `drawImage` for images, the rule
  stroke for horizontal lines; `image-cache` drives async load + re-paint).
  Editing is wired — `INSERT_IMAGE` / `INSERT_HORIZONTAL_LINE` insert the
  atomic-leaf block + a trailing paragraph; atomic-leaf Backspace/Delete at
  a block boundary removes the object as a unit (`atomic-edits.ts`);
  `SET_IMAGE_SIZE` writes width/height back. Browser-gated remainder
  (P11 tail): image natural-size feedback, resize-handle paint + drag,
  example-app Insert menu.
- `tableComponent`, `tableRowComponent`, `tableCellComponent` render, and
  table layout (Table FC) is implemented. Table *editing* is `[implemented]`
  end-to-end, both the uniform (P15a) and span-aware (P15b) surfaces:
  `INSERT_TABLE_ROW`, `INSERT_TABLE_COLUMN`, `DELETE_TABLE_ROW`,
  `DELETE_TABLE_COLUMN` (insert above/below or left/right, remove the caret's
  row/column; `columnWidths` re-spliced/-removed atomically via
  `setBlockAttrsInTx`; last-row/column deletion collapses the whole table),
  `SPLIT_CELL` (unmerge a span back to 1×1 cells), `MERGE_CELLS` (merge a
  selected cell rectangle into one span, via `resolveCellRange`), and
  `DELETE_TABLE` (delete the whole table, replacement paragraph when it is the
  body's sole child). Each row/column handler gates on `ctx.ragged` ONLY (a
  degenerate hole-bearing table is the carve-out) and routes a WELL-FORMED
  SPANNED table (`ctx.spanned`) to the span-aware op (`insertTableRowSpanAware`,
  `insertTableColumnSpanAware`, `deleteTableRowSpanAware`,
  `deleteTableColumnSpanAware` — covering spans shrink/grow, an originating span
  re-homes/decrements, a 1×1 in the deleted line is removed), a plain no-span
  table to the byte-identical P15a op. The span-aware ops reason in the SAME
  occupancy-grid coordinates the Table FC lays out in (shared `table-grid-core`;
  see [`1.4.3-table-fc.md`](1-core/1.4-layout/1.4.3-table-fc.md)), so an edit
  preserves the rectangular-grid invariant layout depends on. Still `[missing]`:
  browser-gated example-app Table menu wiring for the span-aware actions.

### `render/` `[implemented]`

`renderTree`, `renderTreeIncremental` working. Render-tree
reference-equality preserved across edits.

A legacy `render-node.ts` exists alongside the active `render-node-v2.ts`
for migration; the legacy types are not consumed by current core code
but remain exported.

### `cascade/` `[implemented]`

`cascadePass`, `cascadePassIncremental` working. The subtree
short-circuit fires correctly when render-tree references are
preserved upstream. Length flattening (`em` → px) works at cascade time;
`%`, `auto`, intrinsic keywords correctly pass through symbolic.

### `layout/` `[partial]`

Most of the layout pass is implemented and working:
- BFC: margin collapsing, clearance, list markers, anonymous block
  runs. Subtree reuse works including the "rebuilt parent with
  unchanged children" gate. The BFC no longer COUNTS list markers — it
  reads the render-baked `markerText` off the cascaded style and paints
  it (the old `layout/list-counter.ts` counter / seed-replay / run-reset
  / auto-counter machinery was deleted). The marker-gutter behaviors
  (#426 auto-widen, #431 straddling-break marker on the correct page,
  #418 list spacing) are preserved. See the "Lists & numbering" section.
- IFC: line wrap, baseline alignment, full UAX #9 bidi reorder
  (mixed-direction geometry + RTL glyph paint + RTL cursor — see the
  bidi entry below for browser-smoke status), hyphen splitting,
  inline-block sizing, paragraph-level reuse.
- Table FC: occupancy-grid model (§17.5), `colSpan`-aware auto-layout
  column widths (§17.4) and `rowSpan` row-height distribution (§17.5.3),
  anonymous row/cell synthesis, and fragmentation across pages — including
  `rowSpan` cells that straddle a page break (interior fragmented + a
  `SpanningCellContinuation` emitted, then resumed on the next fragment).
- Float environment: full CSS 9.5 placement with push-below-if-needed,
  clearance integrated with margin-collapse, dirty-offset tracking.
- Intrinsic sizing pass: `min-content` and `max-content` per render
  node, cached. A text run's `min-content` is the widest UNBREAKABLE
  segment — the widest run of clusters between UAX #14 break opportunities
  (the widest "word"), computed in `computeTextContribution` from the run's
  `breakOpportunities` — NOT the widest single grapheme cluster.
- Layout-box reuse: `LayoutBoxCache`, `isLayoutBoxReusable`,
  `renderNodesLayoutEquivalent`.

Known gaps:
- **Bidi — geometry + glyph paint + RTL cursor implemented; in-browser
  smoke pending.** The **full UAX #9 algorithm engine** (`layout/uax9/`,
  P4-A: `resolveBidiLevels` P/X/W/N/I + `reorderVisual`/`applyL1`/
  `reorderRunsByLevel`, conformant against the official `BidiTest.txt` +
  `BidiCharacterTest.txt` at 100%, zero runtime deps) is wired into the IFC
  (P4-B `resolveParagraphBidi`; P4-C.1 `reorderLineForBidi` +
  `ifc-bidi-reorder.ts`). Mixed-direction lines reorder into correct
  **visual box geometry** — paragraph-level resolution → post-L1
  segmentation → flatten/segment/`reorderRunsByLevel`/re-nest → physical
  coordinates (see `1.4-layout/1.4.2-ifc.md` "Bidi handling"); each
  reordered run carries its `bidiLevel`. **Glyph paint** (P4-C.1 T7) is
  done: the canvas renderer reverses a run's cluster placement when
  `bidiLevel` is odd, so an RTL run's own glyphs read right-to-left. **RTL
  cursor / hit-test / selection / navigation** (P4-C.2) is done: the cursor
  layer (`cursor/line-bidi.ts` `LineBidiView` + `caretXInLeaf` /
  `offsetInLeaf` / `moveVisually` / `selectionRectsForLineRange`,
  `cursor/visual-motion.ts`, and `EditorState.caretAffinity` managed by
  `actionManagesCaretAffinity`) makes caret X, click→offset, boundary-
  crossing selection rects, and visual-order ArrowLeft/Right + Shift+Arrow
  all bidi-aware; Home/End stay logical and render at the correct visual
  edge via affinity (see `1.7-editor.md` "Bidi cursor"). So Hebrew embedded
  in English now sits in the right place, reads right-to-left, and caret
  motion through it is visual-order-aware — all unit-verified. `[partial]`
  Remaining for the whole P4 bidi feature: the in-browser smoke validation,
  including a handful of `TODO(C.2.7 browser-confirm)` boundary cases (the
  left-going dual-caret double-stop; the cross-line visual edge when a
  line's content direction differs from the paragraph base; the exact
  Google-Docs RTL Home/End rendering).
- **Convergence detection for incremental wrap** (`rewrapIncremental`)
  is implemented and tested in `wrap-incremental.ts` but not yet wired
  into the IFC's main wrap loop — foundation-built-ahead, scoped to P18.
  The IFC's all-or-nothing paragraph cache (`findChangePoint`) already
  provides the dominant benefit (every un-edited paragraph reused each
  keystroke); `rewrapIncremental` adds only marginal partial reuse within
  the single edited paragraph. A correct wire-in must first resolve four
  integration hazards (tail vertical-repositioning, float-environment
  gate, bidi-context gate, fragmentation interaction) — see
  `1.4-layout/1.4.2-ifc.md` "Convergence (incremental wrap)". Wiring it
  naively would ship a degraded, incorrect partial-reuse.
- **Table `border-collapse: collapse`** — every cell draws its own
  borders; the heaviest-wins collapse resolution is not implemented.
- **Repeating `<thead>`/`<tfoot>` across page fragments** — needs a
  `table-header-group` schema addition; `resumeAtRow` already indexes the
  body.

### Pagination `[partial]`

Foundation shipped (P1.A): `PageBox` LayoutBox variant; `paginateRoot` whole-block fragmenter; `EditorConfig.pageConfig` wires through layoutTree / layoutTreeIncremental; the editor controller's per-page-canvas path activates when `PageBox`es appear in the layout tree.

Within-block fragmentation shipped (P1.B): `FragmentationContext` and `LayoutResult` types wired through `layoutBlock`, `layoutInlineContent`, and `layoutTable`; `paginateRoot` rewritten as a page-by-page coordinator driving `layoutBlock` with a break token per page; BFC break-aware child loop (`break-before`, `break-after`, `break-inside`, margin truncation top side, overflow rule, resume from `BlockBreakToken`); IFC orphans/widows/hyphen-pair constraints and resume from `IFCBreakToken`; Table FC row-boundary fragmentation and resume from `TableBreakToken`.

Page margins shipped: each `PageBox` contains a single wrapping content-area `BlockBox` positioned at `(margins.inlineStart, margins.blockStart)` within the page; the BFC's containing inline size is the page content width (page minus inline margins). Content visibly insets from the page edges per CSS Paged Media semantics. The editor's `SET_CONTAINER_WIDTH` action threads `pageConfig` through to its `layoutTree` call, preserving paginated mode across container resizes.

Per-page paint coordinates: `paintPage` and `walkAndDetectChanges` translate by `(-pageBox.x, -pageBox.y)` so each page paints in page-local coordinates against its own canvas. `acquireCanvas` resets canvas dimensions and the per-page `PaintCache` when a slot's canvas is freshly created or recycled from the pool, preventing blank renders from cache short-circuit.

Page templates designed (P1.C; spec at `docs/superpowers/specs/2026-05-02-p1c-pagination-templates-design.md`; not yet implemented). State-tree-backed editable headers/footers scoped to `section` nodes; footnotes as inline state-tree nodes with section-level numbering policy; six margin regions; first/odd/even page variants; iterative footnote-slot convergence; two-pass page-count resolution; cursor-scope extension for editing header/footer/footnote subtrees. Decomposes into 5 sub-pieces (P1.C.1 through P1.C.5).

Still missing (deferred to P1.C and later):
- All P1.C sub-pieces (headers/footers/footnotes/templates).
- Bottom-side margin truncation across breaks for the edge case where the parent has bottom padding/border on a partial fragment (top side already shipped in P1.B).
- Cross-page floats (P1.D-or-P12; current float environment is single-fragment-aware).
- Cross-references (Google-Docs reference fields, NOT CSS `target-counter`) — not yet built; the render-time numbering service is the foundation when they land.
- Cross-page table header row (`<thead>`) repetition (requires `Display: "table-header-group"` schema addition).

### Text `[partial]`

`TextShaper` interface defined; `text-tokenize` produces wrap-units
with stable IDs and break opportunities; canvas shaper supplies font
metrics, cluster boundaries, and (uniform-direction) bidi levels.

Known gaps:
- **UAX #14 line-break algorithm** is **implemented** (`layout/uax14/`): a
  hand-rolled conformant rule engine (`lineBreakOpportunities` /
  `lineBreakClass`, rules LB1–LB31 with §8.2 number tailoring) backed by a
  committed Unicode break-property table, passing the full
  `LineBreakTest.txt` suite. It feeds the canvas/mock shapers' break
  opportunities and is the IFC wrap loop's break authority (the IFC
  classifies the assembled inline source once and annotates tokens with
  `softBreaks` / `breakableBefore`). CJK paragraphs wrap between ideographs;
  NBSP/`GL` glue holds its neighbours together; hyphens break. `cjBreakable`
  selects the CSS `line-break` behavior for CJ small-kana (default keeps
  them together).
- **UAX #29 grapheme cluster boundaries** are correct: `segmentClusters`
  groups graphemes via `Intl.Segmenter` (`graphemeClusters`), so a base +
  combining marks, a surrogate-pair emoji, an emoji ZWJ sequence, and a
  regional-indicator flag are each one cluster. The gap is glyph *metrics*,
  not boundaries: a cluster's advance is one base width per grapheme (combining
  marks add 0), an approximation of true complex-script positioning until a
  HarfBuzz-quality shaper is wired.
- **Hyphenation dictionaries** are not loaded; `hyphens: auto` falls
  back to no-hyphenation regardless of language.

A legacy `TextMeasurer` interface exists alongside `TextShaper` for
backwards compatibility; new code uses `TextShaper`.

### `cursor/` `[implemented]`

Selection types, `moveByCharacter`, `moveByWord`, `selectWord`,
`expandSelection`. Pure operations; consumed correctly by editor
action handlers.

### `editor/` `[partial]`

Reducer, action handlers, geometry queries, line navigation all
present. Action coverage is broad: insert text, delete (backward,
forward, by word, by line), move (char, word, line, document boundary),
expand selection, apply inline style, set block type, insert node.

Known gaps:
- **Cursor placement within a word broken across lines** — a word splits
  across two visual lines only via hyphenation (`hyphens` defaults to
  `manual`, so only an explicit soft-hyphen U+00AD breaks today; the IFC's
  manual hyphen-split machinery handles that path) or `overflow-wrap:
  break-word`. Automatic hyphenation is **P7 (not implemented)**,
  `overflow-wrap: break-word` is not in the IFC, and the mock shaper emits
  no `hyphen`-kind break opportunities — so this is a future-feature item
  (lands with P7 / overflow-wrap), not a restorable disabled test.

Resolved since this section was first written (kept here as a record of
closed gaps, no remaining action):
- **Empty-line indicator on empty selected lines** — a selection crossing
  empty paragraphs paints one NARROW paragraph-break indicator rect per
  empty line (browser/Google-Docs faithful: the line return is selected,
  not the full line width). Implemented via the strut LineBox (#168) plus
  the empty-line edge-collapse in `selection-geometry.ts` (an empty strut
  line collapses to zero content width, so the paragraph-break indicator
  width is emitted instead of the full line). Verified by
  `cursor/selection-geometry.test.ts` (per-line rects across one and across
  N consecutive empty paragraphs; the narrow-not-full-line assertion).
- **Home/End on a wrapped line** — the LineBox-canonical line-navigation
  (E-E.6) resolves Home/End against the specific visual LineBox the caret
  sits on, so on a wrapped middle line they go to that line's
  `inlineOffsetStart`/`inlineOffsetEnd`, not the block boundary. Verified
  by `cursor/line-navigation.test.ts` ("Home/End on a wrapped MIDDLE line
  go to the VISUAL-line boundary, not the block boundary").
- **Triple-click paragraph selection** and **shift-click extension** —
  re-verified against the current leaf-block model: the controller's
  `mousedown` handler builds the span directly from the hit-test leaf
  (`createSpan(createPosition(leafId, 0), …)`), no path arithmetic.
- **Toolbar bold/italic/underline indicators** — superseded by the tested
  `getActiveFormatting` engine query, which reads inline-item `attrs`
  directly (the new model stores styles on text-item attrs, not span
  nodes), and the example app's toolbar live-state wiring.
- **Paste-then-select-all reverts content** (was: user-observed,
  unprofiled) — investigated. The reducer path is provably
  content-preserving: `PASTE` commits atomically in a single
  transaction, `SELECT_ALL` is purely read-only (sets `selection`,
  never mutates the block tree), and the DOM controller dispatches
  both as stateless actions through React `useReducer` (no
  stale-closure race). Locked by a regression test
  (`actions/paste.test.ts` — "paste-then-select-all preserves
  content"). Any residual symptom would live only in the browser
  event / hidden-textarea sync layer and is covered by the user's
  in-browser smoke.

### Lists & numbering `[implemented]`

The flat Google-Docs list model is shipped end-to-end. A "list" is a
document-order run of `list-item` LEAF blocks sharing a `listId` attr;
nesting is the per-item `listLevel`; per-list numbering config lives in the
`listDefs` Y.Doc side-table (4th top-level map). The old STRUCTURAL model
(a `list` container wrapping `list-item`s, with a `listType` attr) is gone:
the `list` component and `components/list.ts` were deleted, and a
`migrate-list-structure` migration upgrades legacy documents.

- **State** (`1.1-state.md`): `listDefs` map (`getListDef(s)` /
  `getListDefsForState` / `writeListDefInTx` / `classifyListDef`), tracked
  as a 4th UndoManager scope and seeded by `createYDoc`; flat list-item
  attrs (`listId`/`listLevel`/`listCounterOverride`); ops `setListType`
  (via the `applyOperation` dirty-union channel) and `setListRestart`;
  `newListId`.
- **Numbering service** (`numbering/`, `1.2-render.md`): a general
  render-time `computeCounters` engine + `collectListEvents` collector +
  `listCounterRenumberedBlocks` diff. Pure, render-time-only (no layout
  dependency). Lists are the first consumer; footnotes/custom components
  are intended future consumers.
- **Render** (`1.2-render.md`): full + incremental render compute the
  counter map and expose it via `RenderContext.counterValue`; the
  `list-item` component bakes the bullet/number into `style.markerText`;
  `RenderOutput.listCounters` caches the per-cycle map and the incremental
  path expands `invalidated` by the renumber diff.
- **Layout** (BFC, see `layout/` above): the BFC reads the render-baked
  `markerText` only — it COUNTS nothing. `layout/list-counter.ts` deleted;
  the #426/#431/#418 marker-gutter behaviors preserved.
- **Editing** (`1.7-editor.md`): `TOGGLE_LIST` (flat unified toggle),
  `SET_LIST_TYPE`, `SET_LIST_RESTART`, `LIST_INDENT`/`LIST_OUTDENT`; Enter
  on an empty list-item exits the list; Backspace at offset 0 outdents /
  un-lists; `INDENT`/`OUTDENT` skip list-items (I5); Tab/Shift+Tab route to
  LIST_INDENT/OUTDENT via the context-sensitive key-handler.

Browser smoke for the list editing UX rides the user's in-browser pass
(per the project's browser-verification convention).

### `perf/` `[implemented]`

Flag-gated `markStart` / `markEnd` / `recordSample` / `report` /
`resetPerfTrace`. Markers installed across cascade, layout, paint, and
read-path functions. React example exposes `window.__perfReport()` /
`window.__perfReset()` when a perf fixture is loaded.

### Vertical writing modes (`vertical-rl`, `vertical-lr`) `[partial]`

A cross-cutting feature spanning styles, cascade, layout, and the
editing-geometry layer. The `writingMode` block attribute flows through the
component-set convention (`components/leaf-style-attrs.ts`) into the cascade
(inherited, per `PROPERTY_META`) and layout.

Implemented:
- **Axis arithmetic.** `logicalToPhysical` handles all three modes via an
  exhaustive switch guarded by `assertNeverWritingMode` (a future 4th mode is
  a compile error at every call site); `axisMapFor` exposes which physical
  axis each logical axis maps to, and `physicalToLogical` is the exact
  inverse. See [`1-core/1.0-styles.md`](1-core/1.0-styles.md).
- **Layout.** Block-advancement and inline-extent sites operate on the logical
  `blockSize`/`inlineSize` (not physical `width`/`height`); inline-block sizing
  projects the child's physical box onto the parent IFC's axes via `axisMapFor`;
  the bidi reorder packs visual order into the logical `inlineOffset` so it maps
  to the active physical inline axis. The `vertical-rl` block-axis mirror (`x =
  containingBlockSize − blockOffset − blockSize`), which needs a containing
  block-size that is indefinite at box-factory time, is applied by a post-layout
  `physicalizeVertical` pass at both layout seams (the non-virtual `paginateRoot`
  and the virtual `materializePage`); `horizontal-tb` and `vertical-lr` are a
  reference-identity no-op.
- **Editing geometry.** Caret placement, hit-test (BODY line/leaf pick),
  selection rects, and line-navigation read already-physical box coords through
  `axisMapFor` to operate on the active inline/block axes; the bidi cursor is
  generalized to the inline axis. See [`1-core/1.7-editor.md`](1-core/1.7-editor.md).
- **Border-side mapping.** `physicalBorderSides` resolves logical border/padding
  sides to physical top/right/bottom/left for every (writingMode, direction)
  combo via an exhaustive switch. See [`2-dom/2.2-canvas-renderer.md`](2-dom/2.2-canvas-renderer.md).

Missing (the browser-gated remainder):
- **Glyph rotation for vertical text** — per-run ±90° rotation so a
  horizontal-script run paints downward along the inline axis (`text-orientation:
  upright` for CJK is a future property). The renderer still paints horizontally.
- **Caret-bar orientation** — drawing the caret's block-axis extent as a
  horizontal bar in vertical modes; the caret still draws as a vertical bar.
- **Controller projection** — the DOM controller's projection of the
  inline/block-semantic `PixelPosition` to CSS left/top for vertical modes
  (identity for `horizontal-tb`, so no current divergence there).
- **Slot-zone hit-test** — `pickRegionByBand`'s header/footer/footnote zone
  classification stays on the `horizontal-tb` (vertical-band) path; only the
  BODY hit-test is axis-generalized.

---

## `dom`

### `editor-controller` `[partial]`

Two render modes. **Paginated** is the active primary path: the engine
produces a virtualized page model (`layoutTree: LayoutBox |
VirtualLayoutTree`), which drives a per-page canvas pool with per-page
paint caches; paint, caret, mouse hit-test, and selection rects are
resolved per page via `getPage(visible ∪ cursorPage)` without
materializing the whole tree (the `materializeAll()` bridge survives only
for the rare spanning-block selection fallback — a single block taller
than a page). **Non-paginated single-canvas** is the fallback — one canvas +
a fully-positioned `LayoutBox`, used for identity sizing and the
unsupported-feature path (float/`clear` documents fall back to the legacy
full positioned tree in v1, per the virtualized-layout decision). Input
listeners, key-handler integration, cursor blink, scroll syncing, and
image-cache integration are all present. See
`2-dom/2.1-editor-controller.md` for the virtual page model.

### `canvas-renderer` `[implemented]`

`paintCanvas` and `paintPage` both work. Viewport culling works. Two
paint paths (with cache, without cache) both correct. Root short-circuit
in `walkAndDetectChanges` fires correctly when wired in via the
controller's paint cache. The overlay band is `background → match
highlights → selection → text`: the find-match highlight overlay
(`MatchHighlightRect[]`, #433) paints under the selection tint and under
text, with `addMatchHighlightDirty` per-page dirty marking so a next/prev
(active-index change) repaints. The controller's `setFindHighlights` /
`clearFindHighlights` drive it via a two-stage rect resolution. The
find SESSION + navigation shipped on top: `findStart`/`findNext`/`findPrev`/
`findClose` (returning `FindStatus`) run `findMatches`, highlight + cycle
(wrap) the active match, scroll it into view via the generalized
`scrollVisualIntoView` (without moving the doc cursor), and live-recompute
on every doc edit in `update()`. The controller's replace methods
(`replaceActive` / `replaceAll`) + public `findStatus()` shipped: they
dispatch `REPLACE_MATCH` / `REPLACE_ALL` from the live session and the find
bar polls `findStatus()` each render for the authoritative count (the
post-replace count lands via the live-recompute after the dispatched edit).
`EditorView` exposes them through a `forwardRef` + `useImperativeHandle`
`EditorViewHandle`. The Ctrl+F / Ctrl+H find-bar React UI (the bar component
+ keyboard wiring) is the remaining F&R-UI slice.

Paint strategy is "clear-dirty + full-repaint" rather than true
per-box compositing — the v1 ceiling without a layer compositor.
Selective compositing for cursor + selection layers is a candidate
follow-up.

### `paint-cache` `[implemented]`

`createPaintCache`, per-`LayoutBox` hash storage via `WeakMap`,
last-root tracking, `hashPaintInputs`. Wired into the editor controller.

### `canvas-shaper` `[partial]`

Canvas-based default text shaper. Uniform-direction bidi, UAX #29
grapheme-cluster boundaries (via `Intl.Segmenter` / `graphemeClusters`),
font metrics, and UAX #14 break opportunities (via the `core`
`toBreakOpportunities` adapter over the `layout/uax14` classifier). Paired with a legacy
`canvas-measurer` for callers that still consume the older `TextMeasurer`
interface.

Gaps as documented under `core`'s text section: per-cluster UAX #9 bidi,
complex-script glyph metrics (cluster advances approximate one base width
per grapheme), hyphenation dictionaries. (UAX #14 line-break is no longer
a gap — implemented.)

The earlier inter-word paint/measure mismatch (space advances dropped vs.
measured, observed at P1.B) no longer has a code cause: paint sums
per-cluster `measureText` advances identically to layout (#330), and the
letter/word-spacing slice adds the same per-cluster `clusterSpacing` to both
the shaper advances and the paint loop — so painted glyph origins equal the
laid-out advances by construction (`cluster-paint.test.ts` locks it).

### Other dom helpers `[implemented]`

`key-handler` (DOM keyboard event → `EditorAction` mapping),
`image-cache` (async image loading with re-paint trigger),
`font-config` (font defaults).

---

## `react`

### `use-editor` `[implemented]`

Hook returns the documented record. Reducer wiring works. Config
construction stable across renders.

### `editor-view` `[implemented]`

Mount / update / unmount lifecycle works. Controller wiring works.
React.Profiler instrumentation works.

---

## Examples

### `examples/react/` `[partial]`

Loads, renders the default empty document with two seed paragraphs,
accepts input. Toolbar and menu bar work for basic operations.
Pagination is active (US Letter at 96 DPI, 1-inch margins). Multi-page
documents fragment correctly across pages with content visibly inset
from the page edges.

Known issues:
- The example's perf fixture loader (activated via `?perfFixture=N`
  URL parameter) builds large synthetic documents; the per-page
  canvas-pool virtualization handles thousand-paragraph documents
  without the old single-canvas overflow.

### `examples/dom/` `[partial]`

Vanilla integration demo. Same status profile as `examples/react/`
minus the React-specific pieces.
