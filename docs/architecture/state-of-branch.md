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

### Headless boundary: `@taleweaver/core` imports no sibling package `[implemented]`

A `dependency-cruiser` rule (`packages/core/.dependency-cruiser.cjs`, rule
`core-no-sibling-packages`, severity `error`, run via `npm run lint:boundaries`)
forbids `@taleweaver/core`'s production source from importing any sibling
`@taleweaver` package (`print` / `digital` / `pdf` / `react`). Tests, test-utils,
and integration code are exempt. The rule is type-aware (`tsPreCompilationDeps`),
so it catches `import type` edges too.

A second guard catches DOM-global creep: `npm run typecheck:headless
--workspace=packages/core` (`packages/core/tsconfig.headless.json`) drops the
`DOM` lib and excludes test scaffolding (`*.test.ts`, `integration/`,
`test-utils/`), so any DOM global in core's production source fails to typecheck.
Both guards are manual checks — run before committing to core's production source;
CI runs neither.

The geometric box-layout engine (BFC / IFC / table-FC, fragmentation, pagination,
virtual-layout-tree, measure pass, fit-core) and geometric cursor math (hit-test,
cursor-position, line-navigation, selection-geometry, line-bidi, line/atomic-box
indices, suggestion/comment rects) live in `@taleweaver/print`; `core` retains only
the geometry-free document/editing brain. `core/src/layout/` keeps the text-core
(UAX #14 line-break, UAX #9 bidi, grapheme clustering, `TextShaper`/`TextMeasurer`
interfaces, intrinsic-size measurement, `mat2d`, hyphenator,
text-transform/tokenize/spacing, `dev-mode`); `core/src/cursor/` keeps the
geometry-free selection model (`selection.ts`, `cursor-ops.ts`,
`grapheme-utils.ts`, `object-selection.ts`). Core's editor reducer is
geometry-free: geometric navigation resolves through the `@taleweaver/print`
`NavIntent` resolver (`packages/print/src/nav/nav-intent.ts` `resolveNavIntent`),
which reads the layout tree + measurer and dispatches a geometry-free
`SET_SELECTION` / `DELETE_RANGE` back to core; the render→cascade→layout pipeline
and the `EditorState`↔`layoutTree` coupling live in the backend's layout-driver
(`packages/print/src/layout-driver/`; core's reducer records `lastDirtyIds`
instead of holding a tree); the `measurer` / `hyphenator` config fields (and the
`TextShaper` / `Hyphenator` / `TextMeasurer` / `BlockParentLookup` type imports)
belong to the backend `LayoutConfig`, not `EditorConfig`. See `overview.md` →
"Headless boundary".

### `styles/` `[implemented]`

Full vocabulary present: `Style`, `ComputedStyle`, `UsedStyle`, `Length`,
`Color`, `Display`, `WritingMode`, `Direction`, etc. Every other module
imports from here.

`widows` / `orphans` are consumed by the pagination fit-core (`layout/fit-core.ts`
applies the CSS Fragmentation orphans / widows line-keeping rules;
`layout/build-fit-metas.ts` threads `parentCs.orphans ?? 2` / `widows ?? 2`).

Schema reservations (present in `Style` and `ComputedStyle` but not yet consumed
by any code path):
- `fontFeatureSettings` — required by typography phase 1; resolved into `UsedStyle`
  but not yet read by any tokenizer/layout/paint consumer.

Consumed properties (formerly schema-only, now active):
- `textAlign` incl. justify, `textWrap`/`whiteSpace`, `textIndent`,
  `letterSpacing`/`wordSpacing` (via `layout/text-spacing.ts`, applied in the
  shapers + IFC trailing-trim + renderer).
- `textTransform` via the `textTransformInterpreter` cascade interpreter + IFC
  per-token display transform (`layout/text-transform.ts`) + `SET_TEXT_TRANSFORM`
  editor action + toolbar.
- `hyphens`/`language`/`hyphenateLimitChars` via the IFC hyphenation producer +
  `tryHyphenSplit`; the AUTO producer arm (`hyphens:auto`) is gated on
  `cs.language` + an injected `LayoutConfig.hyphenator`, applying
  `cs.hyphenateLimitChars`. The concrete Liang algorithm ships in
  `@taleweaver/print` (`createLiangHyphenator(languages)`) fed `en-us` pattern
  data from `@taleweaver/hyphenation-en-us`; `PatternSet` lives in core. No
  configured hyphenator falls back to `manual`.
- `overflowWrap` via the IFC `tryEmergencyBreak` last-resort grapheme split + the
  editor body default (`break-word`; `anywhere` ALSO shipped — same used-layout
  break, plus min-content collapse in `intrinsic-sizes-pass.ts`).
- `tabStops`/`defaultTabStop` (the former `tabSize` reservation was REMOVED) via
  the `"tab"` embed + IFC resolve-at-overflow-check advance (`nextStop`; left/
  center/right/decimal/content-edge alignments + default-grid fallback) +
  `INSERT_TAB`/`SET_TAB_STOPS` editor actions + Tab key + leader paint.

Positioning vocabulary consumed (all functional slices shipped): `position`,
logical `inset*`, `zIndex`, `transform`, `transformOrigin`, `opacity` live in
`styles/position.ts` + `ComputedStyle`, all `inherits: false`. `position:
relative`/`absolute` consumed by layout; `zIndex` consumed by paint (z-index /
stacking contexts); `transform` consumed by paint (`paintBox` save/transform/restore
via `layout/mat2d.ts`) AND hit-test (per-line `inverseTransform` baked by
`collectLineBoxes`, mapped by `resolvePositionFromPixel`); `opacity` consumed by
paint (offscreen GROUP compositing: an `opacity < 1` box's whole atomic subtree
paints into an offscreen `<canvas>` via `paintOpacityGroup` + `offscreen-surface.ts`
factory seam, composited once at `globalAlpha`; `opacity === 1` takes the zero-alloc
direct path). No positioning property enters `UsedStyle` — they are read at their
use-sites from `ComputedStyle`. See
[`2.4-positioning.md`](./2-print/2.4-positioning.md).

Schema items genuinely missing:
- `overflow` — required by `establishesNewBFC`'s full check.

### `state/` `[implemented]`

Y.Doc-backed block-tree-of-styled-runs (see `1.1-state.md`): a
`Map<BlockId, Block>` over a Yjs document, each block carrying `inlineContent:
InlineItem[]`, with ID-based positions (`{ blockId, offset }`). Layered operations
(Layer-1 Y-primitives → Layer-2 read utilities → Layer-3 mutations: insertText,
deleteRange, replaceRange, splitBlock, mergeBlocks, set/mergeBlockAttrs,
clonePastedSubtree). History is a `Y.UndoManager` wrapper that welds each undo
unit's before/after selection onto its `StackItem.meta`, with Google-Docs-style
typing coalescing: same-kind text edits within a pause window merge into one undo
unit, with the boundary owned by `beginEntry` / `breakCoalescing` (the reducer
classifies actions via `coalesceKeyOf`). Dirty tracking is write-time: `dirtyIds`
captured from Yjs's `afterTransaction` change event (not tree diffing), consumed by
the incremental render/cascade/layout passes. `applyOperation` returns the input
`State` reference unchanged on a no-op, so `result.state === state` is an O(1)
"did anything change?" guard. The old path-based `StateNode` immutable tree is
fully removed.

**Surgical same-block `deleteRange` (selection-rebasing Phase 1, slice 1)
`[implemented]`.** The same-block `deleteRange` path mutates the block's
`inlineContent` `Y.Array`/`Y.Text`s IN PLACE (`surgicallyDeleteInlineRangeInTx`
in `y-utils.ts`) rather than full-replacing via `buildYInlineContent`: runs outside
the deleted range — and the surviving portion of a straddled run — keep their
`Y.Text` CRDT identity, so a Yjs `RelativePosition` anchored there survives (the
foundation for within-block selection rebasing under concurrent edits). Read-back is
byte-identical to the old rebuild. The seam-merge RECEIVER keeps identity; the
DONOR's migrated same-attrs chars are fresh (the Class-2 limit — Yjs has no
identity-preserving cross-`Y.Text` move). The CROSS-BLOCK path still full-replaces
the anchor block; a later surgical-ops slice migrates it.

**Surgical same-block `replaceRange` (selection-rebasing Phase 1, slice 2)
`[implemented]`.** A SAME-BLOCK `replaceRange` (type-over-a-selection /
replace-one) preserves `Y.Text` identity for the runs it doesn't touch via the
identity-aware `planInsertTextSplitInPlace` (a boundary/interior insert), instead of
the old `planInsertTextFullReplace`. A `RelativePosition` in a NON-straddled
surviving run survives the replace; read-back is byte-identical to the old
full-replace. The CROSS-BLOCK `replaceRange` path still full-replaces (its delete
full-replaces the anchor block — migrated when cross-block delete goes surgical).
The run that STRADDLES the insertion point still loses identity (Class-2 limit).

**Universal in-place seam-merge (selection-rebasing Phase 1, slice 5)
`[implemented]`.** ALL six live-array post-edit seam normalizers (in
`applyAttrsToRange`, `mergeAdjacentBlocks`, the `split-in-place` insert applier,
`insertItemsInTx`, and the two suggestion appliers `applyResolveDecisionsInTx` /
the strike applier) now call the identity-preserving twin
`mergeAdjacentSameAttrsTextItemsInPlace` instead of the rebuild
`mergeAdjacentSameAttrsTextItems`. When applying an attr / merging blocks /
inserting makes two runs converge to same-attrs, the merge RECEIVER keeps its
`Y.Text` identity; only the donor's migrated chars are fresh (Class-2 limit).
Read-back is byte-identical at every site. The rebuild
`mergeAdjacentSameAttrsTextItems` is RETAINED as the general /
detached-array-safe normalizer and the Y-side drift oracle.

Known follow-ups: `Y.Map.set(key, sameValue)` fires change events → scattered
same-value-write guards in ops like `reparent-children.ts` self-move; consolidate
via a `setIfChanged` Y-utils helper (#358).

### Document serialization (`state/serialize/`) `[implemented]`

Pluggable `DocumentSerializer` (one per wire format) + a `SerializerRegistry`
(mirrors the component/attr registries: empty + default-populated factories) +
engine-level `serializeDocument` / `deserializeDocument` dispatch, with
`UnknownSerializerFormatError` on an unregistered format.

The v1 built-in is a LOSSLESS binary serializer (`createBinaryDocumentSerializer`,
`BINARY_FORMAT = "taleweaver-binary"`) backed by Yjs's native update codec
(`Y.encodeStateAsUpdate` / `Y.applyUpdate`): one round-trip over the WHOLE
`Y.Doc` (all three block trees + `listDefs` + `comments` + `suggestions` + `meta`
rootId). Decode reads `rootId` via the state-private `getMetaRootId` and rebuilds
`State` with a fresh snapshot cache; a decoded doc with no rootId throws
`MalformedDocumentError`.

The editor-level open/save surface is `exportDocument` / `loadDocument`
(`editor/document-io.ts`, on the core barrel): `loadDocument` deserializes into a
FRESH `EditorState` (fresh History + a valid initial caret via
`initialSelectionForState` + full render/cascade/layout).

`buildDocumentFromTree` (`state/build-document-from-tree.ts`, on the state + core
barrels) lowers a declarative nested `BlockNode` tree → `State`, minting ids and
deriving all structural links — the safe public counterpart to the internal
`buildStateFromBlocks`, and the construction target a future HTML/JSON importer's
`decode` builds.

The HTML serializer ships in `core`'s `state/serialize/` — the `taleweaver-html`
`DocumentSerializer<string>` (`html-serializer.ts` + `html-encode.ts` +
`html-decode.ts` + the DOM-free `html-node.ts` seam, on the core barrel as
`HTML_FORMAT` / `createHtmlDocumentSerializer` / `encodeHtml` / `decodeHtml` /
`HtmlNode` / `HtmlParser`). ENCODE is a pure `State` → HTML walk; DECODE parses via
an INJECTED `HtmlParser` over the DOM-free `HtmlNode` interface (a browser host
supplies `browserHtmlParser` in `@taleweaver/print` — `DOMParser`-backed), keeping
core headless. It round-trips a Google-Docs-complete prose + list + table subset
SEMANTICALLY (not id-preserving; binary owns lossless), dev-warns on dropped
content-bearing embeds (footnote-anchor / cross-reference), and never throws
`MalformedDocumentError` (empty body → single-empty-paragraph doc).

A hand-authorable JSON serializer ships as `taleweaver-json`
(`state/serialize/json-serializer.ts`, on the core barrel as `JSON_FORMAT` /
`createJsonDocumentSerializer` + the `JsonNode` / `JsonInlineItem` / `JsonDocument`
wire types). It is a kind-driven nested-tree JSON (container→`children`,
inline-bearing-leaf→`content`, atomic-leaf→neither), id-optional
(preserve-or-mint), LOSSLESS over the full document model (all three block trees +
`listDefs` / `comments` / `suggestions` side-tables) EXCEPT tables (which throw on
encode AND decode — the binary serializer is the lossless escape; JSON table
round-trip is `[missing]`/roadmapped). Decode validates every side-table record
field-by-field and throws `MalformedDocumentError` on a malformed
node/listDef/comment/suggestion. It is HOST-registered (needs a `blockKindResolver`
+ `IdAllocator`), NOT in `createDefaultSerializerRegistry`.

Named follow-ups: pairing the wire document with scroll view-state for full
save/restore; JSON table round-trip; v2 + migration path. See
[`1.7-serialization.md`](./1-core/1.7-serialization.md),
[`2.9-html-serializer.md`](./2-print/2.9-html-serializer.md), and
[`1.5-editor.md`](./1-core/1.5-editor.md).

### `components/` `[partial]`

Built-in components register and render. Plugin registry works.

Built-in component behavior:
- `imageComponent`, `horizontalLineComponent` are complete end-to-end: they render
  AND paint (canvas-renderer `drawImage` for images; rule stroke for horizontal
  lines; `image-cache` drives async load + re-paint). Editing is wired —
  `INSERT_IMAGE` / `INSERT_HORIZONTAL_LINE` insert the atomic-leaf block + a
  trailing paragraph; atomic-leaf Backspace/Delete at a block boundary removes the
  object as a unit (`atomic-edits.ts`); `SET_IMAGE_SIZE` writes width/height back.
- **Image text-wrapping `[implemented]`** — wrap-left, wrap-right, and break
  (no-wrap). The `image` component maps the Google-Docs physical `wrap` attr
  (`"left"`/`"right"`/`"break"`) to the engine's logical `float` via
  `imageWrapFloat(wrap, direction)` (resolved against the cascaded `direction` so
  wrap-left stays physically left under RTL — the component-set seam in
  `components/leaf-style-attrs.ts`, NOT a cascade interpreter). `"break"` is stored
  as ABSENCE of the attr. The `SET_IMAGE_WRAP` editor action sets the mode. Text
  wrap uses the existing CSS-9.5 BFC float placement + IFC line-narrowing. A floated
  image with an explicit block-size reports that block-size on its box.
  "in line with text" (inline positioning, `inline-image` EmbedItem) flows inline
  via the open-string embed pipeline; the layout baseline is the general REPLACED
  inline-block rule (a child-less inline-block sits its bottom margin edge on the
  text baseline, CSS2 §10.8.1, threaded by an `isReplaced` flag — render
  `replacedInline` → IFC token → `InlineBlockBox` → `applyVerticalAlign`); render
  uses an outer `display:inline-block` wrapping a child-less inner `display:block`
  carrying `metadata.image` + explicit `blockSize`/`inlineSize`, so the existing
  block-image paint runs for it on canvas AND PDF with no new paint code;
  a11y emits a standalone `imageAlt` run; HTML encode emits an inline `<img>`;
  `INSERT_INLINE_IMAGE` (the `insertInlineImage` Layer-3 op) makes it reachable.
  Still `[missing]`/deferred (honest cuts): image toolbar / insert-menu UI;
  In-line↔Wrap↔Break positioning switcher; drag-resize handles; OS-clipboard image
  paste; behind/in-front-of-text layering; PDF `/Figure` structure tag for inline
  images.
  Image OBJECT-SELECTION (engine core) `[implemented]` — an object selection is
  encoded as a COLLAPSED `Selection` on the atomic-leaf block (`{ blockId, offset:
  0 }`; a text caret can never land at offset 0 of an atomic-leaf because content-
  block walkers skip `inlineContent === null` blocks — unambiguous discriminant,
  convergent with ProseMirror/Lexical `NodeSelection`). `isObjectSelection(state,
  selection, resolver)` is the single gate; the hit-test point-in-rect pre-pass over
  `getAtomicBoxIndex` resolves a click inside an atomic box to that block; the
  controller's optional `componentRegistry` threads into mousedown + drag hit-tests
  so a click on an image resolves to `{ blockId, 0 }` — inert only because no shipped
  example passes `EditorControllerOptions.componentRegistry` yet. `computeObjectSelectionRect`
  yields the bbox for the controller's selection outline; every blast-site editor
  action is guarded (`INSERT_TEXT` → replace-on-type, `DELETE_*`/`DELETE_WORD` →
  object-delete, `SPLIT_NODE`/`DELETE_LINE` → no-op, arrows/`MOVE_WORD`/`ESCAPE` →
  off-object nav). STILL `[missing]` (browser-gated / separate features): the
  controller caret-suppression + bbox-outline PAINT when `isObjectSelection`; resize
  handles + image toolbar/drag UI; OS-clipboard image copy; range-selection CROSSING
  an atomic; whole-block soft-delete under change-tracking.
  Float subsystem boundaries: a SINGLE-COLUMN, footnote-free wrapped-image / float /
  `clear` doc uses the virtualized-layout fast path (the measure pass runs the real
  `layoutBlock` per page via a `floatPageMeasurer` closure); only a float doc that is
  ALSO multi-column or footnote-bearing (or any `position: absolute` doc) still
  routes through the legacy `paginateRoot`. **Cross-page float PUSHING is
  IMPLEMENTED on the virtualized fast-path:** a float that does not fit the remaining
  page block-space is pushed (deferred as a whole box) to the top of the next page —
  in-flow content keeps flowing on the current page — matching CSS float-pushing +
  Word/Pages/Google Docs. The fit check uses `FloatEnvironment.peekPlaceFloat`,
  records a non-fitting float on the page-scoped `pushFloat` channel, and the page
  loop carries it (`PagePlanEntry.incomingPushedFloats`, folded into the
  `PageFingerprint`) to the next page's content top. A float pushed off the LAST page
  lands on an emitted trailing page; a float taller than a whole page overflows an
  empty page. Gated by `FragmentationContext.enableFloatPushing` (single-column
  footnote-free float docs via `buildVirtualPaginatedTree`). **Still `[missing]`:**
  the legacy `paginateRoot` path (float + multi-column / footnote / `position:
  absolute`) retains float OVERFLOW — pushing there is deferred pending those doc
  types' virtualization. **Float+pagination coordinate frame is COHERENT
  (cumulative):** float-env offsets are expressed in the document-cumulative flow
  frame (`pageFlowBase` + `IFCBreakToken.paraFlowStart`), so a float narrows the
  lines beside it on the page it ACTUALLY sits on. The single legacy-vs-virtual gate
  is `paginationFallsBackToLegacy` (`measurePassUnsupported` is now absolute-only;
  `hasFloatOrClear` + `hasMultiColumnRegion` compose the float gate); each plan
  entry carries `incomingActiveFloats` (the cumulative-frame cross-page float shadow,
  seeded into a fresh per-page env at materialize). See `2.3-pagination.md`.
  Browser-gated remainder: image natural-size feedback, resize-handle paint + drag,
  example-app Insert menu.
- `tableComponent`, `tableRowComponent`, `tableCellComponent` render, and table
  layout (Table FC) is implemented. Table *editing* is `[implemented]` end-to-end,
  both the uniform and span-aware surfaces. `INSERT_TABLE` inserts a fresh
  `rows`×`cols` table at the caret's block boundary (START→before / END→after /
  MID→split) and carets into cell (0,0); main-body only, one undo step. The
  structural edits: `INSERT_TABLE_ROW`, `INSERT_TABLE_COLUMN`, `DELETE_TABLE_ROW`,
  `DELETE_TABLE_COLUMN` (insert above/below or left/right, remove the caret's
  row/column; `columnWidths` re-spliced/-removed atomically via `setBlockAttrsInTx`;
  last-row/column deletion collapses the whole table), `SPLIT_CELL` (unmerge a span
  back to 1×1 cells), `MERGE_CELLS` (merge a selected cell rectangle into one span,
  via `resolveCellRange`), and `DELETE_TABLE` (delete the whole table, replacement
  paragraph when it is the body's sole child). Each row/column handler gates on
  `ctx.ragged` ONLY and routes a WELL-FORMED SPANNED table (`ctx.spanned`) to the
  span-aware op (covering spans shrink/grow, an originating span re-homes/decrements,
  a 1×1 in the deleted line is removed), a plain no-span table to the byte-identical
  op. The span-aware ops reason in the SAME occupancy-grid coordinates the Table FC
  uses (`table-grid-core`; see [`2.2.3-table-fc.md`](./2-print/2.2-layout/2.2.3-table-fc.md)).
  HTML table ENCODE (`<table>`/`<tr>`/`<td>`) ships — tables are no longer lost on
  export. **Header-row repetition `[implemented]` end-to-end:** the per-table
  `headerRowCount` attr + `setTableHeaderRows` op (clamped by the clean-cut
  invariant via `largestCleanHeaderCount`) + the `adjustHeaderRowCount` fix-up wired
  into all four row insert/delete ops; the `table` component stamps
  `LayoutBoxMetadata.headerRowCount`; the measure pass reserves `headerBlockSize = Σ
  rowBlockSizes[0, headerRowCount)` and the materialize pass (`layoutTable`) re-lays
  the header rows at each continuation fragment's top from the same single source —
  byte-identical, gated by the equivalence harness + a direct `getPage` test; the
  incremental reuse gates correctly re-fit / re-materialize continuations after a
  header-cell edit; hard cases proven: PROGRESS forces ≥1 body row per continuation
  (anti-hang); HEADER-CAP overflows a too-tall header without dropping it; a
  multicolumn-nested table repeats its header per column-portion with `headerBlockSize`
  computed at the column TRACK width; the clean-cut invariant makes a
  header-straddling merged cell unrepresentable. HTML table DECODE (paste-in)
  `[implemented]` — a pasted `<table>` (incl. `<thead>`/`<tbody>`/`<tfoot>`,
  `<colgroup>` `%` widths, `colspan`/`rowspan`, and `<div>` cell surrogates) decodes
  back into `table` blocks via the headless `decodeTable` walk. Still `[missing]`:
  browser-gated example-app Table menu wiring (the `INSERT_TABLE` button + span-aware
  actions + header-row toggle), and structural table copy/paste.

### `render/` `[implemented]`

`renderTree`, `renderTreeIncremental` working. Render-tree reference-equality
preserved across edits.

A legacy `render-node.ts` exists alongside the active `render-node-v2.ts` for
migration; the legacy types are not consumed by current core code but remain
exported.

### `cascade/` `[implemented]`

`cascadePass`, `cascadePassIncremental` working. The subtree short-circuit fires
correctly when render-tree references are preserved upstream. Length flattening
(`em` → px) works at cascade time; `%`, `auto`, intrinsic keywords correctly pass
through symbolic.

### `layout/` `[partial]`

Most of the layout pass is implemented and working:
- BFC: margin collapsing, clearance, list markers, anonymous block runs. Subtree
  reuse works including the "rebuilt parent with unchanged children" gate. The BFC
  reads the render-baked `markerText` off the cascaded style and paints it (the old
  `layout/list-counter.ts` counter / seed-replay / run-reset / auto-counter
  machinery was deleted). The marker-gutter behaviors (#426 auto-widen, #431
  straddling-break marker on the correct page, #418 list spacing) are preserved.
  See the "Lists & numbering" section.
- IFC: line wrap, baseline alignment, full UAX #9 bidi reorder (mixed-direction
  geometry + RTL glyph paint + RTL cursor — see the bidi entry below for
  browser-smoke status), hyphen splitting, inline-block sizing, paragraph-level
  reuse.
- Table FC: occupancy-grid model (§17.5), `colSpan`-aware auto-layout column widths
  (§17.4) and `rowSpan` row-height distribution (§17.5.3), anonymous row/cell
  synthesis, and fragmentation across pages — including `rowSpan` cells that straddle
  a page break (interior fragmented + a `SpanningCellContinuation` emitted, then
  resumed on the next fragment).
- Float environment: full CSS 9.5 placement with push-below-if-needed, clearance
  integrated with margin-collapse, dirty-offset tracking. A floated box (or in-flow
  block) carrying an explicit `blockSize` reports that block-size on its own box, so
  the float's painted/hit-test rect agrees with the exclusion region.
- Intrinsic sizing pass: `min-content` and `max-content` per render node, cached. A
  text run's `min-content` is the widest UNBREAKABLE segment — the widest run of
  clusters between UAX #14 break opportunities — computed in
  `computeTextContribution` from the run's `breakOpportunities`.
- Layout-box reuse: `LayoutBoxCache`, `isLayoutBoxReusable`,
  `renderNodesLayoutEquivalent`.
- Positioning (all functional slices shipped, see
  [`2.4-positioning.md`](./2-print/2.4-positioning.md)):
  `position: relative` resolves a physical `relativeOffset` in the BFC and the
  painter shifts the box + descendants. `position: absolute` is laid out out-of-flow
  via a two-pass scheme: the in-flow loop registers the child's static position into
  the nearest absolute containing block (abc — `LayoutContext.absoluteContainingBlock`
  + `ownsAbsoluteContainingBlock` + `originFromAbc`; established by `position ∈
  {relative,absolute}` or `transform`), and the establishing box DRAINS its pending
  list in a post-loop second pass, resolving each child's size/position from
  `cs.inset*` against the abc and attaching results to `box.absoluteChildren` (on
  `LayoutBoxBase`). Abs content is cursor-reachable because `cursor/line-flatten.ts`
  `collectLineBoxes` descends `absoluteChildren` into the flat `LineIndex`.
  **z-index / stacking contexts** ship in the PAINTER (`packages/print`): 
  `stackingContextRole` on `LayoutBoxBase` drives a CSS 2.2 §E.2 ordered paint,
  gated so the no-stacking common path is byte-identical.

Known gaps:
- **Positioning** — named follow-ups within the shipped slices:
  transformed-content selection-rect + caret geometry stay PRE-transform in v1 (reuse
  the per-line `Mat2D` forward); paginated abs-pos fragmentation (a fragmented box's
  second pass doesn't run, so abs children registered before a break are not drained
  onto the fragment); an establishing box's own explicit block-size not folded into the
  abc block percent-base.
- **Bidi — geometry + glyph paint + RTL cursor implemented; in-browser
  smoke pending.** The **full UAX #9 algorithm engine** (`layout/uax9/`,
  `resolveBidiLevels` P/X/W/N/I + `reorderVisual`/`applyL1`/`reorderRunsByLevel`,
  conformant against the official `BidiTest.txt` + `BidiCharacterTest.txt` at 100%)
  is wired into the IFC (`resolveParagraphBidi`; `reorderLineForBidi` +
  `ifc-bidi-reorder.ts`). Mixed-direction lines reorder into correct visual box
  geometry — paragraph-level resolution → post-L1 segmentation →
  flatten/segment/`reorderRunsByLevel`/re-nest → physical coordinates; each reordered
  run carries its `bidiLevel`. **Glyph paint** is done: the canvas renderer reverses a
  run's cluster placement when `bidiLevel` is odd. **RTL cursor / hit-test /
  selection / navigation** is done: `cursor/line-bidi.ts` `LineBidiView` +
  `caretInlineCoordInLeaf` / `offsetInLeaf` / `moveVisually` /
  `selectionRectsForLineRange`, `cursor/visual-motion.ts`, and
  `EditorState.caretAffinity` managed by `actionManagesCaretAffinity` make caret X,
  click→offset, boundary-crossing selection rects, and visual-order
  ArrowLeft/Right + Shift+Arrow all bidi-aware; Home/End stay logical and render at
  the correct visual edge via affinity. `[partial]` Remaining: the in-browser smoke
  validation, including a handful of `TODO(C.2.7 browser-confirm)` boundary cases
  (the left-going dual-caret double-stop; the cross-line visual edge when a line's
  content direction differs from the paragraph base; the exact Google-Docs RTL
  Home/End rendering).
- **Convergence detection for incremental wrap** (`rewrapIncremental`) is
  implemented and tested in `wrap-incremental.ts` but not yet wired into the IFC's
  main wrap loop — foundation-built-ahead. A correct wire-in must first resolve four
  integration hazards (tail vertical-repositioning, float-environment gate,
  bidi-context gate, fragmentation interaction) — see `2.2-layout/2.2.2-ifc.md`
  "Convergence (incremental wrap)". The IFC's all-or-nothing paragraph cache
  (`findChangePoint`) provides the dominant benefit (every un-edited paragraph reused
  each keystroke); `rewrapIncremental` adds only marginal partial reuse within the
  single edited paragraph.
- **Table `border-collapse: collapse`** — every cell draws its own borders; the
  heaviest-wins collapse resolution is not implemented.
- **Repeating header rows across page fragments** `[implemented]` — see the
  `components/` table entry above and `2.2.3-table-fc.md`. `resumeAtRow` indexes
  absolute rows (header rows re-emit but do not advance it). `<tfoot>` bottom-footer
  repetition remains a separate future feature.

### Pagination `[partial]`

Foundation shipped: `PageBox` LayoutBox variant; `paginateRoot` whole-block
fragmenter; `EditorConfig.pageConfig` wires through `layoutTree` /
`layoutTreeIncremental`; the editor controller's per-page-canvas path activates when
`PageBox`es appear in the layout tree.

Within-block fragmentation shipped: `FragmentationContext` and `LayoutResult` types
wired through `layoutBlock`, `layoutInlineContent`, and `layoutTable`; `paginateRoot`
rewritten as a page-by-page coordinator driving `layoutBlock` with a break token per
page; BFC break-aware child loop (`break-before`, `break-after`, `break-inside`,
margin truncation top side, overflow rule, resume from `BlockBreakToken`); IFC
orphans/widows/hyphen-pair constraints and resume from `IFCBreakToken`; Table FC
row-boundary fragmentation and resume from `TableBreakToken`.

Page margins shipped: each `PageBox` contains a single wrapping content-area
`BlockBox` positioned at `(margins.inlineStart, margins.blockStart)` within the
page; the BFC's containing inline size is the page content width. The editor's
`SET_CONTAINER_WIDTH` action threads `pageConfig` through to its `layoutTree` call.

Per-page paint coordinates: `paintPage` and `walkAndDetectChanges` translate by
`(-pageBox.x, -pageBox.y)` so each page paints in page-local coordinates against
its own canvas. `acquireCanvas` resets canvas dimensions and the per-page
`PaintCache` when a slot's canvas is freshly created or recycled from the pool.

Page templates `[implemented]` — headers, footers, and footnotes are all built
end-to-end:
- **State model:** `template-body` containers (header/footer bodies) and `footnote-body`
  containers as state-tree nodes; `section` blocks carry `headerBlockId`/`footerBlockId`
  (`insert-template-body.ts`, `section-plan.ts`).
- **Editor actions:** `INSERT_HEADER`/`INSERT_FOOTER` (`handleInsertHeaderFooter`, with a
  one-per-section idempotency guard and active-section resolution), `INSERT_FOOTNOTE`
  (`handleInsertFootnote`), `SET_FOOTNOTE_POLICY`; cursor scope extends into the
  header/footer/footnote subtrees.
- **Numbering:** `continuous`, `restart-per-section`, and `restart-per-page` footnote
  numbering (`footnotes/numbering.ts`); the render pass uses a `continuous` substitute
  for `restart-per-page` until the layout pass supplies `pageAssignment`
  (`render-footnotes.ts` `effectiveRenderPolicy`).
- **Layout:** `resolveFootnotes` lays footnote bodies into a per-page `footnoteSlot` with
  greedy fill, line-boundary splitting of footnote bodies ACROSS pages (FN-5
  continuations), and a D8 self-eviction convergence fixpoint; growing header/footer
  slots (`computeSlotInsets`, #328/#329) push the content area when a header/footer
  exceeds its margin; two-pass page-count convergence (`runFieldConvergence`). Paint and
  cursor/hit-test descend all three slots.
- **Deliberate deviation:** no footnote separator rule line is drawn
  (`FOOTNOTE_SEPARATOR_HEIGHT` is retained as a gap-only reservation; the Google-Docs
  horizontal line was removed per user directive).

Still missing / partial:
- First / left / right (odd/even) page template variants (cover page, mirrored book
  spreads) — absent.
- Per-section "link to previous" header/footer cascade: currently falls back to the
  doc-root `headerBlockId`/`footerBlockId` only, not the nearest prior explicit section;
  copy-on-unlink seeding not yet built. `[partial]`
- Footnote rendering in the legacy `paginateRoot` path: a float doc that ALSO has
  footnotes (or is multi-column) routes to `paginateRoot`, which builds `PageBox`es with
  all slots `null`, so footnote bodies are not rendered in that path.
- Bottom-side margin truncation across breaks for the edge case where the parent has
  bottom padding/border on a partial fragment (top side already shipped).
- Cross-page floats for the legacy `paginateRoot` path (float + multi-column /
  footnote / `position: absolute`).
- Cross-page table `<tfoot>` bottom-footer repetition (the header-row case shipped
  end-to-end — see the Tables section + `2.2.3-table-fc.md`).

### Multi-column (Format ▸ Columns) `[partial]`

Section-scoped multi-column (the Google-Docs model) is fully implemented
engine-side:
- **Type vocabulary:** `ColumnConfig` / `ColumnRule` + `DEFAULT_COLUMN_CONFIG` +
  `columnConfigsEqual` (`layout/column-config.ts`); `resolveColumnConfig` validator
  (`layout/section-column-config.ts`); `section` component stamping attrs into
  `ElementBox` metadata; `SectionBoundary.columnConfig` /
  `SectionStateAt.columnConfig` + `SectionPlan.effectiveDefaultColumns`.
- **`ColumnBreakToken`:** a `"column"` member of the `BreakToken` union (`{
  resumeColumnIndex, resumeChildToken }`) + `breakTokensEqual` arm. The measure
  pass's `fitColumnsOnPage` emits a `ColumnBreakToken` to carry last-column overflow
  to the next page's column 0.
- **`MultiColumnBox`:** a `type:"multicolumn"` union member with `columns: readonly
  BlockBox[]`; `createMultiColumnBox` factory; a `"multicolumn"` arm at every
  generic box-walking site (`rebuildBoxWithOffsets`, `collectLineBoxes` /
  `collectLeavesRec`, `cursor-position`, `table-cell-at-point`,
  `physicalize-vertical`, canvas painter, `paint-cache`).
- **Fill core:** `fitColumnsOnPage` (`layout/column-fit.ts`) distributes one multicol
  page's content across N equal-height columns by chaining the existing pure
  `fitOnePage` per column; `columnCount === 1` reduces to a single `fitOnePage`.
- **Final-page balance:** `balanceColumnHeight` returns the minimal column height that
  evens a section's final page via binary search over a monotonic STABLE-FIT oracle
  (content packs into ≤ N columns AND no column overflows past the trial height). The
  `resolveFootnotes` sweep applies the SAME balance to a footnote-bearing final
  multicol page after convergence (re-balances at `pageContentBlockSize −
  footnoteSlotHeight`).
- **Track-width lockstep:** every multicol `fitColumnsOnPage`/`balanceColumnHeight`
  in `resolveFootnotes` re-fits on `colMetas` built at the column TRACK width
  (`buildMetasAtWidth(trackInlineSize)`), so the planned `ColumnFit.resumeOut`
  matches what `materializePage` actually lays each column at.
- **Reuse gates:** `PagePlanEntry.columnConfig` participates in both the per-entry
  reuse predicate (via `columnConfigsEqual`) and the cross-tree `PageFingerprint`.
- **Materialization:** `materializePage` (`getPage`) builds the `MultiColumnBox` for
  every multicol page, seeding each column from its `ColumnFit.resumeInto` inner
  token at the `balancedColumnHeight`, wrapping them in a `MultiColumnBox` sized to
  full content inline width × balanced column height.
- **Column-rule paint:** the canvas painter's `"multicolumn"` arm draws the
  `column-rule` in the BACKGROUND phase (centered in the inter-column gap, spanning
  the `MultiColumnBox`'s block extent, derived from `box.writingMode`).
- **Column-aware cursor:** HIT-TEST (`column-at-point.ts` `locateColumnAtPoint`)
  restricts candidate lines to the clicked column's physical rect before the
  block-axis band-pick. LINE-NAV clamps the preserved inline goal to the target
  line's own inline extent before hit-test.
- **User-reachable:** `SET_SECTION_COLUMNS` editor action sets
  `columnCount`/`columnGap`/`columnRule` on the active section; wired into the
  example-app toolbar (1 / 2 / 3-column buttons).

Multi-column is feature-complete end-to-end (measure → materialize → paint →
cursor → user-action → column-rule → footnote-final-page balance). Remaining gap:
browser smoke verification.

### Text `[partial]`

`TextShaper` interface defined; `text-tokenize` produces wrap-units with stable IDs
and break opportunities; canvas shaper supplies font metrics, cluster boundaries,
and (uniform-direction) bidi levels.

Known gaps:
- **UAX #14 line-break algorithm** is **implemented** (`layout/uax14/`): a
  hand-rolled conformant rule engine (`lineBreakOpportunities` / `lineBreakClass`,
  rules LB1–LB31 with §8.2 number tailoring) backed by a committed Unicode
  break-property table, passing the full `LineBreakTest.txt` suite. It feeds the
  canvas/mock shapers' break opportunities and is the IFC wrap loop's break
  authority. CJK paragraphs wrap between ideographs; NBSP/`GL` glue holds its
  neighbours together; hyphens break. `cjBreakable` selects the CSS `line-break`
  behavior for CJ small-kana.
- **UAX #29 grapheme cluster boundaries** are correct: `segmentClusters` groups
  graphemes via `Intl.Segmenter` (`graphemeClusters`), so a base + combining marks,
  a surrogate-pair emoji, an emoji ZWJ sequence, and a regional-indicator flag are
  each one cluster. The gap is glyph *metrics*, not boundaries: a cluster's advance
  is one base width per grapheme (combining marks add 0), an approximation of true
  complex-script positioning until a HarfBuzz-quality shaper is wired.
- **Manual hyphenation** (`hyphens: manual`, the cascade default — authored U+00AD
  SOFT HYPHENs) is `[implemented]` end-to-end: zero-advance soft hyphen, the IFC
  producer that synthesizes `hyphenBreaks`, `none`-suppression, the `tryHyphenSplit`
  "-" glyph, and the D.4 hyphen-pair page-break back-off. **Dictionary `auto`
  hyphenation** is `[implemented]`: the `language` + `hyphenateLimitChars` cascade
  properties; the injected `Hyphenator` capability (`LayoutConfig.hyphenator`,
  interface + mock in `layout/hyphenator.ts`, threaded to every tokenization site);
  the AUTO producer arm in the IFC; the concrete Liang hyphenator
  (`createLiangHyphenator(languages)` in `@taleweaver/print`) fed per-language
  `PatternSet` data from `@taleweaver/hyphenation-<lang>` packages
  (`@taleweaver/hyphenation-en-us` ships over public-domain TeX patterns). The
  `PatternSet` data type lives in core. Adding a language is data (publish another
  `@taleweaver/hyphenation-<lang>` package and pass its `PatternSet` in). When no
  hyphenator is configured, `auto` falls back to `manual` — the correct CSS-UA
  behavior when no hyphenation resource exists.
- **Tab stops** are `[implemented]` end-to-end, modeled the Google-Docs way (a
  paragraph stop list, NOT CSS `tab-size`). A `tabStops` block-attr (`{position,
  alignment: left|center|right|decimal|content-edge, leader: none|dot|dash|line}`) +
  a scalar `defaultTabStop` (px, default 48 = 0.5in, inherits) cascade onto
  `ComputedStyle`/`UsedStyle`. A tab is the `"tab"` inline EMBED (atomic, one
  offset), so caret/click/selection/bidi reuse the inline-block leaf path with no
  tab-specific cursor code. The IFC resolves each tab's position-dependent advance at
  the wrap-loop overflow-check seam (`nextStop`, a nearest-ahead min-scan over each
  stop's effective position; left/default-grid + bounded look-ahead for
  right/center/decimal/content-edge — `content-edge` right-aligns to the line content
  edge `lineInlineSize`); the `IFCState` cache gates on `tabStops`/`defaultTabStop`.
  Pressing **Tab** inserts the embed (`INSERT_TAB`, discrete undo) except when the
  caret is in a list-item block (Tab/Shift+Tab → `LIST_INDENT`/`LIST_OUTDENT`);
  `SET_TAB_STOPS` sets the stop list. Out follow-ups: ruler UI, bar tabs, locale
  decimal separator, per-segment justify, and `SET_TAB_STOPS` inside embed/template
  bodies.

A legacy `TextMeasurer` interface exists alongside `TextShaper` for backwards
compatibility; new code uses `TextShaper`.

### `cursor/` `[implemented]`

Selection types, `moveByCharacter`, `moveByWord`, `selectWord`,
`expandSelection`. Pure operations; consumed correctly by editor action handlers.

### `editor/` `[partial]`

Reducer, action handlers, geometry queries, line navigation all present. Action
coverage is broad: insert text, delete (backward, forward, by word, by line), move
(char, word, line, document boundary), expand selection, apply inline style, set
block type, insert node.

Known gaps:
- **Cursor placement within a word broken across lines** — `[implemented]` for both
  within-word split paths: (1) manual hyphenation — a word splits at an authored
  U+00AD SOFT HYPHEN; the soft hyphen is a real 1-unit source char that stays in the
  offset↔x map despite zero width (offsets before/after share an x). (2)
  `overflow-wrap: break-word` — a long unbreakable word splits at a grapheme boundary
  (the editor BODY default for Google-Docs parity). `overflow-wrap: anywhere` ALSO
  ships: identical used-layout break to `break-word`, plus it collapses min-content to
  the widest single grapheme. `word-break: break-all/keep-all` is deliberately OUT of
  scope.

### Lists & numbering `[implemented]`

The flat Google-Docs list model is shipped end-to-end. A "list" is a document-order
run of `list-item` LEAF blocks sharing a `listId` attr; nesting is the per-item
`listLevel`; per-list numbering config lives in the `listDefs` Y.Doc side-table (4th
top-level map). The old STRUCTURAL model (a `list` container wrapping `list-item`s)
is gone: the `list` component and `components/list.ts` were deleted, and a
`migrate-list-structure` migration upgrades legacy documents.

- **State** (`1.1-state.md`): `listDefs` map (`getListDef(s)` /
  `getListDefsForState` / `writeListDefInTx` / `classifyListDef`), tracked as a 4th
  UndoManager scope; flat list-item attrs (`listId`/`listLevel`/`listCounterOverride`);
  ops `setListType` and `setListRestart`; `newListId`.
- **Numbering service** (`numbering/`, `1.2-render.md`): a general render-time
  `computeCounters` engine + `collectListEvents` collector + `listCounterRenumberedBlocks`
  diff. Pure, render-time-only. Lists are the first consumer; footnotes/custom
  components are intended future consumers.
- **Render** (`1.2-render.md`): full + incremental render compute the counter map and
  expose it via `RenderContext.counterValue`; the `list-item` component bakes the
  bullet/number into `style.markerText` and stamps `metadata.list`
  (`level`/`listId`/`ordered`) for the digital viewer's `<ul>/<ol>` grouping;
  `RenderOutput.listCounters` caches the per-cycle map.
- **Layout** (BFC): the BFC reads the render-baked `markerText` only — it COUNTS
  nothing. `layout/list-counter.ts` deleted.
- **Editing** (`1.5-editor.md`): `TOGGLE_LIST` (flat unified toggle), `SET_LIST_TYPE`,
  `SET_LIST_RESTART`, `LIST_INDENT`/`LIST_OUTDENT`; Enter on an empty list-item exits
  the list; Backspace at offset 0 outdents / un-lists; `INDENT`/`OUTDENT` skip
  list-items; Tab/Shift+Tab route to LIST_INDENT/OUTDENT.

Browser smoke for the list editing UX rides the user's in-browser pass.

### Cross-references `[implemented]`

The Google-Docs reference field (NOT CSS `target-counter`) is shipped end-to-end:
an inline `cross-reference` `EmbedItem` (`properties: { targetId, refMode }`) that
displays a target's number or text and auto-updates. v1 supports `refMode: "number"
| "text" | "page"` against MAIN-tree targets; heading-number / bookmark / caption
references are deferred.

- **State** (`1.1-state.md`): `insertCrossReference` op + the `cross-reference` embed
  type (`CrossReferenceMode`); a POINTER that owns no body; `clonePastedSubtree`
  remaps a copied ref's `targetId` when the target is in the clone set. A dangling
  target is a legal state.
- **Render** (`1.2-render.md`): `resolveCrossReference` (number → numbering map; text
  → `extractText`; broken-ref otherwise); `expandInlineItems` renders the field as a
  one-token inline-block atom; `buildCrossReferenceIndex` (`targetId → hosts`) on
  `RenderOutput.crossReferenceIndex`, reused + invalidation-expanded on the
  incremental path.
- **Editing** (`1.5-editor.md`): `INSERT_CROSS_REFERENCE` action + handler with
  structural target validation (main-body caret, main-tree target, ordered list-item
  for `"number"`, inline-bearing for `"text"` and `"page"`). A non-collapsed
  selection is replaced on insert via `prepareEmbedInsertPoint`.

Deferred follow-ups: heading-number references (needs heading numbering), footnote-
number references, bookmarks, captions. Browser smoke of the live insertion UX rides
the user's in-browser pass.

### Layout-dependent page-fields `[implemented]` (browser smoke pending)

Header/footer **page-number** + document-global **page-count** fields that read
PAGINATED layout results. A `page-field` inline-block embed renders a page-agnostic
placeholder (`PAGE_FIELD_RESERVED_GLYPHS` reserved sizing glyphs at one offset / one
IFC token); the value is bound LATE at materialize, NOT at render.

- **State** (`1.1-state.md`): `insertPageField` op + the `page-field` embed type
  (`PageFieldKind` = `"page-number" | "page-count"`; `PageFieldNumberStyle`); a
  POINTER that owns no body. Routes the write to the caret's owning tree via
  `resolveBlock`, so it can land in a header/footer body.
- **Render** (`1.2-render.md`): `expandInlineItems` emits the placeholder atom +
  `metadata.{embedType, fieldKind, numberStyle}`.
- **Layout** (`2.3-pagination.md`): `collectPageFields` (cascaded render trees →
  `FieldSpec[]` keyed by render key) → `resolvePageFields` (post-pagination;
  page-count from `plan.entries.length`; per-field max widths) →
  `substituteLayoutFields` at materialize (spine-clone leaf value substitution,
  identity-preserving) → the §4.4 bounded width-convergence loop
  (`field-convergence.ts` + `patch-field-widths.ts`) that grows a template field's
  reservation + re-runs the CHEAP measure passes when a wide value would wrap the
  header, 2-cycle-pinned.
- **Editing** (`1.5-editor.md`): `INSERT_PAGE_NUMBER` / `INSERT_PAGE_COUNT` action +
  handler, gated to a `templateContent` (header/footer) context — a no-op in the
  main body and footnote bodies. A "command" undo unit.

**Page-number-mode cross-references `[implemented]`.** A `"page"`-mode cross-reference
displays the target block's page number, resolved late from paginated layout and
auto-updating as the target moves pages. The layout-field `FieldSpec` is a
discriminated union (`PageFieldSpec | CrossRefPageSpec`, discriminant `fieldType`);
`collectPageFields` emits a `CrossRefPageSpec` for each page-mode placeholder atom.
`resolvePageFields` resolves a `cross-ref-page` to the target's 1-based page via
`pageOfFieldTarget(plan, targetId, parentOf)`: a top-level target → its own first
page (`pageSpanOfBlock(targetId).first`); a **nested** target → the page where its
nearest top-level-indexed ancestor BEGINS, via the injected `parentOf` capability
(`makeBlockParentLookup(state)`, built in the editor layer + threaded through
`layoutTree`/`layoutTreeIncremental`/`buildVirtualPaginatedTree` so layout stays
State-decoupled). A deleted/orphan target → `-1` → the `""` broken-ref sentinel.
`substituteLayoutFields` (renamed from `substitutePageFields`) stamps the resolved
page number at materialize; the `""` broken-ref sentinel renders as
`BROKEN_CROSS_REFERENCE_TEXT`. A main-body page-ref participates in the §4.4
width-convergence loop; the body root is width-patched (`patchRootFieldWidths`) at
BOTH the measure pass and at materialize so the atom is sized identically on both
sides, then the real value is substituted; the per-page fingerprint folds the value
into the page(s) hosting the ref so the host page re-materializes when the target
moves. `pageOfFieldTarget` is the shared resolver the TOC reuses.

Out of scope: main-body / footnote-body page-fields (not creatable via the editor).

### Table of contents `[implemented]`

A live, field-backed Table of Contents (derive-not-store) is implemented (engine
side). Shipped: the `table-of-contents` atomic-leaf component +
`INSERT_TABLE_OF_CONTENTS` action (levels/leader/showPageNumbers/indentStep
options); `collectPageFields` recognizes a TOC entry's page atom by its `/toc/`
render-key segment so each entry's page number rides the existing `cross-ref-page`
field pipeline; the `content-edge` `TabAlignment` (a right tab to the line content
edge — the flush-right page number); `navTarget`/`tocEntry` `LayoutBoxMetadata` for
click-nav; `buildTocEntrySubtree` render helper (heading text + leadered
content-edge tab + page atom per outline entry); `renderBlockBody`
`table-of-contents` branch synthesizes the entry subtree at render time (reads
options off block attrs, calls `getOutline`, returns entries as the TOC box's
children — derive-not-store, bypassing the zero-height stub); `RenderOutput.outlineSignature`
cache + incremental invalidation-expansion (a heading edit re-derives every TOC;
a non-heading edit reuses the TOC RenderNode by ref). The synthesized multi-child
TOC block paginates + fragments across page breaks and resolves each entry's page
number end-to-end. Click-to-navigate is wired in the DOM controller (`pickTocEntryAt`
+ a mousedown-defer gesture; a plain click jumps the caret to its heading, a drag
abandons nav). **Browser-gated:** the example-app Insert-menu entry and the
in-browser click + live-update smoke.

### Comments `[implemented]`

Google-Docs anchored comments are shipped end-to-end for the v1 main-body entry
surface: select a range, add a comment thread (author / body / replies / resolved),
the range highlights, and the anchor survives arbitrary edits
(typing / delete / split / merge / paste) — orphaning when the whole anchored range
is deleted.

- **Anchor** (`1.1-state.md`): paired zero-width `comment-start` / `comment-end`
  marker `EmbedItem`s in inline content, each carrying `properties.commentId`.
  Markers ARE content, so existing ops move/clone them for free. Each marker is one
  offset / one cursor stop, renders as a zero-width inline-block atom, serializes to
  `""` (excluded from `extractText`/`getWordCount`), and is STRIPPED on paste.
  Orphaning is DERIVED by the `buildCommentRangeIndex` marker scan (no eager hook).
- **Data** (`1.1-state.md`): the `comments` Y.Map — the 5th top-level map (side-table
  like `listDefs`), keyed by `CommentId`; `CommentRecord` with `replies: Y.Array<Y.Map>`.
  Comment ops (`addComment` / `resolveComment` / `reopenComment` / `deleteComment` /
  `addReply`, + `getComments`) are normal tracked content ops; the `comments` map is
  the 5th `Y.UndoManager` scope, so a comment is UNDOABLE AS CONTENT. Side-table-only
  ops surface `state.rootId` as the dirtyId.
- **Editing** (`1.5-editor.md`): `ADD_COMMENT` / `RESOLVE_COMMENT` / `REOPEN_COMMENT`
  / `DELETE_COMMENT` / `ADD_REPLY` actions (all `"command"` undo units; host-injected
  ids + timestamps). `ADD_COMMENT` no-ops on collapsed / cross-context / non-main-body
  selections, inserts end- then start-marker, and preserves the visible selection
  across the +2 marker offsets.
- **Geometry + overlay**: `getCommentRangeRects` (`cursor/comment-rects.ts`) is the
  standalone (non-paginated / external-host) query. The bundled DOM host resolves
  highlights PER PAGE in the controller (`resolveCommentHighlights` /
  `commentHighlightsForPage` → `resolveCommentRange` +
  `computeSelectionRectsForPage`), painted via `setCommentHighlights` /
  `clearCommentHighlights` — a host-driven amber band, two-stage resolve mirroring
  find, re-resolved from live state each `update()` (self-healing).
- **Serialization** (`1.7-serialization.md`): the binary serializer round-trips
  comments + markers losslessly.

Named follow-ups: commenting inside footnote / header / footer bodies (v1
`ADD_COMMENT` is main-body-only); the thread-panel UI; @-mentions / reactions /
non-text anchors; the `taleweaver-html` serializer dropping comments. Browser smoke
rides the user's in-browser pass.

### Change-tracking / Suggesting mode `[partial]`

Google-Docs "Suggesting" mode (every edit becomes a tracked, attributed,
accept/reject-able suggestion) is partially implemented.

State vocabulary (slice 1): the `suggestions` Y.Map — the 6th top-level side-table,
6th `Y.UndoManager` scope; `SuggestionId`/`SuggestionKind`/`SuggestionRecord` +
record IO; the THREE independent inline-attr dimensions
(`insertionSuggestionId` / `deletionSuggestionId` / `formattingSuggestionId`); the
two zero-width break embeds (`block-join-suggestion` / `block-split-suggestion`);
binary serialize round-trip.

Range index + read + Layer-1 hooks (slice 2): `buildSuggestionRangeIndex` /
`resolveSuggestionRange` / `getSuggestions(state) → ResolvedSuggestion[]`
(orphaned-by-absence derived); the optional `origin` param on BOTH `applyOperation`
and `runTransaction` + `SUGGESTION_RESOLVE_ORIGIN`; `History.advanceState(newState)`
for the non-undoable accept/reject path.

Creation ops (slice 3a–3c):
- `markFormatting` (slice 3a): stamps `formattingSuggestionId` over a span + writes a
  `formatting` record with `proposedAttrs`; same-author/same-proposal adjacency
  coalesces by id reuse.
- `markDeletion` (slice 3b): soft-delete a span's text (stamp `deletionSuggestionId`,
  text stays visible) via identity-preserving per-owning-block surgical strike
  (`applyDeletionStrikeInTx`), with delete-own-insertion + nesting +
  same-author coalescing rules.
- `mintInsertion` (slice 3c): inserts text carrying `insertionSuggestionId` +
  writes an `insertion` record, with insertion-point coalescing (same-author adjacent
  → reuse id).

Resolution ops (slice 3d):
- `acceptSuggestion`/`rejectSuggestion`: single-id resolve, dispatching by record
  `kind` (spec §6), each a NON-undoable `applyOperation(..., {origin:
  SUGGESTION_RESOLVE_ORIGIN})` via `applyResolveDecisionsInTx` (identity-preserving
  per-owning-block minimal diff); the editor handler calls `History.advanceState`.
- `acceptAll`/`rejectAll`: resolve every suggestion in one non-undoable txn via a
  COMBINED per-block rewrite (a run carrying insertion+deletion+formatting is walked
  once with a dominance order — acceptAll: deletion-drop dominates; rejectAll:
  insertion-drop dominates).

All of change-tracking slice 3 (create + resolve single + resolve all) is COMPLETE.

Multi-tree resolution (MT): `iterateAllBlocksInDocumentOrder`
(`state/document-order.ts`) is a 3-tree document-order walk (main `blocks`, then
each `embedContents` body, then each `templateContents` body). `buildSuggestionRangeIndex`
and the accept/reject resolve scan (`resolveBlockScan`) both walk all three trees.
The editor's suggesting-mode gate (`suggestionInputForBlock` /
`replaceSuggestionInputForBlock` / `isSuggestingInBlock`) is relaxed to track edits
in EVERY editing context (main body OR footnote/header/footer/template body).

Editor actions (slice 4):
- 4a: `ACCEPT_SUGGESTION`/`REJECT_SUGGESTION`/`ACCEPT_ALL_SUGGESTIONS`/`REJECT_ALL_SUGGESTIONS`
  via a `"resolve"` ActionClass.
- 4b: `EditorConfig.suggestingAuthor` + `newSuggestionId`/`newSuggestionInput` +
  `INSERT_TEXT` collapsed-caret branch → `mintInsertion`.
- 4c (i–iii): `DELETE_BACKWARD`, `DELETE_FORWARD`, `DELETE_WORD`, `DELETE_LINE` all
  SOFT-delete via the `deleteRangeOrSuggest` helper; paragraph-boundary deletes mark
  a suggested JOIN via `markBlockJoinSuggestion`.
- 4d-state (`replaceWithSuggestion`): type-over-selection in suggesting mode —
  soft-deletes the selection AND inserts new text at the selection start in ONE
  transaction, producing TWO records. FULLY IDENTITY-PRESERVING: the in-tx body
  strikes every block (including the start block) surgically via
  `applyDeletionStrikeInTx`, then inserts the suggested run via a `split-in-place`
  plan built PRE-tx against the post-strike `writes` items.
- 4d-editor: `handleInsertText` expanded-selection branch routes type-over-a-selection
  through `replaceWithSuggestion`; direct mode keeps the destructive `replaceRange`.
- PASTE-as-suggestion: `handlePaste` in suggesting mode routes through
  `replaceWithSuggestedFragment`.
- 4d-format: all 8 inline-format handlers (`TOGGLE_STYLE`, `SET_TEXT_COLOR`,
  `SET_HIGHLIGHT`, `SET_FONT_SIZE`, `SET_FONT_FAMILY`, `SET_LINK`,
  `SET_TEXT_TRANSFORM`, `CLEAR_FORMATTING`) are suggesting-aware via
  `applyAttrsOrSuggest` (direct mode: live `applyAttrsToRange`; suggesting mode:
  `markFormatting`).
- 4e state ops: `splitWithSuggestion` (suggested paragraph SPLIT — real
  `splitBlockAtPosition` + `block-split-suggestion` embed at the END of the first
  block + an `insertion` record, ONE transaction); `markBlockJoinSuggestion`
  (suggested JOIN — appends a `block-join-suggestion` embed at the END of block N +
  a `deletion` record, blocks stay SEPARATE).
- 4e resolve: `resolve(state, id, mode)` handles the two break embeds: drops the
  embed via `applyResolveDecisionsInTx`, then — when `(insertion && reject) ||
  (deletion && accept)` — merges N with its next sibling via
  `mergeWithNextSiblingLiveInTx` (same non-undoable transaction); `resolveAll`
  extends symmetrically, walking merge owners in REVERSE document order to handle
  cascaded merges correctly.
- 4e editor: collapsed Enter → `splitWithSuggestion`; Backspace/Delete at a PLAIN
  paragraph boundary → `markBlockJoinSuggestion`; non-collapsed SINGLE-BLOCK Enter →
  `splitWithSuggestionOverSelection`; CROSS-BLOCK non-collapsed Enter → routes through
  `replaceWithSuggestedFragment` with an EMPTY two-line break fragment.
- Paste / cross-block fragment (`replaceWithSuggestedFragment`): a possibly-multi-block
  selection is replaced by a possibly-multi-block tracked fragment via ONE pure
  structural plan `planReplaceWithSuggestedFragment` (allocate new block ids up-front,
  compute the full post-op layout as data, apply in ONE `applyOperation`). Built on
  `insertNewBlocksInTx`.

All of slice 4 + 4e + paste/cross-block-fragment is COMPLETE.

Render (slice 5):
- 5a render text-run visuals: `expandInlineItems` → `resolveSuggestionStyle`
  (insertion=author-color+underline, deletion=author-color+lineThrough,
  formatting=`proposedAttrs` preview + author-color underline indicator; deterministic
  `authorColorOf` palette; plain runs byte-identical via fast path).
- 5b render break-suggestion pilcrows: `expandInlineItems` peels `block-split-suggestion`
  / `block-join-suggestion` embeds into a VISIBLE pilcrow ¶ wrapped in a single
  inline-block atom (split=insertion-flavored, join=deletion-flavored).
- 5c-i preview-view projection foundation: `SuggestionView = "suggesting" | "final" |
  "original"` type + pure `itemVisibleInView(item, view)` predicate in
  `suggestions.ts`, barrel-exported.
- 5c-ii text-surface projection: `extractText(state, span, embedSerializer?, view?)`
  filters each item by `itemVisibleInView`; `getWordCount({suggestionView})` +
  `getSelectionWordCount(state, sel, view?)` thread it through.
- 5c-structural (text surface): `blockBoundaryMergesInView(items, view)` predicate
  (barrel-exported) — across a boundary that MERGES in the view the inter-block `"\n"`
  is SUPPRESSED in `extractText`. The RENDER-surface structural merge is DEFERRED
  (latent until a host wires a preview toggle; a render-tree merge that diverges from
  the state block tree needs a layout-integration decision first — see below).
- 5c-iii render projection: `RenderOptions.suggestionView` threads through
  `render()`/`renderIncremental()` → `RenderContext.suggestionView` →
  `expandInlineItems`. `RenderOutput.suggestionView` records the view so incremental
  dispatch FALLS BACK to the full path on a view switch.
- 6a host range-rects query: `getSuggestionRangeRects(state, layoutTree, shaper,
  suggestionId)` in `cursor/suggestion-rects.ts` (barrel-exported).
- 6b DOM-controller overlay: `setSuggestionHighlights(highlights)` /
  `clearSuggestionHighlights()` on the DOM controller — exact mirror of the comment
  overlay; two-stage self-healing; painting a TEAL band BELOW the comment band (full
  layering: bg→suggestion→comment→find→selection→text) via `paintSuggestionHighlights`
  + `SuggestionHighlightRect` + `addSuggestionHighlightDirty`.

REMAINING:
- **`5c-structural` RENDER surface — DEFERRED.** The RENDER block-box merge
  (rendering two state blocks as ONE merged paragraph box in a projected view) is
  deferred for two evidenced reasons: (1) a merged node (one render `ElementBox` for
  two state blocks) breaks a layout invariant — `groupChildren`'s anonymous-block keys
  + the BFC child-iteration assume render-block-count == state-block-count, so a merge
  silently corrupts geometry / incremental-reuse keys. Completing it needs a
  layout-integration decision (thread a per-node state-blockId map into `groupChildren`;
  OR unfold merged nodes at the layout boundary; OR move the merge to paint-time).
  (2) The preview-render surface is UNWIRED — no host renders `final`/`original` to
  canvas yet. The shipped `blockBoundaryMergesInView` predicate + the clean render
  hook point (`render-core.ts` container loop) are the foundation it will reuse. The
  `getWordCount` per-block projected-count gap is deliberate (per-block by design).
  See `1.1-state.md` "The `suggestions` map" + `1.5-editor.md`.

### `accessibility/` `[implemented]` (core projection + dom mirror builder) / `[partial]` (dom mirror materialization)

The **core accessibility projection** is `[implemented]`:
`buildAccessibilityTree(state, { suggestionView? })` (`packages/core/src/accessibility/`)
produces a pure, geometry-free `AccessibilityNode` tree. It maps each block type to
an ARIA-aligned role (document / paragraph / heading+level / list+listitem [synthetic
grouping by `listId`/`listLevel`] / table+row+cell+columnheader [first
`headerRowCount` rows] / img / separator / navigation / banner / contentinfo /
doc-footnote; `section` flattens to no node), splits text-bearing blocks into
`AccessibilityTextRun`s carrying literal block offsets + emphasis / link / suggestion
/ inComment / noteref provenance (and, for a page-valued field, a standalone run with
`fieldKind` + `fieldKey` + a `""` placeholder for late value binding at the dom
boundary), and reads a `suggestionView`. Reading order = document order: main body,
then footnote bodies (embedContents), then header/footer template bodies
(templateContents). A runtime exhaustiveness guard throws on any unmapped block type.
Surfaced on the core barrel (`buildAccessibilityTree` + `AccessibilityNode` /
`AccessibilityRole` / `AccessibilityTextRun` / `BuildAccessibilityTreeOptions`). See
[`1.8-accessibility.md`](./1-core/1.8-accessibility.md).

The **dom mirror builder** is `[implemented]`: `buildDomMirror(node, doc?)`
(`packages/print/src/dom-mirror.ts`, on the print barrel) is a pure structural
transform from an `AccessibilityNode` tree to a detached, visually-hidden (clip
technique), AT-visible semantic DOM subtree — all roles mapped exhaustively
(document/paragraph/heading+level/list/listitem/table/row/cell/columnheader/img/
separator/navigation/banner/contentinfo/doc-footnote), text runs rendered with
kind-chosen wrappers (noteref/link[sanitized via `isExportSafeLinkUrl`]/ins/del/span),
innermost-first emphasis nesting, and `data-offset-start`/`data-offset-end` literal-
offset attrs. `resolveFieldText` / `resolveTreeFields` rewrite a page-valued field
run's `""` placeholder to its resolved value. See
[`2-print/2.10-dom-mirror.md`](./2-print/2.10-dom-mirror.md).

The **dom mirror materialization** is `[partial]`: `createDomMirrorHost`
(`packages/print/src/dom-mirror-host.ts`, on the print barrel) mounts the hidden,
AT-visible, focusable `contenteditable role=textbox` mirror into the editor
container, and on each paint (`syncTree(tree, resolvedFields?)`) first resolves
page-valued field runs then reconciles via incremental keyed reconciliation
(`DomMirrorCache` / `reconcileMirror` in `dom-mirror-cache.ts`) — O(changed) per
paint, with persistent DOM identity (block nodes keyed by stable `sourceBlockId`).
It owns the controlled-contenteditable input wiring (`beforeinput` is
`preventDefault`ed, IME composition is bracketed, `syncTree` no-ops mid-composition
so a live composition `Range` survives). The engine `Position`/`Span` ⇄ browser-
`Selection` mapping lives in `dom-mirror-selection.ts` (`positionFromMirrorNode` /
`locateOffsetInMirror` / `placeMirrorSelection` / `readMirrorSelection`). The editor
controller wires the host behind a default-off `accessibilityMirror` flag on
`EditorControllerOptions`; when ON, the mirror SUBSUMES the `<textarea>` as the
single focus / IME / clipboard host, the canvas is marked `aria-hidden`, and the
controller calls `syncTree` + `syncSelection` after each paint. A named landmark
carries its accessible name: the `navigation` role emits `aria-label` from
`node.name`; the incremental reconciler's `syncElementAttrs` keeps a reused `<nav>`'s
`aria-label` and a reused `<li>`'s `value` (ordered-list ordinal) in lockstep with
`buildElement`. Page-field / cross-reference-"page" resolved text is implemented:
`VirtualLayoutTree.globalFieldValues: ReadonlyMap<string, string>` exposes
layout-resolved values; `DomMirrorHost.syncTree(tree, resolvedFields?)` runs
`resolveTreeFields` at the top of `syncTree`, upstream of `reconcileMirror`. See
[`2-print/2.11-dom-mirror-host.md`](./2-print/2.11-dom-mirror-host.md).

Still pending: flipping the `accessibilityMirror` default ON (gated on the user's
in-browser smoke), and the real screen-reader / IME browser smoke.

### `perf/` `[implemented]`

Flag-gated `markStart` / `markEnd` / `recordSample` / `report` / `resetPerfTrace`.
Markers installed across cascade, layout, paint, and read-path functions. React
example exposes `window.__perfReport()` / `window.__perfReset()` when a perf fixture
is loaded.

### Vertical writing modes (`vertical-rl`, `vertical-lr`) `[partial]`

A cross-cutting feature spanning styles, cascade, layout, and the editing-geometry
layer. The `writingMode` block attribute flows through the component-set convention
(`components/leaf-style-attrs.ts`) into the cascade (inherited, per `PROPERTY_META`)
and layout.

Implemented:
- **Axis arithmetic.** `logicalToPhysical` handles all three modes via an exhaustive
  switch guarded by `assertNeverWritingMode` (a future 4th mode is a compile error at
  every call site); `axisMapFor` exposes which physical axis each logical axis maps
  to; `physicalToLogical` is the exact inverse. See
  [`1-core/1.0-styles.md`](./1-core/1.0-styles.md).
- **Layout.** Block-advancement and inline-extent sites operate on logical
  `blockSize`/`inlineSize`; inline-block sizing projects the child's physical box onto
  the parent IFC's axes via `axisMapFor`; the bidi reorder packs visual order into the
  logical `inlineOffset`. The `vertical-rl` block-axis mirror is applied by a
  post-layout `physicalizeVertical` pass at both layout seams (`paginateRoot` and
  `materializePage`); `horizontal-tb` and `vertical-lr` are reference-identity no-ops.
- **Editing geometry.** Caret placement, hit-test, selection rects, and
  line-navigation read already-physical box coords through `axisMapFor` to operate on
  the active inline/block axes; the bidi cursor is generalized to the inline axis. See
  [`1-core/1.5-editor.md`](./1-core/1.5-editor.md).
- **Border-side mapping.** `physicalBorderSides` resolves logical border/padding sides
  to physical top/right/bottom/left for every (writingMode, direction) combo via an
  exhaustive switch. See
  [`2-print/2.5-canvas-renderer.md`](./2-print/2.5-canvas-renderer.md).

Missing (the browser-gated remainder):
- **Glyph rotation for vertical text** — per-run ±90° rotation so a
  horizontal-script run paints downward along the inline axis. The renderer still
  paints horizontally.
- **Caret-bar orientation** — drawing the caret's block-axis extent as a horizontal
  bar in vertical modes; the caret still draws as a vertical bar.
- **Controller projection** — the DOM controller's projection of the inline/block-
  semantic `PixelPosition` to CSS left/top for vertical modes.
- **Slot-zone hit-test** — `pickRegionByBand`'s header/footer/footnote zone
  classification stays on the `horizontal-tb` (vertical-band) path; only the BODY
  hit-test is axis-generalized.

---

## `print`

### `editor-controller` `[partial]`

Two render modes. **Paginated** is the active primary path: the engine produces a
virtualized page model (`layoutTree: LayoutBox | VirtualLayoutTree`), which drives a
per-page canvas pool with per-page paint caches; paint, caret, mouse hit-test, and
selection rects are resolved per page via `getPage(visible ∪ cursorPage)` — **no
consumer ever positions the whole document**. For a spanning block (one taller than a
page) both line navigation (`collectBlockLinesAcrossPages`) and selection/find/comment
rects (`selectionRectsAcrossPages`) use per-page paths; the cursor/ defensive fallback
guards dev-throw / clamp-to-document-boundary / resolve-per-page (footnote bodies map
via `pageIndexOfFootnoteBlock`). The `materializeAll()`/`resolvePositionedTree`/
`getPositionedTree` whole-tree-positioning bridge has been **deleted**; `paginateRoot`
survives only as (a) the float/`clear` legacy layout path and (b) a test-only
equivalence oracle. **Non-paginated single-canvas** is the fallback — one canvas +
a fully-positioned `LayoutBox`, used for identity sizing and the unsupported-feature
path (`position:absolute`, multi-column-float, and float+footnote documents fall back
to the legacy full positioned tree in v1; single-column float/`clear` docs now take
the virtualized path). Input listeners, key-handler integration, cursor blink, scroll
syncing, and image-cache integration are all present. See
`2-print/2.8-editor-controller.md` for the virtual page model.

### `canvas-renderer` `[implemented]`

`paintCanvas` and `paintPage` both work. Viewport culling works. Two paint paths
(with cache, without cache) both correct. Root short-circuit in
`walkAndDetectChanges` fires correctly when wired via the controller's paint cache.
The overlay band is `background → suggestion highlights → comment highlights → match
highlights → selection → text`. The find-match highlight overlay (`MatchHighlightRect[]`)
paints under the selection tint and under text, with `addMatchHighlightDirty` per-page
dirty marking. The comment highlight overlay (`CommentHighlightRect[]`, amber) paints
below the find highlights; the controller's `setCommentHighlights` /
`clearCommentHighlights` store `{ commentId, active }` and re-resolve each comment's
range from live state every `update()`. The find SESSION + navigation shipped:
`findStart`/`findNext`/`findPrev`/`findClose` (returning `FindStatus`) run
`findMatches`, highlight + cycle (wrap) the active match, scroll it into view via
`scrollVisualIntoView`, and live-recompute on every doc edit in `update()`. The
controller's replace methods (`replaceActive` / `replaceAll`) + public `findStatus()`
dispatches `REPLACE_MATCH` / `REPLACE_ALL`. `EditorView` exposes them through a
`forwardRef` + `useImperativeHandle` `EditorViewHandle`. The Ctrl+F / Ctrl+H
find-bar React UI (the bar component + keyboard wiring) is the remaining F&R-UI
slice.

Paint strategy is "clear-dirty + full-repaint" rather than true per-box compositing
— the v1 ceiling without a layer compositor.

### `paint-cache` `[implemented]`

`createPaintCache`, per-`LayoutBox` hash storage via `WeakMap`, last-root tracking,
`hashPaintInputs`. Wired into the editor controller.

### `canvas-shaper` `[partial]`

Canvas-based default text shaper. Uniform-direction bidi, UAX #29 grapheme-cluster
boundaries (via `Intl.Segmenter` / `graphemeClusters`), font metrics, and UAX #14
break opportunities (via the `core` `toBreakOpportunities` adapter over the
`layout/uax14` classifier). Paired with a legacy `canvas-measurer` for callers that
still consume the older `TextMeasurer` interface.

Gaps: per-cluster UAX #9 bidi, complex-script glyph metrics (cluster advances
approximate one base width per grapheme), hyphenation dictionaries.

The inter-word paint/measure mismatch (space advances dropped vs. measured) no
longer has a code cause: paint sums per-cluster `measureText` advances identically
to layout, and the letter/word-spacing slice adds the same per-cluster
`clusterSpacing` to both the shaper advances and the paint loop — so painted glyph
origins equal the laid-out advances by construction (`cluster-paint.test.ts` locks
it).

### Read-only DOM viewer `[implemented]`

The **digital view** (`@taleweaver/digital` backend, `packages/digital/src/dom-view/`)
renders a document `State` into real DOM the browser flows to any width:
`renderDocumentToDom` runs core's `render()` → `cascadePass()` → a recursive
node-walk that emits one DOM node per cascaded styled node (no engine geometry, no
pages). Node→DOM maps by first-match on metadata flags (`headingLevel`→`<h1..6>`,
`horizontalLine`→`<hr>`, `image`→`<img>`, section/`display:contents`→unwrap) then
cascaded `display`; `TextBox`→HTML-escaped text node wrapped by inline-markup tags +
a scheme-sanitized `<a href>`. Styling is inline via `computedStyleToInlineStyle`
(non-default props only; logical box-model sides → physical CSS sides through
`resolveLogicalSides`). Consecutive list-item siblings group into nested `<ul>/<ol>`
via a level-stack; the `suggestionView` option chooses suggesting (default) vs final.

Out of scope (print/page apparatus or separate features, NOT MVP cuts):
pagination/page-breaks/multicolumn fragmentation, headers/footers, footnote BODIES
(the anchor superscript still renders inline), editing/selection/caret/hit-test, and
the accessibility tree (the `dom-mirror` owns it). DOCUMENTED LIMITATION: the CSS
emitter does not emit `display` (tag choice carries it), so a cascaded
`display:flow-root` renders as `<div>`, dropping the BFC-establishing hint —
acceptable for a flowing read-only view (no floats/clear in this scope), a recorded
gap not a silent one. See [`3-digital/3.1-dom-view.md`](./3-digital/3.1-dom-view.md).

### Digital interactive controller `[implemented]`

`@taleweaver/digital`'s `editor-digital/` is the interactive `contenteditable`
editing backend (the digital peer of `print`'s canvas controller).
`createDigitalController(options)` returns `{ editorState, dispatch, focus, destroy
}`; all transitions funnel through one internal `dispatch` (→ `reduceEditor` →
reconciler → optional `onChange` host notification). It maps native `beforeinput`
(`map-before-input`), `keydown` (`map-digital-key` — a thin non-nav chord map that
deliberately avoids `print`'s geometric `NavIntent` mapper), `selectionchange`, IME
composition, and clipboard events to geometry-free `EditorAction`s; the
`digital-reconciler` diffs each new `EditorState` into minimal DOM mutations; the
`digital-selection-bridge` translates the browser `Selection` to core `Position`s by
walking `data-block-id` elements and measuring UTF-16 units. The browser owns caret
geometry/navigation. See
[`3-digital/3.2-digital-controller.md`](./3-digital/3.2-digital-controller.md).

### Other print helpers `[implemented]`

`key-handler` (DOM keyboard event → `EditorAction` mapping), `image-cache` (async
image loading with re-paint trigger), `font-config` (font defaults).

---

## `react`

### `use-editor` `[implemented]`

Hook returns the documented record. Reducer wiring works. Config construction stable
across renders.

### `editor-view` `[implemented]`

Mount / update / unmount lifecycle works. Controller wiring works. React.Profiler
instrumentation works.

---

## `pdf`

### Phase (a) — standard-14 text + page geometry `[implemented]`

`@taleweaver/pdf` emits a multi-page PDF from a positioned `PageBox` tree. The full
pipeline is present and tested: `pdf-writer` (indirect objects, stream objects, xref
+ trailer), `coordinate` (per-coordinate y-flip + 0.75 px→pt scale, MediaBox from
`PageBox` dimensions), `color` (CSS color → `rg`, alpha flattened),
`content-stream` (typed `rg`/`BT…Tj…ET` builder), `winansi` (WinAnsiEncoding incl.
the 0x80–0x9F smart-typography block), `font-provider` (the injected `PdfFontProvider`
+ default standard-14 provider), `page-emitter` (absolute per-cluster `Td`/`Tj`
placement, parent-relative origin accumulation incl. `relativeOffset`, recursion
through `children` / multicolumn `columns` / `absoluteChildren` /
header-footer-footnote slots, RTL right-edge walk, even-split fallback), and
`emit-pdf` (page streaming via `getPage(i)`, shared font resource dict, page tree +
catalog). See [`5-pdf/overview.md`](./5-pdf/overview.md).

### Phase (b) — vector graphics `[implemented]`

`page-emitter` walks the `PageBox` tree in two passes (background then foreground,
mirroring the canvas renderer's two `paintBox` calls). The background pass emits box
backgrounds (`backgroundColor`), per-side borders (via core's `physicalBorderSides`),
and horizontal rules; the foreground pass emits underline/line-through decorations
and tab leaders (line/dash via filled rects, dot via the 4-Bézier `fillCircle`). v1
boundaries: document-order stacking (no z-index reorder), no inline-fragment
border-edge suppression, `rgba()` flattened opaque.

### Phase (c.1) — embedded-font object-graph machinery `[implemented]`

The Type0 / CIDFontType2 composite-font graph is built and routed through the
provider's `writeFontObjects` seam: `font-provider` gained `writeFontObjects` +
a `PdfFontHandle` carrying `{ kind, baseFont, fontKey }` (dedup by `fontKey`);
`emit-pdf` de-dupes fonts by `fontKey` and delegates all font-object writing to the
provider; a mock embedded provider writes the full graph (`FontFile2` +
`FontDescriptor` + CIDFontType2 `/W` + Type0 `/Identity-H`) with 2-byte CID glyph
selection; `tounicode` builds a valid `ToUnicode` CMap (UTF-16BE incl. surrogate
pairs) for extractable text. Std-14 and embedded fonts coexist in one doc.

### Phases (c.2a/c.2b) — real embedded font provider (TrueType-glyf + OpenType-CFF) `[implemented]`

Documents set in a real `.ttf` OR `.otf` now export with embedded, extractable text.
A pure-byte `truetype-parser` (`parseSfnt`) reads the sfnt table directory +
`head`/`hhea`/`maxp`/`hmtx`/`cmap` (formats 4 & 12) + `OS-2`/`post`/`name` — the
SAME shared path for both flavours — exposing `cmapLookup`, `advanceOf`, a 1000-em
`FontDescriptor`, and a `glyphFormat: "glyf" | "cff"` discriminant. A `cff-parser`
reads the `CFF ` table's INDEX / Top-DICT / String-INDEX / charset to detect a
CID-keyed font, build the GID→CID map, and resolve the ROS, surfaced as `cff: CffInfo`.
The graph writer branches on embed kind: `glyf` → `FontFile2` + CIDFontType2
(`/CIDToGIDMap /Identity`, CID === GID); `cff` → `FontFile3` (`/Subtype
/CIDFontType0C`) + CIDFontType0. `createEmbeddedFontProvider({ fonts })` (on the
barrel) parses each font once, resolves known families to `embedded` handles (unknown
→ std-14 fallback), and encodes the 2-byte big-endian emitted code (`Identity-H`);
both non-CID-keyed (CID = GID) and CID-keyed (charset GID→CID, common CJK `.otf`)
are handled. The embedded program is SUBSET (only the used glyphs' outlines; see
Phase (c.3) below), with a 6-letter subset tag on `/BaseFont` + `/FontName`.

### Phase (d.1) — image XObject machinery `[implemented]`

Images now export to PDF. `image-provider` adds the injected `PdfImageProvider` seam
(`resolveImage` + `writeImageObjects`) + `PdfImageHandle` (`{ imageKey }`);
`content-stream` gained `drawImageXObject` (`q <cm> cm /Im<n> Do Q`); `page-emitter`
draws each image box in the BACKGROUND phase (XObject `Do` with `cm` from `rectYUp`
— or a grey `#f0f0f0` placeholder when the provider returns `null`); `emit-pdf`
de-dupes by `imageKey`, writes the XObjects through the provider, and emits a
per-page `/XObject` resource sub-dict ONLY when images are used.

### Phase (c.3) — font subsetting `[implemented]`

The embedded program carries only the glyphs the document uses (plus GID 0
`.notdef`). GID/CID numbering is PRESERVED — only the outline data shrinks.
`subset-glyf` rebuilds `glyf`+`loca` keeping the used outlines plus their
transitively-referenced composite components (`computeGlyfClosure`), zeroes the
rest, and reassembles the sfnt via `sfnt-assembler`. `subset-cff` rebuilds the
CharStrings INDEX (used charstrings verbatim, each unused → a single `endchar`) and
re-emits the whole `CFF ` table in canonical layout, preserving real DICT operands
byte-for-byte. `subset-font` dispatches by `glyphFormat` and derives a deterministic
6-uppercase-letter subset tag (`subsetTag`). Separable future refinements: GID-renumber
/ table-overhead compaction, unused-table stripping (GSUB/GPOS/kern), `/CIDSet`
(PDF/A only).

### Phase (d.2) — FlateDecode stream compression `[implemented]`

Zero-dependency zlib/DEFLATE codec wired into `pdf-writer.ts`. Stream payloads are
compressed with `/Filter /FlateDecode` (RFC 1950 zlib + RFC 1951 DEFLATE, fixed-
Huffman v1 + LZ77 hash-chain matching) when compression reduces size; the no-
expansion guard falls back to storing the payload uncompressed. `pdf-parse.ts`'s
`streamObject` inflates transparently — stored, fixed-Huffman, and dynamic-Huffman
blocks all decode (`inflate.ts` is a complete RFC 1951 decoder). Codec modules:
`bit-io.ts` (BitWriter / BitReader), `flate-tables.ts` (`buildCanonicalCodes`
canonical-Huffman builder), `inflate.ts` (decoder), `deflate.ts` (LZ77 hash-chain +
fixed-Huffman + stored fallback), `zlib.ts` (Adler-32 + RFC 1950 framing). Deferred
refinements: dynamic-Huffman ENCODE and lazy LZ77 matching. See
[`5-pdf/overview.md`](./5-pdf/overview.md).

### Phase (d.3b-1) — in-package image provider + JPEG `/DCTDecode` embedding `[implemented]`

`createImageProvider({ images })` (on the package barrel) ships a host-injectable
image provider that parses and embeds images in-package, headless. The host supplies
a `Map<src, Uint8Array>` of source file bytes.

JPEG embedding is complete via `/DCTDecode`: `jpeg-parser.ts` parses the `SOFn`
marker for dims/precision/component-count (rejecting arithmetic/lossless/differential
SOFs) and detects an Adobe `APP14` segment to flag inverted-CMYK images — yielding
colorspace `DeviceGray`/`DeviceRGB`/`DeviceCMYK` and a `/Decode [1 0 1 0 1 0 1 0]`
inversion for Adobe CMYK. The JPEG bytes embed **verbatim** (no pixel decode; the PDF
renderer decodes natively via `/DCTDecode`). `writeStream` skips its own
`FlateDecode` compression when the caller's dict already carries a `/Filter`.

A malformed JPEG/PNG throws `MalformedImageError` at resolve time; an unrecognized
or absent format returns `null`, drawing the grey `#f0f0f0` placeholder.
`createImageProvider` caches each `src`'s resolve result.

### Phase (d.3b-2) — in-package PNG decode + embedding `[implemented]`

PNG is DECODED in-package and re-embedded as a `/FlateDecode` Image XObject (PDF has
no native PNG filter). `png-parser.ts`'s `parsePng` validates the signature + IHDR
and walks chunks (PLTE / tRNS / concatenated IDAT); `png-decode.ts`'s `decodePng`
inflates the IDAT via `zlibDecompress`, reverses the 5 PNG scanline filters
(None/Sub/Up/Average/Paeth), and resolves the color type to PDF samples:
`DeviceGray`, `DeviceRGB`, or `[/Indexed /DeviceRGB hival <hex>]` at native
`BitsPerComponent` (1/2/4/8). Transparency: colorType-4/6 alpha and palette `tRNS` →
a separate 8-bit `DeviceGray` `/SMask` Image XObject; grayscale/RGB `tRNS` → a
native-space color-key `/Mask` array. 16-bit depth and Adam7 interlacing are
loud-rejected (`MalformedImageError`) as separable refinements.

CFF2 / variable fonts, color/bitmap OpenType outline tables
(`COLR`/`CBDT`/`sbix`/`SVG `), multi-face/synthetic-bold-italic, 16-bit-depth /
interlaced PNG, and color spaces beyond `DeviceGray`/`DeviceRGB`/`DeviceCMYK`/
`/Indexed` are separate deferred whole features.

### Hyperlink `/Link` annotations `[implemented]`

Document hyperlinks export as clickable `/Link` annotations with a `/URI` action
(ISO 32000-1 §12.5.6.5). The inline `link` attr is threaded onto the layout text run
— render `TextBox.link` → IFC `Token.link` → `TextRunBox.link` (per-run identity
metadata, opaque to geometry, copied through every reorder / hyphen-split / bidi-split
rebuild). `page-emitter` collects one `{ url, rect }` per laid-out linked run whose
URL passes `isOpenableLinkUrl`, covering body + header / footer / footnote slots;
`emit-pdf` writes one `/Link` annotation object per rect (`/Subtype /Link`, `/Rect`,
`/Border [0 0 0]`, `/A << … /S /URI /URI (…) >>` with the URL escaped via
`pdfString`), appending `/Annots` to the page dict ONLY when the page carries ≥1
link. A non-Latin1 (>0xFF) URL is gracefully skipped. The `isOpenableLinkUrl` /
`isExportSafeLinkUrl` predicates live in `@taleweaver/core` (`url-safety.ts`, on the
barrel), shared by `print` and `pdf`. Autolink is out.

### Internal `/GoTo` destination links `[implemented]`

Cross-references and table-of-contents entries export as clickable internal `/Link`
annotations with a `/GoTo` action (ISO 32000-1 §12.3.2.2). Render stamps the
cross-ref atom's target block id onto the layout tree (`metadata.targetId` →
`InlineBlockBox.targetId`, opaque to geometry, copied through every rebuild); a TOC
entry container carries `BlockBox.metadata.navTarget`. `page-emitter` collects one
`{ targetId, rect }` per laid-out cross-ref atom and per TOC-entry line (foreground
walk only, de-duped). `emit-pdf` resolves each `targetId` to a concrete destination
via an injected `resolveInternalDestination` closure — built controller-side by
core's `makeInternalDestinationResolver` over `resolvePixelPosition` +
`pageOfFieldTarget` (`resolve-goto-destination.ts`) — and writes one `/Link`
annotation per rect with a `/XYZ left top 0` destination. A two-pass page-object-id
pre-allocation lets a `/GoTo` annot forward-reference a later page's object id.
Targets that resolve to no page are skipped.

### PDF outline / bookmarks `[implemented]`

The document heading hierarchy exports as a clickable `/Outlines` bookmark tree
(ISO 32000-1 §12.3.3). Core `buildPdfOutline` (`layout/pdf-outline.ts`) reads
headings via `getOutline` in the `"final"` suggestion view, nests them by heading
level (a level skip attaches to the nearest strictly-shallower ancestor), and
resolves each heading's destination via `resolveGotoDestination` → a
`PdfOutlineNode[]`. `emit-pdf`, given `EmitPdfInput.outline`, pre-allocates one
object id per item (depth-first), then writes the `/Outlines` root + one item dict
per node — `/Title` via `pdfTextString` (UTF-16BE for non-Latin-1 / CJK headings),
`/Dest [<pageObj> 0 R /XYZ left top 0]`, doubly-linked `/Prev`/`/Next`, `/Parent`,
`/First`/`/Last`/positive-`/Count` for nodes with children — and links `/Outlines`
from the Catalog. All items are emitted OPEN. An empty (or absent) `outline` emits
no `/Outlines`.

### App-facing PDF-export surface `[implemented]`

`EditorController.exportToPdf(emit: PdfEmitter): Uint8Array` (`packages/print/`)
composes the whole emit pipeline from the live document as a **pure query** — no
mutation. It reads the controller's current `state` + `virtualTree` + measurer and
builds a `PrintPdfEmitInput`: page count from `virtualTree.plan.entries.length`, each
`PageBox` from `virtualTree.getPage(i)`, the internal-link resolver via
`makeInternalDestinationResolver`, the bookmark tree via `buildPdfOutline`, and the
raw core `AccessibilityNode` projection (`buildAccessibilityTree`, unmapped). It then
hands that input to the injected `emit` and returns the PDF bytes; triggering a
browser download is the host's concern.

`@taleweaver/print` imports **zero** `@taleweaver/pdf` symbols — the dependency is
one-way (`pdf → print`). The host bridges the two by passing
`createPdfEmitter(...)` from `@taleweaver/pdf` as the `emit` argument.

Font and image bytes are an **injection seam**: `createPdfEmitter({ fontProvider?,
imageProvider? })` lets the host supply them. Absent a `fontProvider`, text embeds
with the standard-14 fonts; absent an `imageProvider`, images render as grey
placeholders.

Still `[missing]`: the embedded-font-from-loaded-fonts bridge (a default
`fontProvider` built from the document's actually-loaded fonts); a download / save UI
in the example app; and export of non-paginated (float/clear) documents
(`exportToPdf` throws for those).

### Tagged-PDF accessibility `[implemented]`

Exported PDFs carry a logical structure tree (`/StructTreeRoot` + marked content +
`/MarkInfo`). `emitPdf` consumes an injected `EmitPdfInput.structureTree` — a
pdf-package `PdfStructureNode` tree the controller builds from the core
`AccessibilityNode` projection (`mapAccessibilityTree`). `page-emitter` wraps each
drawn body/footnote text run and list/footnote marker in a `/Span <</MCID n>> BDC …
EMC` marked-content sequence (header/footer/decorative-image/HR content in
`/Artifact`), collecting `(blockId, mcid)` correlation triples; `emitPdf` assembles
the StructElem object graph (`Document/P/H1-6/L/LI/Lbl/LBody/Table/TR/TD/TH/Figure/
Note/TOC`; list items split into `Lbl`+`LBody`; figures carry `/Alt`), the per-page
`/StructParents` keys, and the `/ParentTree` number tree. The whole subsystem is
gated on `structureTree` being supplied — absent, the output is byte-identical to the
untagged emitter. The `/Lang` catalog entry is LIVE: a block-level `lang` attr
cascades to every body text-run, so the controller's `firstBodyLanguage` walk picks
it up and emits `/Lang`. See `5-pdf/overview.md` and `1-core/1.8-accessibility.md`.

Still `[missing]`: full PDF/UA-1 validation conformance; `/Link` annotation ↔
`/Link` StructElem (OBJR) association; table `/Headers`/`/Scope` cell associations
beyond the `TH` element; per-entry TOC `TOCI` items; non-paginated (float/clear)
export.

---

## Examples

### `examples/react/` `[partial]`

Loads, renders the default empty document with two seed paragraphs, accepts input.
Toolbar and menu bar work for basic operations. Pagination is active (US Letter at 96
DPI, 1-inch margins). Multi-page documents fragment correctly across pages with
content visibly inset from the page edges.

Known issues:
- The example's perf fixture loader (activated via `?perfFixture=N` URL parameter)
  builds large synthetic documents; the per-page canvas-pool virtualization handles
  thousand-paragraph documents without the old single-canvas overflow.

### `examples/dom/` `[partial]`

Vanilla integration demo. Same status profile as `examples/react/` minus the
React-specific pieces.
