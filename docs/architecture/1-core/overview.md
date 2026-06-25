# 1 — `@taleweaver/core`

`core` is the headless, geometry-free engine. It owns the document model, the
rendering (styled-tree) pipeline, the editor reducer, the text-core/Unicode
mechanics, and the geometry-free selection model. It owns NO positioned geometry
— the paginated box-layout engine and the geometric cursor/hit-test math live in
`@taleweaver/print` (see [`../2-print/overview.md`](../2-print/overview.md)). No
DOM dependencies, no sibling-package imports; runs in any JavaScript runtime, and
is separately publishable.

## Top-level modules

`packages/core/src/` is organized by responsibility — each top-level
directory is one module.

- **`styles/`** — the type vocabulary. Defines `Style` (what users
  declare), `ComputedStyle` (post-cascade), `UsedStyle` (post-layout,
  fully numeric), and supporting primitives (`Length`, `Color`,
  `Display`, `WritingMode`, etc.). Every other module imports from here.

- **`state/`** — the document model. A Y.Doc-backed block tree of
  styled-run sequences, with id-based positions, three layers of API
  (types and access; pure utilities; state-mutating operations), and
  Y.UndoManager-backed history with per-entry selection alignment.
  Its `serialize/` subdirectory holds document serialization (it lives
  inside `state/` because it consumes/produces `State` and needs the raw
  `Y.Doc`) — see `1.7-serialization.md`.

- **`components/`** — the plugin registry. Each component registers a
  render function for a block type. Lets downstream consumers add new
  document primitives (charts, equations, embeds) without forking core.

- **`render/`** — the render tree. Walks the state's block tree
  top-down and dispatches each block through the component registry to
  produce a `RenderNode` tree of layout-relevant elements. Incremental
  rebuild driven by `dirtyIds` is implemented (`render-incremental.ts`,
  wired into `render()` via the `RenderOptions` incremental triple) [implemented].
  Render also bakes generated marker text (list bullets/numbers) onto the
  list-item element's style by consulting the `numbering/` service — there is
  no CSS generated-content or counters layer (see `1.2-render.md`).

- **`numbering/`** — the render-time numbering service. A pure, general
  counter engine (`computeCounters`) plus a list collector
  (`collectListEvents`) that walks the document and emits one counter
  event per `list-item`. Render is its first consumer (it bakes the
  computed number/bullet into the list-item marker); footnotes and custom
  components are intended future consumers. Render-time only — no layout
  dependency. (Layout-dependent numbering, e.g. footnote-restart-per-page,
  is computed elsewhere.) See `1.2-render.md`.

- **`cascade/`** — the value-resolution pass. Walks the render tree
  top-down applying inheritance, initial values, and length flattening
  (em → px). Output: render tree annotated with `ComputedStyle`.

- **`layout/`** — the **text-core** module (NOT the geometric box-layout
  engine, which moved to `@taleweaver/print/src/layout/`). Owns the Unicode/text
  mechanics that need no positioned geometry: UAX #14 line-break (`uax14/`),
  UAX #9 bidi (`uax9/`), grapheme clustering (`graphemes.ts`), the `TextShaper`
  and `TextMeasurer` interfaces (+ mocks), intrinsic-size measurement
  (`intrinsic-sizes.ts`), the `mat2d` transform primitive, text-transform/
  tokenize/spacing, and the `Hyphenator` interface. The geometric formatting-
  context dispatch (BFC/IFC/Table FC), anonymous boxes, real floats, fragmentation,
  and the `LayoutBox`/`PageBox` tree all live in `@taleweaver/print`.

- **`cursor/`** — the **geometry-free** selection model. Operations like
  `moveByCharacter`, `moveByWord`, `expandSelection`, `selectWord`,
  object-selection, and grapheme-stepping — pure manipulations on positions
  that editor action handlers compose. The geometric cursor math (hit-test,
  cursor-position, line-navigation, selection-geometry, line-bidi, the line/
  atomic-box indices) moved to `@taleweaver/print/src/cursor/`.

- **`editor/`** — the GEOMETRY-FREE reducer. Takes `(state, action,
  config)` and returns new state, owning one action handler per
  `EditorAction` type, the `History` integration, and `lastDirtyIds`
  (the changed-block-id hand-off the print backend's layout-driver
  consumes). It runs NO render/cascade/layout pass and holds no layout
  tree, and has no geometric-navigation actions — those are
  `@taleweaver/print` `NavIntent`s resolved against the backend-built tree.
  The read-only geometry-query functions (`resolvePixelPosition`,
  `resolvePositionFromPixel`, `computeSelectionRects`, `moveToLine`,
  `moveToLineBoundary`) live in `@taleweaver/print`'s `cursor/` and operate on a
  layout tree the backend builds; see [1.5-editor.md](./1.5-editor.md) for the full
  surface.

- **`accessibility/`** — the semantic projection. `buildAccessibilityTree`
  walks the document and produces a pure, geometry-free `AccessibilityNode`
  tree (ARIA-aligned roles + text runs with literal offsets) that a host
  materializes into a hidden semantic DOM mirror for screen readers. A
  read-side sibling of `getOutline`/`extractText` — no layout or canvas
  dependency. See [`1.8-accessibility.md`](./1.8-accessibility.md).

- **`perf/`** — performance instrumentation. A flag-gated tracing API.
  Other modules call into it; when disabled, calls are zero-cost.

## How modules connect

The reducer in `editor/` is the geometry-free orchestrator: a
state-mutating action runs the state operation and records the changed
block ids on `EditorState.lastDirtyIds`, returning a fresh `EditorState`
(new state + selection + `lastDirtyIds`) — it runs NO render/cascade/
layout pass. The render → cascade → layout pipeline lives in the
`@taleweaver/print` backend's layout-driver, which consumes `lastDirtyIds`
to rebuild geometry incrementally.

    ┌───────────────────┐
    │ editor/ reducer   │ ◄──── EditorAction (from host)
    └─────────┬─────────┘
              │ state op + records lastDirtyIds (no geometry)
              ▼
    state/  ──►  new EditorState (.state, .selection, .lastDirtyIds)
                              │
                              ▼  (in @taleweaver/print)
              layout-driver: render/ ──► cascade/ ──► layout/ ──► LayoutBox tree
              (core modules)  (core)    (core)    (print)   (print geometry)
                               ▲                          │
                               │ component registry        │ TextShaper interface
                               │                          ▼
                        components/                    host implements

`core`'s `render/`, `cascade/`, and the text-core `layout/` mechanics still live
in `core` (the backend imports them); `core` simply no longer RUNS them — the
backend driver does. The GEOMETRIC layout pass (BFC/IFC/Table FC, fragmentation,
the `LayoutBox`/`PageBox` tree) lives in `@taleweaver/print/src/layout/`, not in
`core`. `core`'s `cursor/` operations (the geometry-free selection model) are
invoked from inside action handlers to manipulate selection; the geometric cursor
math (hit-test, line-navigation, …) lives in `@taleweaver/print/src/cursor/` and
is driven by the backend's NavIntent resolver. `perf/` cuts across all modules —
markers in each module record into a shared trace.

`styles/` is foundational and absent from the diagram: every other
module imports its type vocabulary.

## Reading order

0. [`1.0-styles.md`](./1.0-styles.md) — type vocabulary, `INITIAL_COMPUTED_STYLE`, logical↔physical axis arithmetic for all writing modes.
1. [`1.1-state.md`](./1.1-state.md) — document model, immutability, history, transformations.
2. [`1.2-render.md`](./1.2-render.md) — components, render functions, the render tree, the render-time numbering service (list markers).
3. [`1.3-cascade.md`](./1.3-cascade.md) — value resolution, length flattening, computed-style equality.
4. [`1.4-text.md`](./1.4-text.md) — text shaper interface, Unicode algorithms (UAX line-break/bidi, grapheme clustering), intrinsic sizing, hyphens, font metrics.
5. [`1.5-editor.md`](./1.5-editor.md) — reducer, action handlers, geometry queries (the geometry queries themselves live in `@taleweaver/print`).
6. [`1.6-perf.md`](./1.6-perf.md) — instrumentation.
7. [`1.7-serialization.md`](./1.7-serialization.md) — pluggable document (de)serialization, the serializer registry, the v1 lossless Yjs-binary format.
8. [`1.8-accessibility.md`](./1.8-accessibility.md) — the geometry-free `AccessibilityNode` semantic projection (`buildAccessibilityTree`); a read-side sibling of `getOutline`/`extractText`.

The GEOMETRIC layers that consume this `core` brain — the box-layout engine
(BFC/IFC/Table FC, floats, used-style resolution), pagination
(fragmentation, page templates, headers/footers/footnotes), and positioning
(`position: relative/absolute`, transforms, opacity, stacking contexts) — live
in `@taleweaver/print`; see [`../2-print/overview.md`](../2-print/overview.md).

## Public API surface

`@taleweaver/core` exports these grouped categories. Per-module overviews above describe each in detail.

**Styles** — `Style`, `ComputedStyle`, `UsedStyle`, `Length`, `LengthOrAuto`, `Color`, `Display`, `BorderStyle`, `FontWeight`, `FontStyle`, `WhiteSpace`, `VerticalAlign`, `Float`, `Clear`, `BreakBefore`, `BreakAfter`, `BreakInside`, `ListStyleType`, `ListStylePosition`, `BoxSizing`, `Direction`, `WritingMode`. `PROPERTY_META`, `INITIAL_COMPUTED_STYLE`. URL-safety predicates (shared by `print` + `pdf` export): `isOpenableLinkUrl`, `isExportSafeLinkUrl`.

**State** — Types: `State`, `Block`, `BlockId`, `BlockInit`, `InlineContent`, `InlineItem`, `TextItem`, `EmbedItem`, `ReadonlyAttrs`, `Position`, `Span`, `Selection`, `OperationResult`, `IdAllocator`, `EmbedSerializer`, `ClonedSubtree`, `InsertBlockArgs`. Factories and access: `createState`, `createEmptyDocument`, `productionAllocator`, `createTestAllocator`, `getBlock`, `getEmbedContent`, `getTemplateContent`, `resolveBlock`, `getEmbedContentIds`, `getTemplateContentIds`, `applyOperation`, `freshState`, `createPosition`, `createSpan`, `positionsEqual`, `comparePositionsWithinBlock`. (Sibling core modules import this surface through the `state/index.ts` barrel.) Layer 2 utilities: `attrsEqual`, `deepValueEqual`, `mergeAttrs`, `nextBlockInDocOrder`, `prevBlockInDocOrder`, `ancestorChain`, `firstLeafBlock`, `lastLeafBlock`, `compareBlocksInDocOrder`, `comparePositions`, `spanStart`, `spanEnd`, `selectionContextOf`, `normalizeSpan`, `iterateSpan`, `iterateBlocksInSpan`, `extractText`, `builtinEmbedSerializer`, `inlineContentLength`, `findItemAtOffset`, `mergeAdjacentTextItems`, `splitInlineContentAtOffset`. Layer 3 operations: `insertText`, `deleteRange`, `replaceRange`, `splitBlockAtPosition`, `mergeAdjacentBlocks`, `applyAttrsToRange`, `setBlockAttrs`, `mergeBlockAttrs`, `setBlockType`, `insertBlock`, `removeBlock`, `insertBlocksAfter`, `reparentChildren`, `applySectionBreak`, `mergeSectionWithPrevious`, `setListType`, `setListRestart`, `clonePastedSubtree`. List numbering config (the `listDefs` side-table): `ListDef`, `ListLevelConfig`, `getListDefsForState`, `classifyListDef`, `newListId`, `docHasLists`. Comments (the `comments` side-table): `CommentId`, `CommentReply`, `CommentRecord`, `CommentRange`, `ResolvedComment`, `COMMENT_START_EMBED_TYPE`, `COMMENT_END_EMBED_TYPE`, `buildCommentRangeIndex`, `resolveCommentRange`, `getComments`, `addComment`, `resolveComment`, `reopenComment`, `deleteComment`, `addReply`. History: `History`, `SelectionEntry`, `UndoRedoResult`, `createHistory`.

**Cascade** — `cascadePass`, `composeComputed`, `resolveLength`. Attribute interpreter registry: `AttrRegistry`, `createDefaultAttrRegistry`, `AttrInterpreter`, `CascadeContext`.

**Render tree** — `RenderNode`, `ElementBox`, `TextBox`. `createElementBox`, `createTextBox`. `render`, `RenderOutput`.

**Numbering** — `computeCounters`, `collectListEvents`, `listCounterRenumberedBlocks`. Types: `CounterEvent`, `CounterScopeKey`, `CounterRestart`, `CounterLevelDef`, `CounterDef`, `CounterDefs`, `CounterValue`. The render-time numbering service (see `1.2-render.md`).

**Layout — text core** (the geometric box-layout surface — `LayoutBox`/`BlockBox`/`LineBox`/`TextRunBox`, `PageBox`, `layoutTree`/`layoutTreeIncremental`, `establishesNewBFC`, `computeUsedStyle`, `VirtualLayoutTree`, the IFC-state cache, `computeIntrinsicSizes`, the goto-destination/pdf-outline resolvers — RELOCATED to `@taleweaver/print`; import them from there) — `PageConfig`, `PageMargins`. `IntrinsicSizes`, `IntrinsicContribution`, `IntrinsicSizesCache`, `createIntrinsicSizesCache`. `TextShaper`, `ShapedRun`, `Cluster`, `BreakOpportunity`, `FontMetrics`, `GlyphId`, `toBreakOpportunities`. `TextMeasurer`, `createMockMeasurer`, `adaptShaperToMeasurer`, `measurerToShaper`, `isTextShaper`. `createMockShaper`, `createVariableMockShaper`. `Hyphenator`, `createMockHyphenator`. UAX #14 line-break (`lineBreakClass`, `lineBreakOpportunities`, `LineBreakClass`, …) and UAX #9 bidi (`resolveBidiLevels`, `reorderVisual`, `bidiMirror`, `BidiClass`, …). `graphemeClusters`. `Mat2D` + the `mat2d` affine ops. `tokenize`/`transformRun`/`resolveSpacingPx`/`clusterSpacing`. `isDevMode`.

**Components** — `ComponentDefinition`, `ComponentRegistry`, `createComponentRegistry`, `createDefaultComponentRegistry`. Built-in component definitions: `documentComponent`, `paragraphComponent`, `headingComponent`, `listItemComponent`, `imageComponent`, `horizontalLineComponent`, `tableComponent`, `tableRowComponent`, `tableCellComponent`, `footnoteBodyComponent`, `tableOfContentsComponent`. (`templateBodyComponent` is registered in `createDefaultComponentRegistry` and exported from the `components/` barrel, but is NOT re-exported on the package barrel `@taleweaver/core`.) (There is NO `listComponent`: the flat Google-Docs list model has no `list` container — a list-item is a leaf carrying `listId` + `listLevel` attrs; see `1.1-state.md`.) (`text` and `span` are deleted — text is items inside `inlineContent`; spans are reconstructed by render from same-attr text-item groupings.)

**Cursor — geometry-free selection model only** (the geometric cursor surface — `resolvePixelPosition`/`resolvePositionFromPixel`/`PixelPosition`, `computeSelectionRects`/`SelectionRect`, `getCommentRangeRects`/`getSuggestionRangeRects`, `moveToLine`/`moveToLineBoundary` — RELOCATED to `@taleweaver/print`; import them from there) — `isCollapsed`, `selectionsEqual`, `CaretAffinity`. `moveByCharacter`, `moveByWord`, `expandSelection`, `selectWord`. `isObjectSelection`. `nextGraphemeBoundary`, `prevGraphemeBoundary`.

**Editor** — `EditorAction`, `EditorState`, `EditorConfig`. `createInitialEditorState`, `reduceEditor`. `findFirstContentBlock`, `findLastContentBlock`.

**Line traversal** — RELOCATED to `@taleweaver/print` (`AbsoluteLineBox`, `LineLeaf`, `collectLineBoxes`, `collectLineLeaves`, `findLineForPosition`). The LineBox-canonical line-level geometry queries are geometric, so they live with the rest of the geometric cursor surface in `@taleweaver/print`; import them from there.

**Accessibility** — `buildAccessibilityTree`. Types: `AccessibilityNode`, `AccessibilityRole`, `AccessibilityTextRun`, `BuildAccessibilityTreeOptions`. The geometry-free semantic projection (see `1.8-accessibility.md`).

**Perf** — `PerfReport`. `setPerfTraceEnabled`, `isPerfTraceEnabled`, `markStart`, `markEnd`, `recordSample`, `report`, `resetPerfTrace`.

**Document serialization** — Types: `SerializedDocument`, `DocumentSerializer`, `SerializerRegistry`. Registry + dispatch: `createSerializerRegistry`, `createDefaultSerializerRegistry`, `serializeDocument`, `deserializeDocument`. v1 Yjs-binary serializer: `createBinaryDocumentSerializer`, `BINARY_FORMAT`. Errors: `UnknownSerializerFormatError`, `MalformedDocumentError`. (See `1.7-serialization.md`. Re-exported through the `state/` barrel.)
