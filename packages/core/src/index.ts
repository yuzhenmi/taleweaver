// @taleweaver/core — word processor engine
//
// Public API surface after the P11-cutover. The pre-Yjs legacy modules
// (StateNode, path-based positions, renderTree-legacy, etc.) have been
// fully retired; everything below is the new Y.Doc-backed pipeline.
// Downstream consumers (packages/print, packages/react, examples/*) are
// updated in T2/T3 to import from this surface only.

// Styles
export type {
  Style, ComputedStyle, UsedStyle, Length, LengthOrAuto, ComputedLength, ComputedLengthOrAuto, Color,
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
export type { PhysicalBorderSides, LogicalSideContext } from "./styles";
export { physicalBorderSides, resolveLogicalSides } from "./styles";

export { isOpenableLinkUrl, isExportSafeLinkUrl } from "./url-safety";

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
  subscribeForeignChanges,
  runWithTransactionOrigin,
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
  asBlockId,
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

// Inline image (image that flows IN LINE with text — Google Docs "In line"
// positioning). An inline EmbedItem; its `properties` carry the image data
// (src / width / height / alt). `embedType` is an open string discriminant.
export { INLINE_IMAGE_EMBED_TYPE } from "./state";

// Hard line break (`<br>`) embed type — surfaced so the HTML decoder
// (`@taleweaver/print`) can stamp the embed without hardcoding the literal.
export { HARD_BREAK_EMBED_TYPE } from "./state";

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

// Change-tracking / Suggesting mode (slice 1 — INERT state vocabulary): the
// three suggestion-attr-key consts, the two break-embed-type consts, and the
// record types. The side-table IO helpers stay intra-state (mirror comments).
export {
  INSERTION_SUGGESTION_ATTR,
  DELETION_SUGGESTION_ATTR,
  FORMATTING_SUGGESTION_ATTR,
  BLOCK_JOIN_SUGGESTION_EMBED_TYPE,
  BLOCK_SPLIT_SUGGESTION_EMBED_TYPE,
  buildSuggestionRangeIndex,
  resolveSuggestionRange,
  getSuggestions,
} from "./state";
export type {
  SuggestionId,
  SuggestionKind,
  SuggestionRecord,
  SuggestionRange,
  ResolvedSuggestion,
  SuggestionView,
} from "./state";

// History (Y.UndoManager-backed)
export {
  History,
  createHistory,
  type SelectionEntry,
  type UndoRedoResult,
} from "./state";

// Document serialization (pluggable serializer + registry + Yjs-binary v1 +
// human-friendly JSON + human-friendly HTML). The HTML serializer parses via an
// injected `HtmlParser` (a browser host supplies a DOM-backed adapter), keeping
// core DOM-free.
export type { SerializedDocument, DocumentSerializer, SerializerRegistry } from "./state";
export type { HtmlNode, HtmlParser } from "./state";
export {
  createSerializerRegistry,
  createDefaultSerializerRegistry,
  serializeDocument,
  deserializeDocument,
  createBinaryDocumentSerializer,
  BINARY_FORMAT,
  createJsonDocumentSerializer,
  JSON_FORMAT,
  UnknownSerializerFormatError,
  MalformedDocumentError,
  encodeHtml,
  decodeHtml,
  createHtmlDocumentSerializer,
  HTML_FORMAT,
} from "./state";

// Cascade
export { cascadePass, cascadePassIncremental, composeComputed, resolveLength } from "./cascade";
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
export type { LayoutBoxMetadata } from "./render/layout-metadata";
export { render } from "./render/render";
export type { RenderOutput } from "./render/render";
export { BROKEN_CROSS_REFERENCE_TEXT } from "./render/resolve-cross-reference";
// Geometry-free body-cascade helpers (headers/footers + footnote bodies). The
// backend layout-driver (`@taleweaver/print`) cascades these side-tree bodies as
// part of the render→cascade→layout pipeline it owns (Phase 0b). Pure
// render/cascade — legitimately public.
export { cascadeTemplateContents, cascadeEmbedContents } from "./editor/actions/helpers";

// Layout — TEXT CORE only. The geometric box-layout surface (LayoutBox / PageBox /
// VirtualLayoutTree / layoutTree / BFC / IFC / used-style / footnote-resolve /
// pdf-outline / goto-destination, plus the D3 geometric cursor exports) RELOCATED
// to `@taleweaver/print` (dual-mode Phase 3 sub-phase 3); import them from there.
// What remains here is Unicode-correct text mechanics + the shaper/measurer
// interface vocabulary that both core and the print backend share.
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
export { createMockHyphenator } from "./layout/mock-hyphenator";
export type { Hyphenator, PatternSet } from "./layout/hyphenator";
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
export type { BlockParentLookup } from "./state/block-parent-lookup-type";
export { makeBlockParentLookup } from "./editor/block-parent-lookup";
export type { PageConfig, PageMargins } from "./state/page-config";
// CSS letter-/word-spacing rule — applied by the in-engine mock shapers and by
// the @taleweaver/print canvas shaper (re-exported here so dom can share the rule).
// Only the two functions called across the package boundary are surfaced;
// `isWordSeparatorCluster` is an internal detail of `clusterSpacing`.
export { resolveSpacingPx, clusterSpacing } from "./layout/text-spacing";
export { graphemeClusters } from "./layout/graphemes";

// --- Geometry-shed public surface (dual-mode Phase 3 sub-phase 3) ---
// The geometric layout engine (geometric `layout/*` + the D3 geometric `cursor/*`)
// moved OUT of core into `@taleweaver/print`. These STAYING-core symbols are the
// supporting vocabulary that the relocated geometry imports across the package
// boundary, so they are surfaced on the core barrel for `@taleweaver/print` to
// consume. All are geometry-FREE (styles / cascade / render-hint / state / text-core
// / footnote-anchor projection); no positioned-box type is among them.
export type { TextAlign } from "./styles/style";
// `TransformFn` is already exported above (line ~19 from "./styles").
export type { StackingContextRole } from "./styles/position";
export { computeStackingContextRole } from "./styles/position";
export type { TabStop } from "./styles/tab-stops";
export type { AxisMap } from "./styles/writing-mode";
export { axisMapFor, logicalToPhysical } from "./styles/writing-mode";
export type { ColumnConfig, ColumnRule } from "./styles/column-config";
export {
  DEFAULT_COLUMN_CONFIG,
  DEFAULT_COLUMN_GAP,
  columnConfigsEqual,
} from "./styles/column-config";
export { formatCounter } from "./styles/format-counter";
export { computedStylesEqual } from "./cascade/cascade-pass";
export { INLINE_KEY_SEPARATOR } from "./render/inline-render-key";
export type { BlockKindResolver } from "./state/block-kinds";
export { coerceBlockId } from "./state/block-id";
export type { GridCell, TableGrid, AssignedCell } from "./state/table-grid-core";
export { assignTableGrid } from "./state/table-grid-core";
export type { PageFieldNumberStyle } from "./state/page-field";
export {
  PAGE_FIELD_EMBED_TYPE,
  PAGE_FIELD_RESERVED_GLYPHS,
  isPageFieldNumberStyle,
} from "./state/page-field";
export { createTable } from "./state/ops/create-table";
export { insertPageField } from "./state/ops/insert-page-field";
export type { FootnoteAnchorRef } from "./footnotes/types";
export { EMPTY_FOOTNOTE_ANCHORS, collectFootnoteAnchors } from "./footnotes/collect-anchors";
export { isDevMode } from "./layout/dev-mode";
export { measurerToShaper } from "./layout/text-measurer";
export { createVariableMockShaper } from "./layout/mock-shaper";
export { LINE_BREAK, tokenize } from "./layout/text-tokenize";
export { transformRun } from "./layout/text-transform";
export { applyL1, reorderRunsByLevel } from "./layout/uax9/reorder";
export { nextGraphemeBoundary, prevGraphemeBoundary } from "./cursor/grapheme-utils";
export { footnoteBodyComponent } from "./components/footnote-body";
export type { ContainerBlockView, RenderContext } from "./render/block-view";
// Test-support builders consumed by the geometry tests that relocated to
// `@taleweaver/print` (those tests cross the package boundary now, so the
// builders they use must be on the barrel). Pure document-construction helpers.
export { buildBlock, buildState, inlineContent, text, embed } from "./test-utils/state-builders";

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
  tableOfContentsComponent,
  tableComponent,
  tableRowComponent,
  tableCellComponent,
} from "./components";

// Cursor — GEOMETRY-FREE selection model only. The D3 geometric cursor surface
// (hit-test / cursor-position / selection-geometry / comment+suggestion rects /
// line-navigation / visual-motion / line-bidi / atomic-box-index / line-flatten)
// RELOCATED to `@taleweaver/print` (dual-mode Phase 3 sub-phase 3) — import those
// from there. What remains is the pure document-level selection vocabulary.
export {
  moveByCharacter,
  moveByWord,
  expandSelection,
  selectWord,
} from "./cursor/cursor-ops";
export type { CaretAffinity } from "./cursor/selection";
export { isCollapsed, selectionsEqual } from "./cursor/selection";
export { isObjectSelection } from "./cursor/object-selection";
export { isTextShaper } from "./layout/text-measurer";

// Editor
export type { EditorAction } from "./editor/editor-action";
// Inline (character-level) formatting attr keys — the single source of truth
// for what CLEAR_FORMATTING removes; exported so downstream consumers can
// reason about the same set.
export type { InlineFormatAttrKey } from "./editor/inline-format-keys";
export { INLINE_FORMAT_ATTR_KEYS } from "./editor/inline-format-keys";
// LineBox-canonical line traversal (`AbsoluteLineBox` / `collectLineBoxes` etc.)
// is geometric and RELOCATED to `@taleweaver/print` (dual-mode Phase 3 sub-phase 3).
export type {
  EditorState,
  EditorConfig,
} from "./editor/editor-state";
export {
  createInitialEditorState,
  // Build an `EditorState` from an arbitrary seed `State` + initial `Selection`
  // (the full render → cascade → layout build). The public seam for hosts/tests
  // that need a non-default seed document (e.g. a TOC + headings doc) without an
  // editor-from-state injection.
  createEditorStateFromState,
  reduceEditor,
  findFirstContentBlock,
  findLastContentBlock,
} from "./editor/editor-state";
// Live-collab P1: apply a peer's edit (foreign dirty block ids from
// `subscribeForeignChanges`) to the local `EditorState` — `freshState` cache
// invalidation + incremental `lastDirtyIds`, selection/history passthrough.
export { reconcileForeignChange } from "./editor/reconcile-foreign-change";
// Derive the default collapsed caret for a freshly-loaded `State` (first
// content block, offset 0). Pairs with `createEditorStateFromState`.
export { initialSelectionForState } from "./editor/actions";
// Geometry-free editor helpers the print backend's NavIntent resolver imports
// (Phase 0b): the anchor-affinity seed (focus-only extenders), the object-nav
// selection, and the line-delete span guards. `seedAnchorAffinity` lives on
// `editor-state`; the rest in `editor/actions`.
export { seedAnchorAffinity } from "./editor/editor-state";
export {
  objectMoveSelection,
  isCrossContextSelection,
  expandedSpanCollapsePoint,
} from "./editor/actions";
export { exportDocument, loadDocument } from "./editor/document-io";

// Public input shape for the INSERT_NODE action payload.
export type { BlockInit } from "./state";

// Footnotes — document-wide numbering policy (read/written by the
// SET_FOOTNOTE_POLICY editor action; the toolbar reads the current value).
export type { CounterFormat, FootnoteNumberingPolicy, FootnoteNumber } from "./footnotes";
export { documentFootnotePolicy } from "./footnotes";
// FN-6.4 restart-per-page numbering inputs for the backend layout-driver's
// second pass (geometry-free numbering math; the driver owns the layout-derived
// page-assignment feedback loop in Phase 0b).
export { footnoteNumbers, footnoteRenumberedBlocks } from "./footnotes";

// Accessibility — pure, geometry-free semantic projection of the document
// (a read-side sibling of getOutline/extractText). A host materializes the
// `AccessibilityNode` tree into a hidden semantic DOM mirror for screen readers.
export { buildAccessibilityTree } from "./accessibility/build-accessibility-tree";
export type {
  AccessibilityNode,
  AccessibilityRole,
  AccessibilityTextRun,
  BuildAccessibilityTreeOptions,
} from "./accessibility/accessibility-node";

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
