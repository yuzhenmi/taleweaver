// @taleweaver/core — word processor engine
//
// Public API surface after the P11-cutover. The pre-Yjs legacy modules
// (StateNode, path-based positions, renderTree-legacy, etc.) have been
// fully retired; everything below is the new Y.Doc-backed pipeline.
// Downstream consumers (packages/dom, packages/react, examples/*) are
// updated in T2/T3 to import from this surface only.

// Styles
export type {
  Style, ComputedStyle, UsedStyle, Length, LengthOrAuto, Color,
  Display, BorderStyle, FontWeight, FontStyle, TextDecoration,
  WhiteSpace, VerticalAlign, Float, Clear,
  BreakBefore, BreakAfter, BreakInside,
  ListStyleType, ListStylePosition, BoxSizing,
  Direction, WritingMode,
} from "./styles";
export { PROPERTY_META, INITIAL_COMPUTED_STYLE } from "./styles";

// State (Y.Doc-backed)
export type { State, OperationResult } from "./state/state";
export {
  createState,
  applyOperation,
  freshState,
  getBlock,
  getEmbedContent,
  getBlockFromEither,
} from "./state/state";
export { createEmptyDocument } from "./state/initial-state";
export type { Block } from "./state/block";
export type { BlockId, IdAllocator } from "./state/block-id";
export {
  productionAllocator,
  createTestAllocator,
} from "./state/block-id";
export type {
  InlineContent,
  InlineItem,
  TextItem,
  EmbedItem,
} from "./state/inline-content";
export {
  inlineContentLength,
  findItemAtOffset,
  mergeAdjacentTextItems,
  splitInlineContentAtOffset,
} from "./state/inline-content";
export type { ReadonlyAttrs } from "./state/attrs";
export {
  deepValueEqual,
  attrsEqual,
  mergeAttrs,
} from "./state/attrs";
export type {
  Position,
  Span,
  Selection,
} from "./state/block-position";
export {
  createPosition,
  createSpan,
  positionsEqual,
  comparePositionsWithinBlock,
} from "./state/block-position";
export {
  compareBlocksInDocOrder,
  comparePositions,
  spanStart,
  spanEnd,
  selectionContextOf,
} from "./state/block-compare";
export {
  nextBlockInDocOrder,
  prevBlockInDocOrder,
  ancestorChain,
  firstLeafBlock,
  lastLeafBlock,
} from "./state/block-traversal";
export { normalizeSpan, iterateSpan, iterateBlocksInSpan } from "./state/span-iteration";

// Layer 3 ops
export { insertText } from "./state/insert-text";
export { deleteRange } from "./state/delete-range";
export { replaceRange } from "./state/replace-range";
export { splitBlockAtPosition } from "./state/split-block";
export { insertBlock } from "./state/insert-block";
export type { InsertBlockArgs } from "./state/insert-block";
export { removeBlock } from "./state/remove-block";
export { mergeAdjacentBlocks } from "./state/merge-blocks";
export { setBlockType } from "./state/set-block-type";
export { setBlockAttrs } from "./state/set-block-attrs";
export { mergeBlockAttrs } from "./state/merge-block-attrs";
export { applyAttrsToRange } from "./state/apply-attrs";
export { clonePastedSubtree } from "./state/clone-pasted-subtree";
export type { ClonedSubtree } from "./state/clone-pasted-subtree";
export { extractText, builtinEmbedSerializer } from "./state/extract-text";
export type { EmbedSerializer } from "./state/extract-text";

// History (Y.UndoManager-backed)
export {
  History,
  createHistory,
  type SelectionEntry,
  type UndoRedoResult,
} from "./state/history";

// Cascade
export { cascadePass, composeComputed, resolveLength } from "./cascade";
export { AttrRegistry, createDefaultAttrRegistry } from "./cascade/attr-registry";
export type { AttrInterpreter, CascadeContext } from "./cascade/attr-registry";

// Render tree (new pipeline)
export type {
  RenderNode,
  ElementBox,
  TextBox,
} from "./render/render-node";
export {
  createElementBox,
  createTextBox,
} from "./render/render-node";
export { render } from "./render/render";
export type { RenderOutput } from "./render/render";

// Layout
export type {
  LayoutBox,
  BlockBox,
  LineBox,
  TextRunBox,
} from "./layout/layout-node";
export {
  createBlockBox,
  createLineBox,
  createTextRunBox,
} from "./layout/layout-node";
export type { TextMeasurer } from "./layout/text-measurer";
export { createMockMeasurer, adaptShaperToMeasurer } from "./layout/text-measurer";
export { createMockShaper } from "./layout/mock-shaper";
export type {
  TextShaper, ShapedRun, Cluster, BreakOpportunity, FontMetrics, GlyphId,
} from "./layout/text-shaper";
export type { IntrinsicSizes, IntrinsicSizesCache } from "./layout/intrinsic-sizes";
export { createIntrinsicSizesCache } from "./layout/intrinsic-sizes";
export { computeIntrinsicSizes } from "./layout/intrinsic-sizes-pass";
export type { IFCState, IFCStateCache } from "./layout/ifc-state";
export { createIFCStateCache } from "./layout/ifc-state";
export { layoutTree } from "./layout/dispatch";
export { layoutTreeIncremental } from "./layout/layout-incremental";
export { establishesNewBFC } from "./layout/bfc-establishment";
export type { PageBox } from "./layout/page-box";
export { createPageBox } from "./layout/page-box";
export { computeUsedStyle } from "./layout/used-style";
export type { PageConfig, PageMargins } from "./layout/page-config";

// Components (new pipeline)
export type {
  ComponentDefinition,
  ComponentRegistry,
} from "./components";
export {
  createComponentRegistry,
  createDefaultComponentRegistry,
  documentComponent,
  paragraphComponent,
  headingComponent,
  listComponent,
  listItemComponent,
  imageComponent,
  horizontalLineComponent,
  tableComponent,
  tableRowComponent,
  tableCellComponent,
} from "./components";

// Cursor
export {
  moveByCharacter,
  moveByWord,
  expandSelection,
  selectWord,
} from "./cursor/cursor-ops";
export { resolvePositionFromPixel } from "./cursor/hit-test";
export type { PixelPosition } from "./cursor/cursor-position";
export { resolvePixelPosition } from "./cursor/cursor-position";
export type { SelectionRect } from "./cursor/selection-geometry";
export { computeSelectionRects } from "./cursor/selection-geometry";
export { moveToLine, moveToLineBoundary } from "./cursor/line-navigation";
export { isCollapsed } from "./cursor/selection";

// Editor
export type { EditorAction } from "./editor/editor-action";
export type { AbsoluteTextBox } from "./editor/layout-utils";
export { collectAllTextBoxes } from "./editor/layout-utils";
export type {
  EditorState,
  EditorConfig,
} from "./editor/editor-state";
export {
  createInitialEditorState,
  reduceEditor,
  findFirstContentBlock,
  findLastContentBlock,
} from "./editor/editor-state";

// Public input shape for the INSERT_NODE action payload.
export type { BlockInit } from "./state/block-init";

// Performance tracing
export type { PerfReport } from "./perf/perf-trace";
export {
  setPerfTraceEnabled,
  isPerfTraceEnabled,
  markStart,
  markEnd,
  recordSample,
  report,
  resetPerfTrace,
} from "./perf/perf-trace";
