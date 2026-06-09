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
  Display, BorderStyle, FontWeight, FontStyle,
  WhiteSpace, VerticalAlign, TextTransform, Float, Clear,
  BreakBefore, BreakAfter, BreakInside,
  ListStyleType, ListStylePosition, BoxSizing,
  Direction, WritingMode, LeaderStyle,
  // CSS positioning vocabulary (the styles `Position` is NOT re-exported here to
  // avoid colliding with the state/cursor `Position` already on this barrel).
  TransformFn, TransformOrigin,
} from "./styles";
export { PROPERTY_META, INITIAL_COMPUTED_STYLE } from "./styles";
export { assertNeverWritingMode } from "./styles";

// State (Y.Doc-backed) — re-exported through the `state/` barrel
// (`./state/index.ts`), the intra-core API contract for the document model.
export type {
  State,
  OperationResult,
  ResolvedBlock,
  ResolvedBlockKind,
} from "./state";
export {
  createState,
  applyOperation,
  freshState,
  getBlock,
  getEmbedContent,
  getTemplateContent,
  resolveBlock,
} from "./state";
export { createEmptyDocument } from "./state";
// Declarative construction: lower a nested `BlockNode` tree → `State` (mints
// ids, derives all structural links). The safe public counterpart to the
// internal bulk constructor; the foundation importers (e.g. the HTML
// serializer) target.
export { buildDocumentFromTree } from "./state";
export type { BlockNode, ContainerBlockNode, LeafBlockNode } from "./state";
export type { Block } from "./state";
export type { BlockId, IdAllocator } from "./state";
export {
  productionAllocator,
  createTestAllocator,
} from "./state";
export type {
  InlineContent,
  InlineItem,
  TextItem,
  EmbedItem,
} from "./state";
export {
  inlineContentLength,
  findItemAtOffset,
  mergeAdjacentTextItems,
  splitInlineContentAtOffset,
} from "./state";
export type { ReadonlyAttrs } from "./state";
export {
  deepValueEqual,
  attrsEqual,
  mergeAttrs,
} from "./state";
export type {
  Position,
  Span,
  Selection,
} from "./state";
export {
  createPosition,
  createSpan,
  positionsEqual,
  comparePositionsWithinBlock,
} from "./state";
export {
  compareBlocksInDocOrder,
  comparePositions,
  spanStart,
  spanEnd,
  selectionContextOf,
} from "./state";
export {
  nextBlockInDocOrder,
  prevBlockInDocOrder,
  ancestorChain,
  firstLeafBlock,
  lastLeafBlock,
} from "./state";
export { normalizeSpan, iterateSpan, iterateBlocksInSpan } from "./state";

// Layer 3 ops
export { insertText } from "./state";
export { deleteRange } from "./state";
export { replaceRange } from "./state";
export { planReplaceMatches, replaceAllMatches, applyReplaceAllPlan } from "./state";
export type { ReplaceAllPlan, BlockWrite } from "./state";
export { splitBlockAtPosition } from "./state";
export { insertBlock } from "./state";
export type { InsertBlockArgs } from "./state";
export { removeBlock } from "./state";
export { mergeAdjacentBlocks } from "./state";
export { setBlockType } from "./state";
export { setBlockAttrs } from "./state";
export { mergeBlockAttrs } from "./state";
export { applyAttrsToRange } from "./state";
export { extractText, builtinEmbedSerializer } from "./state";
export type { EmbedSerializer } from "./state";
// Document queries (pure reads over the document) — consumed by host UI for
// find/replace, word count, and the outline panel.
export { findMatches, getWordCount, getSelectionWordCount, countText, getOutline } from "./state";
export type {
  TextMatch,
  FindMatchesOptions,
  WordCount,
  WordCountOptions,
  OutlineEntry,
  OutlineOptions,
} from "./state";
export { getActiveFormatting } from "./state";
export type { ActiveFormatting } from "./state";

// List numbering definitions — surfaced for human-friendly serializers that
// classify a list as ordered/unordered and mint fresh list ids on decode.
export type { ListDef } from "./state";
export { getListDefsForState, classifyListDef, newListId } from "./state";

// Content-bearing inline-embed type ids — surfaced so a lossy human serializer
// can detect (and dev-warn about) dropped footnote-anchor / cross-reference
// embeds on export (the binary serializer is the lossless path).
export { FOOTNOTE_ANCHOR_EMBED_TYPE, CROSS_REFERENCE_EMBED_TYPE } from "./state";

// Comments. Paired zero-width `comment-start`/`comment-end` marker embeds
// delimit a comment range and ARE the anchor; `insertCommentMarkers` inserts the
// pair, and `buildCommentRangeIndex` / `resolveCommentRange` resolve it (with a
// derived `orphaned` flag) by content scan. The thread-record CRUD ops
// (`addComment`/`resolveComment`/`reopenComment`/`deleteComment`/`addReply`) are
// NORMAL tracked content ops (a comment reverts atomically with its markers);
// `getComments` is the read surface (record + scanned range).
export { insertCommentMarkers } from "./state";
export {
  addComment,
  resolveComment,
  reopenComment,
  deleteComment,
  addReply,
  COMMENT_START_EMBED_TYPE,
  COMMENT_END_EMBED_TYPE,
  buildCommentRangeIndex,
  resolveCommentRange,
  getComments,
} from "./state";
export type {
  AddCommentInput,
  AddReplyInput,
  CommentId,
  CommentReply,
  CommentRecord,
  CommentRange,
  ResolvedComment,
} from "./state";

// History (Y.UndoManager-backed)
export {
  History,
  createHistory,
  type SelectionEntry,
  type UndoRedoResult,
} from "./state";

// Document serialization (pluggable serializer + registry + Yjs-binary v1).
export type { SerializedDocument, DocumentSerializer, SerializerRegistry } from "./state";
export {
  createSerializerRegistry,
  createDefaultSerializerRegistry,
  serializeDocument,
  deserializeDocument,
  createBinaryDocumentSerializer,
  BINARY_FORMAT,
  UnknownSerializerFormatError,
  MalformedDocumentError,
} from "./state";

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
// POSITIONING slice 5 — the zero-dep 2×3 affine matrix. The painter
// (`fromTransformFns` + `resolveTransformOrigin`) and the hit-test inverse
// (`line-flatten`) share the IDENTICAL math so paint and hit-test never diverge.
export type { Mat2D } from "./layout/mat2d";
export {
  fromTransformFns, resolveTransformOrigin, identity, compose, translate,
  rotate, scale, invert, apply,
} from "./layout/mat2d";
export { createMockShaper } from "./layout/mock-shaper";
export type {
  TextShaper, ShapedRun, Cluster, BreakOpportunity, FontMetrics, GlyphId,
} from "./layout/text-shaper";
export { toBreakOpportunities } from "./layout/text-shaper";
// Layout — UAX #14 line-break segmentation (text core)
export {
  lineBreakClass,
  lineBreakOpportunities,
  UAX14_UNICODE_VERSION,
} from "./layout/uax14";
export type { LineBreakClass, LineBreakPoint, LineBreakOptions } from "./layout/uax14";
// Layout — UAX #9 bidirectional text (text core)
export {
  resolveBidiLevels,
  reorderVisual,
  bidiMirror,
  bidiClass,
  UAX9_UNICODE_VERSION,
} from "./layout/uax9";
export type { BidiClass, BaseDirection, BidiResult } from "./layout/uax9";
export type { IntrinsicSizes, IntrinsicContribution, IntrinsicSizesCache } from "./layout/intrinsic-sizes";
export { createIntrinsicSizesCache } from "./layout/intrinsic-sizes";
export { computeIntrinsicSizes } from "./layout/intrinsic-sizes-pass";
export type { IFCState, IFCStateCache } from "./layout/ifc-state";
export { createIFCStateCache } from "./layout/ifc-state";
export { layoutTree } from "./layout/dispatch";
export { layoutTreeIncremental } from "./layout/layout-incremental";
export { establishesNewBFC } from "./layout/bfc-establishment";
export type { PageBox } from "./layout/page-box";
export { createPageBox } from "./layout/page-box";
// Virtualized layout: the `VirtualLayoutTree` is `EditorState.layoutTree` in
// paginated mode; `resolvePositionedTree` is the bridge consumers ride to a
// fully-positioned `LayoutBox` (via `materializeAll()`) until they migrate to
// the plan / `getPage` API.
export type { VirtualLayoutTree } from "./layout/virtual-layout-tree";
export { resolvePositionedTree } from "./layout/positioned-tree";
export { computeUsedStyle } from "./layout/used-style";
export type { PageConfig, PageMargins } from "./layout/page-config";
// CSS letter-/word-spacing rule — applied by the in-engine mock shapers and by
// the @taleweaver/dom canvas shaper (re-exported here so dom can share the rule).
// Only the two functions called across the package boundary are surfaced;
// `isWordSeparatorCluster` is an internal detail of `clusterSpacing`.
export { resolveSpacingPx, clusterSpacing } from "./layout/text-spacing";
export { graphemeClusters } from "./layout/graphemes";

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
export { computeSelectionRects, computeSelectionRectsForPage } from "./cursor/selection-geometry";
export { moveToLine, moveToLineBoundary } from "./cursor/line-navigation";
export { isCollapsed } from "./cursor/selection";

// Editor
export type { EditorAction } from "./editor/editor-action";
// Inline (character-level) formatting attr keys — the single source of truth
// for what CLEAR_FORMATTING removes; exported so downstream consumers can
// reason about the same set.
export type { InlineFormatAttrKey } from "./editor/inline-format-keys";
export { INLINE_FORMAT_ATTR_KEYS } from "./editor/inline-format-keys";
// LineBox-canonical line traversal — replaces the deleted
// text-run-driven `AbsoluteTextBox` / `collectAllTextBoxes` flatten
// (lived under `editor/layout-utils.ts` until E-E.7).
export type { AbsoluteLineBox, LineLeaf } from "./cursor/line-flatten";
export { collectLineBoxes, collectLineLeaves, findLineForPosition } from "./cursor/line-flatten";
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
export { exportDocument, loadDocument } from "./editor/document-io";

// Public input shape for the INSERT_NODE action payload.
export type { BlockInit } from "./state";

// Footnotes — document-wide numbering policy (read/written by the
// SET_FOOTNOTE_POLICY editor action; the toolbar reads the current value).
export type { CounterFormat, FootnoteNumberingPolicy } from "./footnotes";
export { documentFootnotePolicy } from "./footnotes";

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
