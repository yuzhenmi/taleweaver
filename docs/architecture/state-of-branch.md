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
- `fontFeatureSettings` — required by typography phase 1 (P5); resolved into `UsedStyle` but not yet read by any tokenizer/layout/paint consumer. (`textAlign` incl. justify, `textWrap`/`whiteSpace`, `textIndent`, `letterSpacing`/`wordSpacing`, `textTransform`, and `hyphens` are NOW consumed — `letterSpacing`/`wordSpacing` via `layout/text-spacing.ts` (applied in the shapers + IFC trailing-trim + renderer); `textTransform` via the `textTransformInterpreter` cascade interpreter + the IFC's per-token display transform (`layout/text-transform.ts`) + the `SET_TEXT_TRANSFORM` editor action + toolbar; `hyphens` via the manual soft-hyphen producer in the IFC + `tryHyphenSplit` (see `1.6-text.md` Hyphenation, `auto` dictionary still future); `overflowWrap` (net-new, never schema-only) via the IFC `tryEmergencyBreak` last-resort grapheme split + the editor body default (`break-word`; `anywhere` ALSO shipped — same used-layout break, plus the min-content collapse in `intrinsic-sizes-pass.ts`); `tabStops`/`defaultTabStop` (net-new; the former CSS `tabSize` reservation was REMOVED) via the `"tab"` embed + the IFC resolve-at-overflow-check advance (`nextStop`; left/center/right/decimal alignments + default-grid fallback) + `INSERT_TAB`/`SET_TAB_STOPS` editor actions + the Tab key + leader paint (see `1.6-text.md` Tab stops) — so they are no longer schema-only.)
Positioning vocabulary present and consumed (slice 1): `position`, the four
logical `inset*`, `zIndex`, `transform`, `transformOrigin`, `opacity` live in
`styles/position.ts` + `ComputedStyle`, all `inherits: false`. `position:
relative`/`absolute` are consumed by layout (see `layout/` below); `zIndex` is
consumed by paint (slice 4 — z-index / stacking contexts, see DOM below);
`transform` is consumed by BOTH paint (the `paintBox` save/transform/restore via
the shared `layout/mat2d.ts` `fromTransformFns`) AND hit-test (the per-line
three-state `inverseTransform` baked by `collectLineBoxes`, mapped by
`resolvePositionFromPixel`); `opacity` is consumed by paint (slice 6 — offscreen
GROUP compositing: an `opacity < 1` box's whole atomic subtree paints into an
offscreen `<canvas>` and composites once at `globalAlpha`, via `paintOpacityGroup` +
the `offscreen-surface.ts` factory seam; `opacity === 1` takes the zero-alloc
direct path). NO positioning property enters
`UsedStyle` — they are read at their use-sites from `ComputedStyle` (insets
resolved against the containing block where both axis percent bases are
available). See [`1.9-positioning.md`](1-core/1.9-positioning.md).

Schema items genuinely missing:
- `overflow` — required by `establishesNewBFC`'s full check.

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

### Document serialization (`state/serialize/`) `[implemented]`

Pluggable `DocumentSerializer` (one per wire format) + a `SerializerRegistry`
(mirrors the component/attr registries: empty + default-populated factories) +
engine-level `serializeDocument` / `deserializeDocument` dispatch, with
`UnknownSerializerFormatError` on an unregistered format. The v1 built-in is a
LOSSLESS binary serializer (`createBinaryDocumentSerializer`, `BINARY_FORMAT =
"taleweaver-binary"`) backed by Yjs's native update codec
(`Y.encodeStateAsUpdate` / `Y.applyUpdate`): one round-trip over the WHOLE
`Y.Doc` (all three block trees + `listDefs` + `comments` + `suggestions` + `meta` rootId). Decode reads
`rootId` via the state-private `getMetaRootId` and rebuilds `State` with a fresh
(derived) snapshot cache; a decoded doc with no rootId throws
`MalformedDocumentError`. Lives inside `state/` for `STATE_INTERNAL` access; the
barrel surface re-exports through `state/index.ts` and the core barrel. Host owns
persistence (engine = encode→bytes / decode→`State` only). The editor-level
open/save surface has shipped: `exportDocument` / `loadDocument`
(`editor/document-io.ts`, on the core barrel) wrap the engine dispatch —
`loadDocument` deserializes into a FRESH `EditorState` (fresh History + a valid
initial caret via the shared `initialSelectionForState` + full render/cascade/
layout). The format-agnostic core foundation for a human-friendly importer has
shipped: `buildDocumentFromTree` (`state/build-document-from-tree.ts`, on the
state + core barrels) lowers a declarative nested `BlockNode` tree → `State`,
minting ids and DERIVING all structural links — the SAFE public counterpart to
the internal `buildStateFromBlocks`, and the construction target a future
HTML/JSON importer's `decode` builds. The human-friendly HTML serializer itself
has SHIPPED in `packages/dom` — the `taleweaver-html` `DocumentSerializer<string>`
(`html-serializer.ts` + `html-encode.ts` + `html-decode.ts`, on the dom barrel as
`HTML_FORMAT` / `createHtmlDocumentSerializer`). ENCODE is a pure `State` → HTML
walk; DECODE parses with the browser-native `DOMParser` (hence dom, not core) into
a `BlockNode` tree consumed by `buildDocumentFromTree`. It round-trips a
Google-Docs-complete prose + list subset SEMANTICALLY (not id-preserving; binary
owns lossless), dev-warns on dropped content-bearing embeds (footnote-anchor /
cross-reference), and never throws `MalformedDocumentError` (empty body →
single-empty-paragraph doc). Remaining named follow-ups: pairing the wire document
with the rest of editor-session view state (scroll) for full save/restore, a
diff-friendly Markdown/JSON-AST serializer over the same `buildDocumentFromTree`
foundation, v2 + migration path. See
[`1.10-serialization.md`](1-core/1.10-serialization.md),
[`2.5-html-serializer.md`](2-dom/2.5-html-serializer.md), and
[`1.7-editor.md`](1-core/1.7-editor.md).

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
- Positioning (slices 1–6, see [`1.9-positioning.md`](1-core/1.9-positioning.md)):
  `position: relative` resolves a physical `relativeOffset` in the BFC and the
  painter shifts the box + descendants by it (block-level; inline-block-relative
  and caret-for-relative-content are named follow-ups). `position: absolute`
  is laid out OUT of flow via a two-pass
  scheme: the in-flow loop registers the child's static position into the
  nearest absolute containing block (abc — `LayoutContext.absoluteContainingBlock`
  + `ownsAbsoluteContainingBlock` + `originFromAbc`; established by
  `position ∈ {relative,absolute}` or `transform`), and the establishing
  box DRAINS its pending list in a post-loop second pass, resolving each child's
  size/position from `cs.inset*` against the abc and attaching results to
  `box.absoluteChildren` (on `LayoutBoxBase`). Abs content is cursor-reachable
  because `cursor/line-flatten.ts` `collectLineBoxes` descends `absoluteChildren`
  into the flat `LineIndex`. **z-index / stacking contexts (slice 4)** ship in the
  PAINTER (`packages/dom`, see DOM below): `stackingContextRole` on
  `LayoutBoxBase` (computed by the factory from `computedStyle`) drives a CSS 2.2
  §E.2 ordered paint, gated so the no-stacking common path is byte-identical.

Known gaps:
- **Positioning** — ALL functional slices are SHIPPED: `transform` (slice 5) —
  paint apply (`paintBox` save/transform/restore via `layout/mat2d.ts`) +
  per-line inverse hit-test (`collectLineBoxes` bakes a three-state
  `inverseTransform`; `resolvePositionFromPixel` maps the click through it); and
  `opacity` (slice 6) — offscreen GROUP compositing (`paintOpacityGroup` renders an
  `opacity < 1` box's whole atomic subtree into an offscreen `<canvas>` via the
  `offscreen-surface.ts` factory seam and `drawImage`s it once at `globalAlpha`;
  `opacity === 1` takes the zero-alloc direct path). Named
  follow-ups within the shipped slices: transformed-content selection-rect +
  caret geometry stay PRE-transform in v1 (reuse the per-line `Mat2D` forward);
  paginated abs-pos fragmentation (a fragmented box's second pass doesn't
  run, so abs children registered before a break are not drained onto the
  fragment), and an establishing box's own explicit block-size not folded into
  the abc block percent-base (a pre-existing BFC limitation).
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
- Cross-page table header row (`<thead>`) repetition (requires `Display: "table-header-group"` schema addition).

### Multi-column (Format ▸ Columns) `[partial]`

Section-scoped multi-column (the Google-Docs model) is in vocabulary +
plan-threading only. Shipped: the `ColumnConfig` / `ColumnRule` type
vocabulary + `DEFAULT_COLUMN_CONFIG` + `columnConfigsEqual`
(`layout/column-config.ts`); the `resolveColumnConfig` validator that merges
a section's stamped `columnCount` / `columnGap` / `columnRule` metadata over a
doc default (`layout/section-column-config.ts`); the `section` component
stamping those attrs RAW into `ElementBox` metadata; and `section-plan`
threading the resolved config onto `SectionBoundary.columnConfig` /
`SectionStateAt.columnConfig`, stamped only when it differs from the doc
default (the no-override path stays inert), plus exposing the resolved
doc-wide default as the required `SectionPlan.effectiveDefaultColumns` (the
fallback slice 2 reads for boundaries with no override) — exactly mirroring
the per-section `PageConfig` machinery.

The `ColumnBreakToken` resume-token vocabulary has also landed: a new
`"column"` member of the `BreakToken` union (`{ resumeColumnIndex,
resumeChildToken }`) plus its `breakTokensEqual` arm (compares the column
index and recurses into the inner BFC child token). This is the LOAD-BEARING
shared predicate the incremental reuse gates use. The measure pass's
`fitColumnsOnPage` now emits a `ColumnBreakToken` to carry last-column overflow
forward to the next page's column 0.

The `MultiColumnBox` `LayoutBox` variant has landed too: a new
`type:"multicolumn"` union member with `columns: readonly BlockBox[]` (N
side-by-side column boxes, each a contiguous doc-order run), `createMultiColumnBox`
factory, and a `"multicolumn"` arm at every generic box-walking site that descends
`columns` as a container — `rebuildBoxWithOffsets`, `collectLineBoxes` /
`collectLeavesRec` (which also STAMP `AbsoluteLineBox.columnIndex` per column —
read later by hit-test/line-nav), `cursor-position`, `table-cell-at-point`,
`physicalize-vertical`, the canvas painter (`paintBox` + `walkAndDetectChanges`),
and `paint-cache`. `collectLineBoxes` descending columns left-to-right gives the
visual-reading-order guarantee for free. `materializePage` constructs a
`MultiColumnBox` for every multicol page (see the wiring paragraph below).

The pure FILL core has also landed: `fitColumnsOnPage` (`layout/column-fit.ts`)
distributes one multicol page's content across N equal-height columns by chaining
the existing pure `fitOnePage` per column (column k+1 resumes where column k
stopped — the contiguous doc-order runs that make the slice-2b visual-order
guarantee hold), honoring the section cap, leaving short-content trailing columns
empty, and wrapping last-column overflow in a `ColumnBreakToken` for the next
page. Pure (operates on cached `BlockFitMeta`, positions no boxes); `columnCount
=== 1` reduces to a single `fitOnePage`, so single-column pages are unaffected.
The measure pass dispatches it for every multicol page and stamps the per-column
`columnFit` + `balancedColumnHeight` on the `PagePlanEntry`.

The final-page BALANCE refinement (`column-fill: balance`, the Google-Docs/Word
parity behavior — v1, not optional) has also landed: `balanceColumnHeight`
(same module) returns the minimal column height that evens a section's final
page, via a binary search over a monotonic STABLE-FIT oracle (content packs into
≤ N columns AND no column overflows past the trial height — the second clause
defeats the forced-single-box rule that would otherwise collapse the height to
~0). This evens short content instead of dumping it into column 0 and leaving
column 1 empty. Pure; the caller fits at the returned height. The measure pass
calls it on a section's final page and re-fits the columns at the balanced
height, recording it as `PagePlanEntry.balancedColumnHeight`. The footnote sweep
(`resolveFootnotes`) applies the SAME balance to a footnote-bearing final multicol
page (T4b): after convergence settles the slot, a final multicol page
(`fit.columnFit.pageResumeOut === null` read pre-F-1-synth, content exhausted at or
past the section boundary) re-balances at the SLOT-REDUCED body height
(`pageContentBlockSize − footnoteSlotHeight`) so a page does not lose its balance
the moment a footnote lands on it. A footnote-cap-tightened page is not final (its
content ends at `footnoteCap < sectionEnd`), so it is correctly skipped; balance only
redistributes already-placed children, so the converged slot is unchanged. The reuse
path carries the prior entry's already-balanced `columnFit`/`balancedColumnHeight`.

Wiring has begun: `PagePlanEntry.columnConfig` (the measure pass's per-page
effective `ColumnConfig`, resolved from `sectionStateAt(...).columnConfig ??
sectionPlan.effectiveDefaultColumns`, mirroring the per-page `pageConfig`) is now
stamped on every page-plan entry by both `measurePass` and `resolveFootnotes`, and
participates in BOTH reuse gates: the measure pass's inline per-entry reuse
predicate (via `columnConfigsEqual(effColCfg, reusable.columnConfig)`, beside the
`pageConfig` gate) and the cross-tree `PageFingerprint` (a `columnConfig` field
compared by `columnConfigsEqual` in `fingerprintsEqual`). A column-config change
between cycles therefore refuses per-page reuse and re-materializes the page —
exactly as a `pageConfig` change does.

`materializePage` (`getPage`) builds the `MultiColumnBox` for every multicol
page: it lays the cascaded root into N side-by-side column tracks (each at
`trackInlineSize = (bodyInlineSize − (N−1)·gap)/N`), seeding each column from its
`ColumnFit.resumeInto` inner token at the `balancedColumnHeight`, and wraps them
in a `MultiColumnBox` sized to the full content inline width × the balanced
column height. A dev-only assert compares each materialized column's resume-out
token to the planned `ColumnFit.resumeOut` (`breakTokensEqual`) to catch
measure-vs-materialize drift. A single-column page is byte-identical to the
pre-multicol body box. The `MultiColumnBox` flows downstream like any container
body box (the `"multicolumn"` walker arms descend `columns`). The box also carries
the section's resolved `columnRule: ColumnRule | null` (threaded from
`entry.columnConfig.columnRule`), which the painter consumes (see column-rule paint
below).

Column-rule PAINT has landed: the canvas painter's `"multicolumn"` arm, after
descending the columns, draws the `column-rule` (CSS `column-rule`) in the
BACKGROUND phase (the same phase as `paintBorders`, so it paints exactly once and
never double-paints across the foreground pass). For each adjacent column pair it
fills a rule rect centered in the inter-column gap, spanning the `MultiColumnBox`'s
block extent (NOT the column's own — an empty trailing column has `blockSize 0`).
The inline axis is derived from `box.writingMode` (horizontal-tb ⇒ a vertical line
along physical X; vertical modes ⇒ a horizontal line along physical Y). Like
`paintBorders`, it draws a solid `fillRect` for any non-`none` style (no dash/dot
rendering) and the gate (`columnRule !== null && width > 0 && style !== "none"`)
short-circuits the common no-rule case at zero overhead.

Column-aware CURSOR has landed. HIT-TEST (slice 3a): `column-at-point.ts`
(`locateColumnAtPoint`) finds the clicked column's physical rect, and `hit-test.ts`
restricts the candidate lines to that rect BEFORE the block-axis band-pick —
mirroring the `table-cell-at-point` restriction — so a click in column B at a Y
shared with column A resolves into column B's line (the column filter composes with
the table-cell filter, column-first). LINE-NAV (slice 3b): the up/down target line
is already selected in visual column-flow order (the LineIndex orders multicol lines
[col0 top→bottom, col1 top→bottom]); `resolveTargetLine` now CLAMPS the preserved
inline goal to the target line's own inline extent before the hit-test, so a
cross-column ArrowDown/Up lands on the selected target's column instead of re-picking
a source-column line (it returns the ORIGINAL goal so Up-undoes-Down returns to the
original column). Both are no-ops for single-column pages.

User-reachable multicol has landed (slice 5): the `SET_SECTION_COLUMNS` editor
action sets `columnCount`/`columnGap`/`columnRule` on the active section (or, for a
section-less doc, on the doc root → whole-doc columns via the document component
stamping its column attrs onto `cascadedRoot.metadata`, which `buildSectionPlan`
reads into `effectiveDefaultColumns`); `columnCount: 1` is the explicit
single-column state. It mirrors `TOGGLE_SECTION_LANDSCAPE` (shared
`resolveActiveSection` parent-walk helper, T7 identity guard, one undo unit) and is
wired into the example-app toolbar (1 / 2 / 3-column buttons).

Multi-column is now feature-complete end-to-end (measure → materialize → paint →
cursor → user-action → column-rule → footnote-final-page balance). The remaining
gap is browser smoke verification (T6).

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
- **Manual hyphenation** (`hyphens: manual`, the cascade default — authored
  U+00AD SOFT HYPHENs) is `[implemented]` end-to-end: zero-advance soft hyphen,
  the IFC producer that synthesizes `hyphenBreaks`, `none`-suppression, the
  `tryHyphenSplit` "-" glyph, and the D.4 hyphen-pair page-break back-off (see
  `1.6-text.md` Hyphenation). **Dictionary `auto` hyphenation** is not loaded;
  `hyphens: auto` falls back to `manual` (honor soft hyphens, no automatic breaks)
  regardless of language — the correct CSS-UA behavior when no hyphenation resource
  exists, not a degraded build.
- **Tab stops** are `[implemented]` end-to-end, modeled the Google-Docs way (a
  paragraph stop list, NOT CSS `tab-size` — the former `tabSize` reservation was
  REMOVED). A `tabStops` block-attr (`{position, alignment: left|center|right|decimal,
  leader: none|dot|dash|line}`) + a scalar `defaultTabStop` (px, default 48 = 0.5in,
  inherits) cascade onto `ComputedStyle`/`UsedStyle`. A tab is the `"tab"` inline
  EMBED (atomic, one offset), so caret/click/selection/bidi reuse the inline-block
  leaf path with no tab-specific cursor code. The IFC resolves each tab's
  position-dependent advance at the wrap-loop overflow-check seam (`nextStop`;
  left/default-grid + bounded look-ahead for right/center/decimal) and freezes it
  onto a fixed-width inline-block box carrying `inlineMeta = {embedType:"tab"; leader}`;
  the `IFCState` cache gates on `tabStops`/`defaultTabStop` and a `hasTab` flag bypasses
  the incremental fast path. Pressing **Tab** inserts the embed (`INSERT_TAB`, discrete
  undo) except when the caret is in a list-item block at any offset (Tab/Shift+Tab →
  `LIST_INDENT`/`LIST_OUTDENT`);
  `SET_TAB_STOPS` sets the stop list. Tab lines are not justify-stretched; leaders paint
  in the renderer's inline-block branch (see `1.6-text.md` Tab stops). OUT follow-ups:
  ruler UI, bar tabs, locale decimal separator, per-segment justify, and `SET_TAB_STOPS`
  inside embed/template bodies.

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
- **Cursor placement within a word broken across lines** — `[implemented]` for BOTH
  within-word split paths: (1) manual hyphenation — a word splits at an authored
  U+00AD SOFT HYPHEN (`hyphens` defaults to `manual`); the soft hyphen is a real
  1-unit source char that stays in the offset↔x map despite zero width
  (offsets before/after share an x); behavior-tested in `cursor/soft-hyphen-caret.test.ts`.
  (2) `overflow-wrap: break-word` — a long unbreakable word splits at a grapheme
  boundary (the editor BODY default for Google-Docs parity); the split is an
  ordinary token split with contiguous source offsets (no inserted char);
  behavior-tested in `cursor/overflow-wrap-caret.test.ts`. `overflow-wrap: anywhere`
  ALSO ships: identical used-layout break to `break-word`, plus it collapses
  min-content to the widest single grapheme (`intrinsic-sizes-pass.ts`) so a
  shrink-to-fit / inline-block box can narrow to one cluster. Remaining gaps:
  dictionary `auto` hyphenation and `word-break: break-all/keep-all` are future
  features. (The
  mock/canvas shapers classify U+00AD as `kind:"soft"`; the IFC synthesizes the
  `hyphen`-kind opportunity, so the manual path does not depend on the shaper
  emitting `kind:"hyphen"`.)

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

### Cross-references `[implemented]`

The Google-Docs reference field (NOT CSS `target-counter`) is shipped
end-to-end for v1: an inline `cross-reference` `EmbedItem`
(`properties: { targetId, refMode }`) that displays a target's number or
text and auto-updates. v1 supports `refMode: "number" | "text"` against
MAIN-tree targets; page-number / heading-number / bookmark / caption
references are deferred. Built on the render-time numbering service.

- **State** (`1.1-state.md`): `insertCrossReference` op + the
  `cross-reference` embed type (`CrossReferenceMode`); a POINTER that owns
  no body (cascade scanners ignore it); `clonePastedSubtree` remaps a copied
  ref's `targetId` when the target is in the clone set, else preserves it. A
  dangling target is a legal state.
- **Render** (`1.2-render.md`): `resolveCrossReference` (number → numbering
  map; text → `extractText`; broken-ref otherwise); `expandInlineItems`
  renders the field as a one-token inline-block atom (the offset-accounting
  invariant); `buildCrossReferenceIndex` (`targetId → hosts`) on
  `RenderOutput.crossReferenceIndex`, reused + invalidation-expanded on the
  incremental path so a target edit/delete/renumber re-renders its hosts.
- **Editing** (`1.7-editor.md`): `INSERT_CROSS_REFERENCE` action + handler
  with structural target validation (main-body caret, main-tree target,
  ordered list-item for `"number"`, inline-bearing for `"text"`); a "command"
  undo unit.

A non-collapsed selection is replaced on insert (deleted then the field spliced
at the collapse point, one undo step) via the shared `prepareEmbedInsertPoint`
helper — which also fixed the same gap in `INSERT_FOOTNOTE`. Deferred follow-ups:
page-mode (layout-dependent), heading-number references (needs heading
numbering), footnote-number references, bookmarks, captions. Browser smoke of
the live insertion UX rides the user's in-browser pass.

### Layout-dependent page-fields `[implemented]` (browser smoke pending)

Header/footer **page-number** + document-global **page-count** fields that read
PAGINATED layout results. A `page-field` inline-block embed renders a page-agnostic
placeholder (`PAGE_FIELD_RESERVED_GLYPHS` reserved sizing glyphs at one offset / one
IFC token, #407); the value is bound LATE at materialize (the FN-6.2b precedent),
NOT at render. Built browser-independently F-0…F-4; the toolbar buttons + in-browser
visual smoke ride the user's pass.

- **State** (`1.1-state.md`): `insertPageField` op + the `page-field` embed type
  (`PageFieldKind` = `"page-number" | "page-count"`; `PageFieldNumberStyle`); a
  POINTER that owns no body (cascade scanners ignore it). Routes the write to the
  caret's owning tree via `resolveBlock`, so it can land in a header/footer body.
- **Render** (`1.2-render.md`): `expandInlineItems` emits the placeholder atom +
  `metadata.{embedType, fieldKind, numberStyle}` (page-agnostic).
- **Layout** (`1.5-pagination.md`): `collectPageFields` (cascaded render trees →
  `FieldSpec[]` keyed by render key) → `resolvePageFields` (post-pagination;
  page-count from `plan.entries.length`; per-field max widths) → `substitutePageFields`
  at materialize (spine-clone leaf value substitution, identity-preserving; the §4.5
  fingerprint fold busts a page on a value change) → the §4.4 bounded width-convergence
  loop (`field-convergence.ts` + `patch-field-widths.ts`) that grows a template
  field's reservation + re-runs the CHEAP measure passes when a wide value would wrap
  the header (the value→wrap→slot-height→page-count→value fixpoint), 2-cycle-pinned.
- **Editing** (`1.7-editor.md`): `INSERT_PAGE_NUMBER` / `INSERT_PAGE_COUNT` action +
  handler, gated to a `templateContent` (header/footer) context — a no-op in the main
  body and footnote bodies (main-body page-fields are out of scope; the editor entry
  DIVERGES from the cross-reference handler's main-body-only gate). A "command" undo unit.

Out of scope (named follow-ups): main-body / footnote-body page-fields (not creatable
via the editor), page-number-mode cross-references, table of contents.

### Comments `[implemented]`

Google-Docs anchored comments are shipped end-to-end for the v1 main-body entry
surface: select a range, add a comment thread (author / body / replies /
resolved), the range highlights, and the anchor survives arbitrary edits
(typing / delete / split / merge / paste) — orphaning when the whole anchored
range is deleted.

- **Anchor** (`1.1-state.md`): paired zero-width `comment-start` / `comment-end`
  marker `EmbedItem`s in inline content, each carrying `properties.commentId`.
  Markers ARE content, so existing ops move/clone them for free (a slice-0 spike
  rejected Yjs `RelativePosition`, which orphaned on delete/split/merge). Each
  marker is one offset / one cursor stop, renders as a zero-width inline-block
  atom, serializes to `""` (excluded from `extractText`/`getWordCount`), and is
  STRIPPED on paste. Orphaning is DERIVED by the `buildCommentRangeIndex` marker
  scan (no eager hook).
- **Data** (`1.1-state.md`): the `comments` Y.Map — the 5th top-level map
  (side-table like `listDefs`, NOT in `TREE_MAP_GETTERS`), keyed by `CommentId`;
  `CommentRecord` with `replies` a `Y.Array<Y.Map>` (CRDT-mergeable). Comment ops
  (`addComment` / `resolveComment` / `reopenComment` / `deleteComment` /
  `addReply`, + `getComments`) are NORMAL tracked content ops; the `comments` map
  is the 5th `Y.UndoManager` scope, so a comment is UNDOABLE AS CONTENT (a
  deliberate, documented GDocs deviation forced by the marker-anchor + collab-safe
  via per-origin undo). Side-table-only ops surface `state.rootId` as the dirtyId
  so they land a committable/undoable entry.
- **Editing** (`1.7-editor.md`): `ADD_COMMENT` / `RESOLVE_COMMENT` /
  `REOPEN_COMMENT` / `DELETE_COMMENT` / `ADD_REPLY` actions (all `"command"` undo
  units; host-injected ids + timestamps). `ADD_COMMENT` no-ops on collapsed /
  cross-context / non-main-body selections, inserts end- then start-marker, and
  preserves the visible selection across the +2 marker offsets.
- **Geometry + overlay**: `getCommentRangeRects` (`cursor/comment-rects.ts`) is the
  STANDALONE (non-paginated / external-host) query — it takes a single positioned
  `LayoutBox`. The bundled DOM host does NOT call it: under the virtualized layout
  it has no whole-document `LayoutBox`, so its overlay resolves highlights PER PAGE
  in the controller (`resolveCommentHighlights` / `commentHighlightsForPage` →
  `resolveCommentRange` + `computeSelectionRectsForPage`), painted via
  `setCommentHighlights` / `clearCommentHighlights` (`2.1-editor-controller.md` /
  `2.2-canvas-renderer.md`) — a host-driven amber band, two-stage resolve mirroring
  find, re-resolved from live state each `update()` (self-healing). Both paths share
  `resolveCommentRange` + the selection-geometry core, so they agree.
- **Serialization** (`1.10-serialization.md`): the binary serializer round-trips
  comments + markers losslessly with no comment-specific code (verified by a
  `serialize-document.test.ts` case).

Named follow-ups (separable wholes, NOT degradations): commenting inside
footnote / header / footer bodies (the entry surface — v1 `ADD_COMMENT` is
main-body-only, the find-searches-main-tree parallel; the marker scan is already
tree-complete); the thread-panel UI (a host concern; the engine provides the
queries above); @-mentions / reactions / non-text anchors; the `taleweaver-html`
serializer dropping comments. Browser smoke of the live add/highlight/orphan UX
rides the user's in-browser pass.

### Change-tracking / Suggesting mode `[partial]`

Google-Docs "Suggesting" mode (every edit becomes a tracked, attributed,
accept/reject-able suggestion) is UNDER CONSTRUCTION — design-review-clean spec
(`docs/superpowers/specs/2026-06-09-change-tracking-design.md`), foundations-first
7-slice plan. **Slice 1 (state vocabulary) shipped:** the `suggestions` Y.Map — the
6th top-level side-table (NOT in `TREE_MAP_GETTERS`, the 6th `Y.UndoManager`
scope), `SuggestionId`/`SuggestionKind`/`SuggestionRecord` + record IO; the THREE
independent inline-attr dimensions (`insertionSuggestionId` / `deletionSuggestionId`
/ `formattingSuggestionId` — a char can be all three at once, dissolving the
overlap problem); the two zero-width break embeds (`block-join-suggestion` /
`block-split-suggestion`, one IFC token each, serialize to `""`); binary
serialize round-trip. Slice 1 is INERT vocabulary — no editor action / op / render
behavior yet. **Slice 2 (range index + read + Layer-1 hooks) shipped:**
`buildSuggestionRangeIndex` / `resolveSuggestionRange` / `getSuggestions(state) →
ResolvedSuggestion[]` (orphaned-by-absence derived); the optional `origin` param on
BOTH `applyOperation` and `runTransaction` (→ `doc.transact(fn, origin)`) +
`SUGGESTION_RESOLVE_ORIGIN`; `History.advanceState(newState)` (advance
`currentState` only) for the non-undoable accept/reject path. **Slice 3a
(`markFormatting`) shipped:** the first suggestion-CREATION op in
`state/ops/suggestion-ops.ts` — stamps `formattingSuggestionId` over a span +
writes a `formatting` record with `proposedAttrs` in one tracked `applyOperation`
(one undo unit; live attrs untouched; same-author/same-proposal adjacency
coalesces by id reuse). **Slice 3b (`markDeletion`) shipped:** soft-delete a span's
text (stamp `deletionSuggestionId`, text stays visible) via a per-owning-block
full-replace rewrite (NOT `applyAttrsToRangeInTx`), with the delete-own-insertion
(your own pending insertion → real remove, in-range only) + nesting (different-
author insertion also gains the deletion id) + same-author coalescing rules; embeds
in-span preserved untagged (named follow-up). **Slice 3c (`mintInsertion`) shipped:**
the INSERT_TEXT/PASTE suggesting-mode op — inserts text carrying
`insertionSuggestionId` (composing `planInsertText`/`insertTextInTx`) + writes an
`insertion` record, with insertion-point coalescing (same-author adjacent insertion
→ reuse id, before-preferred) so a continuous typing run is one suggestion.
**Slice 3d-i (`acceptSuggestion`/`rejectSuggestion`) shipped:** the single-id
RESOLVE ops, dispatching by record `kind` (spec §6: accept-insertion strip /
reject-insertion drop / accept-deletion drop / reject-deletion strip /
accept-formatting apply-proposed+strip / reject-formatting strip), each a
**NON-undoable** `applyOperation(...,{origin:SUGGESTION_RESOLVE_ORIGIN})` that
deletes the record (per-owning-block full-replace; the editor handler calls
`History.advanceState` after). **Slice 3d-ii (`acceptAll`/`rejectAll`) shipped:**
resolve EVERY suggestion in one non-undoable txn via a COMBINED per-block rewrite
(a run can carry insertion+deletion+formatting at once, so each block is walked once
with a dominance order — acceptAll: deletion-drop dominates; rejectAll: insertion-
drop dominates; a both-insertion-and-deletion run is dropped under both). **With
3d-ii, ALL of change-tracking slice 3 (the state ops) is COMPLETE: create
(markFormatting/markDeletion/mintInsertion) + resolve (accept/reject single + all).**
**Multi-tree resolution (MT) — COMPLETE:** MT-1 shipped `iterateAllBlocksInDocumentOrder`
(state/document-order.ts) — a 3-tree document-order walk (main `blocks`, then each
`embedContents` body, then each `templateContents` body) over the per-root subtree
resolver. MT-2 shipped — `buildSuggestionRangeIndex` (the range index feeding
`resolveSuggestionRange` + the host overlay) now walks all three trees, so a suggestion
tagged in a footnote/header/footer body resolves to its body span instead of returning
null. MT-3 shipped — the accept/reject resolve scan (`resolveBlockScan` in
suggestion-ops.ts) now walks all three trees too, and each per-block full-replace write
already carries its owning block's tree `kind` (from `resolveBlock`), so a body suggestion
is accepted/rejected in-place in its body tree instead of being left as an un-resolvable
zombie. MT-4 shipped — the editor's suggesting-mode gate
(`suggestionInputForBlock`/`replaceSuggestionInputForBlock`/`isSuggestingInBlock` in
`editor/actions/suggestion-mode.ts`) relaxed from `selectionContextOf(...) !== state.rootId`
(main-body-only) to `=== null` (track in EVERY editing context; fall back only for a block
that resolves to no context). All structural suggesting paths were verified tree-safe —
SPLIT_NODE → `splitWithSuggestion`/`splitBlockAtPositionInTx` (`kind`-dispatched), the
paragraph-boundary JOIN → `markBlockJoinSuggestion` (appends via `getYBlock(..., prev.kind)`),
and accept-time merge → `mergeWithNextSiblingLiveInTx(d, owner.ownerId, owner.kind)`. So a
suggesting-mode INSERT_TEXT/delete/format/SPLIT_NODE inside a footnote/header/footer/template
body is now TRACKED and accept/reject-all resolves it cleanly (no zombie) — covered by
`suggesting-body-tracked.test.ts`. The former main-body gate (slice-4-followup) is gone. **Slice 4 (editor
actions + suggesting mode) IN PROGRESS, sub-sliced 4a–4e:** 4a shipped — the 4
NON-undoable accept/reject editor actions (`ACCEPT_SUGGESTION`/`REJECT_SUGGESTION`/
`ACCEPT_ALL_SUGGESTIONS`/`REJECT_ALL_SUGGESTIONS`) via a new `"resolve"` ActionClass
(breaks the open undo group, `advanceState` not commit). 4b shipped —
`EditorConfig.suggestingAuthor` + `newSuggestionId`/`newSuggestionInput` + the
`INSERT_TEXT` collapsed-caret branch → `mintInsertion`. 4c-i shipped — `DELETE_BACKWARD`
SOFT-deletes via the `deleteRangeOrSuggest` helper (`suggestion-mode.ts` → `markDeletion`)
on the EXPANDED-selection and collapsed MID-BLOCK-char paths (caret = span start,
undoable); a block-start backspace at a PLAIN paragraph boundary marks a suggested
JOIN (slice 4e-editor below), while list-outdent / atomic-leaf delete keep their
untracked behavior.
4c-ii shipped — `DELETE_FORWARD` SOFT-deletes via the same `deleteRangeOrSuggest`
helper on the EXPANDED-selection and collapsed MID-BLOCK-char paths, but the caret
advances to the span END (not span start) so repeated Delete strikes successive
chars; a forward delete at a PLAIN paragraph boundary marks a suggested JOIN (slice
4e-editor below), while section-break removal / atomic-leaf delete keep their
untracked behavior.
4c-iii shipped — `DELETE_WORD` + `DELETE_LINE` SOFT-delete via the same
`deleteRangeOrSuggest` helper on their EXPANDED-selection and collapsed
word-span / line paths, completing the delete-handler suggesting wiring (all four:
backward / forward / word / line). DELETE_WORD applies the directional caret rule
(forward → span END `target` so repeated word-delete strikes the NEXT word; backward
→ span START `target`); DELETE_LINE is backward-only (caret at line start in both
modes). Both are structurally simple — cross-block delete is already a no-op in both
modes, so no structural gate.
**Slice 4d-state (`replaceWithSuggestion`) shipped:** the STATE op for type-over-
selection in suggesting mode (the suggestion analog of `replaceRange`) — soft-deletes
the selection AND inserts new text at the selection start in ONE transaction,
producing TWO records (an insertion + a deletion sharing `createdAt` as the render
"replace" grouping signal). Built by extracting the strike's pure `planMarkDeletion`
out of `markDeletion` (behavior-preserving) and composing it with
`planInsertTextFullReplace` against the POST-strike start-block items (same
full-replace hazard as `replaceRange`). Degenerate inputs delegate to
`markDeletion` (empty text) / `mintInsertion` (collapsed span).
**Slice 4d-editor shipped:** `handleInsertText`'s expanded-selection branch routes
type-over-a-selection in suggesting mode through `replaceWithSuggestion` (via
`newReplaceSuggestionInput` in `suggestion-mode.ts`) — soft-deletes the selection +
inserts the text as a tracked insertion at the selection start in ONE undoable op;
caret = `start.offset + text.length`. Direct mode keeps the destructive `replaceRange`.
**PASTE-as-suggestion SHIPPED (PF-3):** `handlePaste` in suggesting mode routes the
whole paste through `replaceWithSuggestedFragment` (the multi-block fragment composite
— see the change-tracking REMAINING block below) instead of a destructive replace.
**Slice 4d-format shipped:** all 8 inline-format handlers (`TOGGLE_STYLE`,
`SET_TEXT_COLOR`, `SET_HIGHLIGHT`, `SET_FONT_SIZE`, `SET_FONT_FAMILY`, `SET_LINK`,
`SET_TEXT_TRANSFORM`, `CLEAR_FORMATTING`) are now suggesting-aware via the shared
`applyAttrsOrSuggest` helper (`suggestion-mode.ts`, mirroring `deleteRangeOrSuggest`):
direct mode keeps live `applyAttrsToRange`; suggesting mode routes through
`markFormatting`, stamping a `formattingSuggestionId` + a `formatting` record with
`proposedAttrs` (the delta the action would have applied — incl. toggle-OFF
`{ bold: undefined }` and `CLEAR_FORMATTING`'s clear-all delta); the LIVE attrs stay
unchanged until ACCEPT. `INLINE_FORMAT_ATTR_KEYS` is a curated allow-list, so a
direct `CLEAR_FORMATTING` never strips a suggestion-provenance id.
**Slice 4e-state-split (`splitWithSuggestion`) shipped:** the STATE op for a
suggested paragraph SPLIT (Enter in suggesting mode), building on the shipped
`block-split-suggestion` embed. It performs a REAL `splitBlockAtPosition` (both
halves immediately real/laid-out/navigable) AND appends a zero-width
`block-split-suggestion` embed at the END of the first block carrying the owning
`suggestionId` in its `properties`, plus an `insertion` `SuggestionRecord` — ALL in
ONE transaction (one undo entry). Composes `planSplitBlockAtPosition` +
`splitBlockAtPositionInTx` (for the structural split + canonical validation) with a
full-replace of block N's content (`[0, offset)` + the break embed, the embed staying
the LAST item via the merge-barrier rule); the full-replace supersedes the split's
in-place write to N, leaving N+1 + sibling rewiring untouched. No coalescing (each
Enter is a discrete suggestion). The break embed occupies exactly ONE offset and
serializes to `""`. RESOLUTION (accept removes embed / reject re-merges) is a later
slice. This begins the break-suggestion CREATE side; the block-JOIN (break-delete)
embed and the SPLIT_NODE/break-delete editor wiring follow in slices 4e-state-join
and 4e-editor (below).

**Slice 4e-state-join (`markBlockJoinSuggestion`) shipped:** the STATE op for a
suggested paragraph JOIN (Backspace at block-start / Delete at block-end in suggesting
mode) — the symmetric mirror of `splitWithSuggestion`, but simpler: it does NOT merge
the two blocks. It marks the break BEFORE `secondBlockId` (the boundary with its prev
sibling, block N) as a suggested DELETION by appending a zero-width
`block-join-suggestion` embed at the END of block N carrying the owning `suggestionId`
in its `properties`, plus a `deletion` `SuggestionRecord` — ALL in ONE transaction (one
undo entry, a single block write — no structural change). Both paragraphs stay REAL
separate, linked blocks while the deletion is pending (Google Docs). The embed occupies
exactly ONE offset, serializes to `""`, and stays the LAST item via the merge-barrier
rule. Identity no-op when there is no boundary to mark (block missing / first-child /
container N). No coalescing (each break is a discrete suggestion). RESOLUTION (accept
merges the blocks / reject removes the embed) lands in `resolve` (slice 4e-resolve-single).
The break-suggestion CREATE side now covers BOTH split and join; the SPLIT_NODE/break-delete
editor wiring lands in slice 4e-editor (below).
**Slice 4e-resolve-single shipped:** single-suggestion break RESOLUTION extends the
shared `resolve(state, id, mode)` (used by `acceptSuggestion`/`rejectSuggestion`) to
handle the two break embeds additively. The scan drops a `block-split-suggestion` /
`block-join-suggestion` embed carrying the resolved id (ALWAYS, all four cases) via the
existing per-block full-replace, recording its owning block N as a merge owner; after the
writes, when `(insertion && reject) || (deletion && accept)` — split-reject UNDOES the
split, join-accept DOES the join — it MERGES N with its next sibling N+1 via the live
`mergeWithNextSiblingLiveInTx` primitive (the same one `resolveAll` uses), run in the SAME
non-undoable transaction AFTER the phase-1 writes (which dropped the embed). The live
helper reads N's CURRENT next sibling off the Y.Doc and defensively SKIPS a moved/absent/
non-leaf boundary — subsuming the earlier hand-written pre-tx merge-validity guard.
Split-accept and join-reject keep the blocks split. The text-run resolution path is
byte-identical (the embed branch is purely additive). NOTE: `resolve` and `resolveAll`
share one engine — `resolveBlockScan` (doc-order scan → per-block writes + merge owners)
+ `runResolve` (the non-undoable write/merge/delete-records tail) — differing only in the
per-item `classify` callback (single-id vs all-ids) and the id set deleted.

**Slice 4e-resolve-all shipped:** the BULK break RESOLUTION extends `resolveAll(state, mode)`
(used by `acceptAll`/`rejectAll`) symmetrically: the scan DROPS every break embed (a non-break
embed is kept) and, when `(insertion && reject) || (deletion && accept)`, records the owning
block N as a merge owner (in document order, since the scan is document-ordered). Phase-2 then
walks the merge owners in REVERSE document order and merges each via the new
`mergeWithNextSiblingLiveInTx` primitive (`merge-blocks.ts`), which reads the owner's CURRENT
next sibling + that sibling's next id LIVE from the Y.Doc inside the open transaction (NOT a
pre-tx plan). This solves the CASCADE: a run of consecutive owners merging in one tx (e.g.
rejectAll over three consecutive splits → ONE block) cannot use pre-computed `nextSiblingId`s
(an earlier merge invalidates a later block's); reverse order keeps each owner alive when
processed, and live reads reflect the prior merges. The live helper is a no-op on a no-next /
moved-boundary owner (defensive skip). Break resolution is now COMPLETE (single + bulk).

**Slice 4e-editor shipped:** the break-suggestion EDITOR wiring (collapsed cases). On a
COLLAPSED Enter, `handleSplitNode` routes through `splitWithSuggestion` when
suggesting (`suggestionInputForBlock`, all-context — see MT-4 above) — a tracked INSERTION of a paragraph break (real
split + a `block-split-suggestion` embed on block N + an `insertion` record, one
undoable op); the cursor / commit / rebuild path is byte-identical to the direct
split, and the heading follow-on-type (`newBlockInit`) is threaded through. On the delete side, the blanket block-boundary suggesting
NO-OP gate was REMOVED from `handleDeleteBackward` / `handleDeleteForward` (reordered
after the list-item / atomic-leaf / section-merge branches, which keep their current
untracked behavior in suggesting mode); at a PLAIN paragraph↔paragraph boundary the
real `mergeAdjacentBlocks` is replaced by `markBlockJoinSuggestion` (a
`block-join-suggestion` embed on the preceding block + a `deletion` record, blocks stay
SEPARATE, caret unchanged, one undoable op). list/atomic/section boundary-as-suggestion are explicit
follow-ups.

**Slice 4e-editor-composite shipped (slice 4e COMPLETE):** the SPLIT_NODE non-collapsed
Enter-over-selection composite. In suggesting mode a SINGLE-BLOCK non-collapsed Enter now
routes through the new state op `splitWithSuggestionOverSelection` (via
`newReplaceSuggestionInput`): it SOFT-deletes the selection (`deletionSuggestionId`, text
stays) THEN inserts a suggested split AFTER it (real split + `block-split-suggestion` embed
on N at the POST-strike offset — robust to own-insertion removal shortening the block) +
both records (a `deletion` + an `insertion` sharing `createdAt`), in ONE undoable op; caret
→ newBlock:0, heading follow-on computed at the selection END. The cross-context guard +
collapse-point run ONCE for both modes; the direct-mode path keeps its byte-identical
`deleteRange`+collapse behavior. A CROSS-block non-collapsed Enter in suggesting mode is
TRACKED (PF-4): it routes through `replaceWithSuggestedFragment` with an EMPTY two-line break
fragment — soft-deleting the cross-block selection (struck + a `block-join-suggestion` per
crossed boundary) and inserting the suggested split in ONE undoable op; accept removes the
selection + leaves one break, reject restores the original blocks. The single-block path stays
on `splitWithSuggestionOverSelection` (struck text rides BEFORE the break vs the fragment's
AFTER — not interchangeable). Slice 4e + PF (paste/cross-block-Enter as suggestion) are COMPLETE
(create + resolve + editor + composite + multi-block fragment).
**Slice 4-followup → SUPERSEDED by MT-4 (Finding 3a closed both ways):** the interim
main-body gate (which diverted body suggesting-mode edits to direct/untracked editing to
avoid un-resolvable zombies while the resolve machinery was main-tree-only) is GONE. MT-2 +
MT-3 made `buildSuggestionRangeIndex` and the accept/reject resolve scan body-complete, so
MT-4 relaxed the seam helpers (`suggestionInputForBlock` / `replaceSuggestionInputForBlock` /
`isSuggestingInBlock`) from `selectionContextOf(...) !== state.rootId` to `=== null`: a
suggesting-mode edit in ANY editing context (main body OR footnote/header/footer/template
body) is now TRACKED. The seam coverage is unchanged — INSERT_TEXT (collapsed + type-over),
all four delete handlers + the paragraph-boundary suggested-joins (via `deleteRangeOrSuggest`
+ the join sites), all eight inline-format handlers (via `applyAttrsOrSuggest`), and SPLIT_NODE
(collapsed + composite) — but they now create a body suggestion that the all-tree resolve
scan accepts/rejects cleanly instead of falling back to direct editing. Multi-tree resolution
(tracking + resolving body suggestions end to end) is COMPLETE; see the MT-1..MT-4 block above.
REMAINING:
**5a render text-run visuals — SHIPPED** (`expandInlineItems` → `resolveSuggestionStyle`:
insertion=author-color+underline, deletion=author-color+lineThrough, formatting=`proposedAttrs`
preview + author-color underline indicator, nested=all; deterministic `authorColorOf` palette;
plain runs byte-identical via a fast path).
**5b render break-suggestion pilcrows — SHIPPED** (`expandInlineItems` peels the
`block-split-suggestion` / `block-join-suggestion` embeds out of the zero-width comment-marker
branch into a VISIBLE pilcrow ¶ wrapped in a single inline-block atom — split=author-color+underline
(insertion-flavored), join=author-color+lineThrough (deletion-flavored), read via
`properties.suggestionId`→`readSuggestionRecordFromState`→`authorColorOf`; absent record leaves
color to the cascade but still marks the decoration; the one-token/one-offset #407 invariant is
preserved like the cross-reference embed).
**5c-i preview-view projection FOUNDATION — SHIPPED** (`SuggestionView = "suggesting" | "final" |
"original"` type + pure `itemVisibleInView(item, view)` predicate in `suggestions.ts`, barrel-exported:
`final`=accept-all drops deletion runs + block-join embeds; `original`=reject-all drops insertion runs +
block-split embeds; both-ins-del run absent in both; formatting runs always visible (style-only). Greenfield,
not yet wired to any surface).
**5c-ii text-surface projection — SHIPPED** (`extractText(state, span, embedSerializer?, view?)` filters each
item by `itemVisibleInView` after advancing the literal-offset cursor — a filtered run consumes its offsets
but contributes no text; `getWordCount({suggestionView})` + `getSelectionWordCount(state, sel, view?)` thread
it through. `final` omits deletion text / keeps insertions; `original` omits insertion text / keeps deletions;
`suggesting` default = byte-identical legacy.
**5c-structural (TEXT surface) — SHIPPED:** the block-boundary structural merge now applies in `extractText`
(and so `getSelectionWordCount`, which extracts the whole span): across a boundary that MERGES in the view
(an accepted-join / rejected-split — the prior block's trailing break embed is resolved away, per the shared
`blockBoundaryMergesInView(items, view)` predicate, barrel-exported) the inter-block "\n" is SUPPRESSED, so the
two blocks' text concatenates exactly as `mergeAdjacentBlocksInTx` would. The predicate derives the merge purely
from the trailing embed's view-invisibility (the same `breakMerge` the resolve cascade uses), no record read.
REMAINING on this surface: `getWordCount` (whole-doc) counts PER-BLOCK by deliberate design (words never straddle
a paragraph break), so a projected-view whole-doc count is not reduced at a merged boundary — a narrow,
documented gap. The RENDER-surface structural merge (concatenating the block boxes in a projected view, vs today's
two-blocks-with-a-zero-width-barrier) is the remaining `5c-structural` slice — latent until a host wires a preview
toggle; preview is read-only so a render-tree merge that diverges from the state block tree is safe there.
**5c-iii render projection — SHIPPED** (`RenderOptions.suggestionView` threads through
`render()`/`renderIncremental()`→`makeRenderContext`→`RenderContext.suggestionView`→`expandInlineItems`'s
`view`: filters resolved-away items by `itemVisibleInView`, SUPPRESSES the 5a/5b suggestion visuals in
non-`suggesting` views, renders a surviving break embed zero-width (no pilcrow), and in `final` applies a
formatting `proposedAttrs` for real. `RenderOutput.suggestionView` records the view so the incremental
dispatch FALLS BACK to the full path on a view switch (reused nodes carry the prior projection). Default
`suggesting` = byte-identical legacy. Same TEXT-RUN scope — block MERGE is `5c-structural`).
**6a host range-rects query — SHIPPED** (`getSuggestionRangeRects(state, layoutTree, shaper, suggestionId)`
in `cursor/suggestion-rects.ts`, barrel-exported — mirrors `getCommentRangeRects`: `resolveSuggestionRange`→
`createSpan`→`computeSelectionRects`; `[]` for an id with no live tagged content. Pure core query; a
suggestion tags runs in place so its rects are exactly the tagged glyphs).
**6b DOM-controller overlay — SHIPPED (slice 6 COMPLETE):** `setSuggestionHighlights(highlights)` /
`clearSuggestionHighlights()` on the DOM controller (each `{suggestionId, active}`) — an EXACT mirror of the
comment overlay: two-stage self-healing (`resolveSuggestionHighlights()` re-resolves each id's range via
`resolveSuggestionRange` every `update()`; `suggestionHighlightsForPage()` emits per-page rects), painting a
distinct TEAL band BELOW the comment band (full layering: bg→suggestion→comment→find→selection→text) via
`paintSuggestionHighlights` + `SuggestionHighlightRect` + `addSuggestionHighlightDirty` incremental erase.
No `orphaned` check (range null→skip).
**PF paste-as-suggestion + cross-block Enter — SHIPPED (PF-0..PF-4):** a possibly-multi-block
selection is replaced by a possibly-multi-block tracked fragment via ONE pure structural plan
`planReplaceWithSuggestedFragment` (allocate new block ids up-front, compute the full post-op
layout as data, apply in ONE `applyOperation`) → `replaceWithSuggestedFragment`. The fragment
is a tracked INSERTION (inter-line breaks are `block-split-suggestion` embeds sharing one id);
a non-collapsed selection is SOFT-DELETED (struck) with a `block-join-suggestion` per crossed
paragraph boundary — so accept re-flows the merged paragraph and reject restores the original
split. One deletion id can own k+1 join embeds, resolved by the `resolve` reverse-order merge
cascade. Built on the kind-aware `insertNewBlocksInTx` primitive (PF-0). Wired into the editor:
`handlePaste` (PF-3) and cross-block Enter-over-selection in `handleSplitNode` (PF-4, replacing
the interim NO-OP) both route through it in suggesting mode; single-block Enter keeps
`splitWithSuggestionOverSelection` (struck text rides BEFORE the break vs the fragment's AFTER).
REMAINING:
**`5c-structural` RENDER surface — DEFERRED (decision 2026-06-10).** The text surface SHIPPED (see the
5c-structural note above); the RENDER block-box merge (rendering two state blocks as ONE merged paragraph box in a
projected view) is deferred, NOT built, for two evidenced reasons: (1) it is LARGER than a render post-pass — a
merged node (one render `ElementBox` for two state blocks) breaks a layout invariant: `groupChildren`'s
anonymous-block keys + the BFC child-iteration assume render-block-count == state-block-count, so a merge silently
corrupts geometry / incremental-reuse keys. Completing it needs a LAYOUT-integration decision (thread a per-node
state-blockId map into `groupChildren`; OR unfold merged nodes at the layout boundary; OR move the merge to
paint-time). (2) The preview-render surface is UNWIRED — no host renders `final`/`original` to canvas yet — so the
projection is latent. Per principle 1 (don't gold-plate a high-layer latent surface while deeper foundations
remain) + principle 9 (the layout-integration design is better made WITH the consuming preview UI's real needs),
build this WHEN a host wires a preview toggle, alongside that layout decision. The shipped `blockBoundaryMergesInView`
predicate + the clean render hook point (`render-core.ts` container loop, where sibling block nodes are accumulated)
are the foundation it will reuse. The `getWordCount` per-block projected-count gap is deliberate (per-block by
design). 7 arch docs. (No text/HTML exporter exists yet — only the binary serializer, which round-trips the
literal state; a view-projected text/HTML export lands if/when that exporter is built, NOT a change-tracking
slice.) See `1.1-state.md` "The `suggestions` map" + `1.7-editor.md`.

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
resolved per page via `getPage(visible ∪ cursorPage)` — **no consumer ever
positions the whole document**. For a spanning block (one taller than a page)
both line navigation (`collectBlockLinesAcrossPages`) and selection/find/comment
rects (`selectionRectsAcrossPages`) use per-page paths; the cursor/ defensive
fallback guards dev-throw / clamp-to-document-boundary / resolve-per-page
(footnote bodies map via `pageIndexOfFootnoteBlock`). The
`materializeAll()`/`resolvePositionedTree`/`getPositionedTree` whole-tree-positioning
bridge has been **deleted**; `paginateRoot` survives only as (a) the float/`clear`
legacy layout path and (b) a test-only equivalence oracle.
**Non-paginated single-canvas** is the fallback — one canvas +
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
controller's paint cache. The overlay band is `background → comment
highlights → match highlights → selection → text`: the find-match highlight
overlay (`MatchHighlightRect[]`, #433) paints under the selection tint and under
text, with `addMatchHighlightDirty` per-page dirty marking so a next/prev
(active-index change) repaints. The controller's `setFindHighlights` /
`clearFindHighlights` drive it via a two-stage rect resolution. The COMMENT
highlight overlay (`CommentHighlightRect[]`, amber) paints in the bottommost band
below the find highlights via the same two-stage resolve; the controller's
`setCommentHighlights` / `clearCommentHighlights` store `{ commentId, active }`
and re-resolve each comment's range from live state every `update()` (with
`addCommentHighlightDirty` per-page dirty marking). The
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
