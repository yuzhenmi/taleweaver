# 1 — `@taleweaver/core`

`core` is the pure engine. It owns the document model, the rendering
pipeline, the editor reducer, and platform-agnostic geometry queries.
No DOM dependencies; runs in any JavaScript runtime.

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

- **`components/`** — the plugin registry. Each component registers a
  render function for a block type. Lets downstream consumers add new
  document primitives (charts, equations, embeds) without forking core.

- **`render/`** — the render tree. Walks the state's block tree
  top-down and dispatches each block through the component registry to
  produce a `RenderNode` tree of layout-relevant elements. Incremental
  rebuild driven by `dirtyIds` is the target contract but not yet
  implemented (see `1.2-render.md`).

- **`cascade/`** — the value-resolution pass. Walks the render tree
  top-down applying inheritance, initial values, and length flattening
  (em → px). Output: render tree annotated with `ComputedStyle`.

- **`layout/`** — the layout pass. The largest module. Owns formatting-
  context dispatch (BFC, IFC, Table FC), anonymous-box generation, real
  CSS 9.5 floats, intrinsic sizing, line wrapping, fragmentation. Output:
  a `LayoutBox` tree with `ComputedStyle` + resolved `UsedStyle` per
  box. Defines the `TextShaper` interface that hosts implement.

- **`cursor/`** — cursor and selection primitives. Operations like
  `moveByCharacter`, `moveByWord`, `expandSelection`, `selectWord` —
  pure manipulations on positions that editor action handlers compose.

- **`editor/`** — the reducer and the geometry-query API. Wraps the
  entire pipeline behind a single function that takes `(state, action,
  config)` and returns new state. Owns one action handler per
  `EditorAction` type. The read-only geometry queries
  (`resolvePixelPosition`, `resolvePositionFromPixel`,
  `computeSelectionRects`, `moveToLine`, `moveToLineBoundary`) live in
  `cursor/`; see [1.7-editor.md](1.7-editor.md) for the full surface.

- **`perf/`** — performance instrumentation. A flag-gated tracing API.
  Other modules call into it; when disabled, calls are zero-cost.

## How modules connect

The reducer in `editor/` is the orchestrator. Every state-mutating
action follows the same path: state operation → render tree → cascade
→ layout tree.

    ┌───────────────────┐
    │ editor/ reducer   │ ◄──── EditorAction (from host)
    └─────────┬─────────┘
              │ orchestrates pipeline (incremental at every stage)
              ▼
    state/  ──►  render/  ──►  cascade/  ──►  layout/  ──► LayoutBox tree
                   ▲                              │
                   │ component registry           │ TextShaper interface
                   │                              ▼
            components/                       host implements

The pipeline output (`LayoutBox` tree, plus the new state and selection)
is packaged into a fresh `EditorState` and returned to the host.

`cursor/` operations are invoked from inside action handlers to
manipulate selection. `perf/` cuts across all modules — markers in each
module record into a shared trace.

`styles/` is foundational and absent from the diagram: every other
module imports its type vocabulary.

## Reading order

0. [`1.0-styles.md`](1.0-styles.md) — type vocabulary, `INITIAL_COMPUTED_STYLE`, logical↔physical axis arithmetic for all writing modes.
1. [`1.1-state.md`](1.1-state.md) — document model, immutability, history, transformations.
2. [`1.2-render.md`](1.2-render.md) — components, render functions, the render tree, generated content + counters.
3. [`1.3-cascade.md`](1.3-cascade.md) — value resolution, length flattening, computed-style equality.
4. [`1.4-layout/overview.md`](1.4-layout/overview.md) — formatting contexts, intrinsic sizing, anonymous boxes, real floats, line wrap, used-style resolution.
5. [`1.5-pagination.md`](1.5-pagination.md) — fragmentation, page templates, headers/footers/footnotes.
6. [`1.6-text.md`](1.6-text.md) — text shaper interface, Unicode algorithms, hyphens, font metrics.
7. [`1.7-editor.md`](1.7-editor.md) — reducer, action handlers, geometry queries.
8. [`1.8-perf.md`](1.8-perf.md) — instrumentation.
9. [`1.9-positioning.md`](1.9-positioning.md) — `position: relative / absolute`, transforms, opacity, stacking contexts.

## Public API surface

`@taleweaver/core` exports these grouped categories. Per-module overviews above describe each in detail.

**Styles** — `Style`, `ComputedStyle`, `UsedStyle`, `Length`, `LengthOrAuto`, `Color`, `Display`, `BorderStyle`, `FontWeight`, `FontStyle`, `TextDecoration`, `WhiteSpace`, `VerticalAlign`, `Float`, `Clear`, `BreakBefore`, `BreakAfter`, `BreakInside`, `ListStyleType`, `ListStylePosition`, `BoxSizing`, `Direction`, `WritingMode`. `PROPERTY_META`, `INITIAL_COMPUTED_STYLE`.

**State** — Types: `State`, `Block`, `BlockId`, `BlockInit`, `InlineContent`, `InlineItem`, `TextItem`, `EmbedItem`, `ReadonlyAttrs`, `Position`, `Span`, `Selection`, `OperationResult`, `IdAllocator`, `EmbedSerializer`, `ClonedSubtree`, `InsertBlockArgs`. Factories and access: `createState`, `createEmptyDocument`, `productionAllocator`, `createTestAllocator`, `getBlock`, `getEmbedContent`, `getBlockFromEither`, `applyOperation`, `freshState`, `createPosition`, `createSpan`, `positionsEqual`, `comparePositionsWithinBlock`. Layer 2 utilities: `attrsEqual`, `deepValueEqual`, `mergeAttrs`, `nextBlockInDocOrder`, `prevBlockInDocOrder`, `ancestorChain`, `firstLeafBlock`, `lastLeafBlock`, `compareBlocksInDocOrder`, `comparePositions`, `spanStart`, `spanEnd`, `selectionContextOf`, `normalizeSpan`, `iterateSpan`, `iterateBlocksInSpan`, `extractText`, `builtinEmbedSerializer`, `inlineContentLength`, `findItemAtOffset`, `mergeAdjacentTextItems`, `splitInlineContentAtOffset`. Layer 3 operations: `insertText`, `deleteRange`, `replaceRange`, `splitBlockAtPosition`, `mergeAdjacentBlocks`, `applyAttrsToRange`, `setBlockAttrs`, `mergeBlockAttrs`, `setBlockType`, `insertBlock`, `removeBlock`, `clonePastedSubtree`. History: `History`, `SelectionEntry`, `UndoRedoResult`, `createHistory`.

**Cascade** — `cascadePass`, `composeComputed`, `resolveLength`. Attribute interpreter registry: `AttrRegistry`, `createDefaultAttrRegistry`, `AttrInterpreter`, `CascadeContext`.

**Render tree** — `RenderNode`, `ElementBox`, `TextBox`. `createElementBox`, `createTextBox`. `render`, `RenderOutput`.

**Layout tree** — `LayoutBox`, `BlockBox`, `LineBox`, `TextRunBox`. `createBlockBox`, `createLineBox`, `createTextRunBox`. `layoutTree`, `layoutTreeIncremental`. `establishesNewBFC`. `computeUsedStyle`. `PageBox`, `createPageBox`, `PageConfig`, `PageMargins`. `IntrinsicSizes`, `IntrinsicSizesCache`, `createIntrinsicSizesCache`, `computeIntrinsicSizes`. `IFCState`, `IFCStateCache`, `createIFCStateCache`. `TextShaper`, `ShapedRun`, `Cluster`, `BreakOpportunity`, `FontMetrics`, `GlyphId`. `TextMeasurer`, `createMockMeasurer`, `adaptShaperToMeasurer`. `createMockShaper`.

**Components** — `ComponentDefinition`, `ComponentRegistry`, `createComponentRegistry`, `createDefaultComponentRegistry`. Built-in component definitions: `documentComponent`, `paragraphComponent`, `headingComponent`, `listComponent`, `listItemComponent`, `imageComponent`, `horizontalLineComponent`, `tableComponent`, `tableRowComponent`, `tableCellComponent`. (`text` and `span` are deleted — text is items inside `inlineContent`; spans are reconstructed by render from same-attr text-item groupings.)

**Cursor** — `isCollapsed`. `moveByCharacter`, `moveByWord`, `expandSelection`, `selectWord`. `resolvePositionFromPixel`. `PixelPosition`, `resolvePixelPosition`. `SelectionRect`, `computeSelectionRects`. `moveToLine`, `moveToLineBoundary`.

**Editor** — `EditorAction`, `EditorState`, `EditorConfig`. `createInitialEditorState`, `reduceEditor`. `findFirstContentBlock`, `findLastContentBlock`.

**Line traversal (under `cursor/`)** — `AbsoluteLineBox`, `LineLeaf`. `collectLineBoxes`, `collectLineLeaves`, `findLineForPosition`. (Consumed by hit-test, cursor-position, selection-geometry, line-navigation for line-level geometry queries.)

**Perf** — `PerfReport`. `setPerfTraceEnabled`, `isPerfTraceEnabled`, `markStart`, `markEnd`, `recordSample`, `report`, `resetPerfTrace`.
