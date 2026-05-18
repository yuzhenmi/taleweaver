// @taleweaver/core — word processor engine

// Styles
export type {
  Style, ComputedStyle, UsedStyle, Length, LengthOrAuto, Color,
  Display, BorderStyle, FontWeight, FontStyle, TextDecoration,
  WhiteSpace, VerticalAlign, Float, Clear,
  BreakBefore, BreakAfter, BreakInside,
  ListStyleType, ListStylePosition, BoxSizing,
  Direction,
} from "./styles";
export { PROPERTY_META, INITIAL_COMPUTED_STYLE } from "./styles";

// State tree (canonical, Y.Doc-backed surface)
export type { NewNode } from "./state/node";
export type { Position, Span } from "./state/position";
export {
  createPosition,
  createSpan,
  comparePositions,
  normalizeSpan,
} from "./state/position";
// Y.UndoManager-backed history (per Decision C). Replaces the legacy
// snapshot-based history at the P11.4 cutover.
export { History, createHistory, type PushHistoryArgs, type UndoRedoResult } from "./state/history";
export {
  applyInlineStyle,
  getStyleInRange,
  remapPosition,
} from "./state/formatting";

// Y.Doc-backed state module (P4e). The legacy StateNode/createEmptyDocument
// path below stays canonical through the P11.4 cutover per Decision D. The
// new surface is NOT yet re-exported here — P5+ phases inside packages/core
// deep-import what they need:
//   - State / createState / getBlock / getEmbedContent / applyOperation /
//     freshState from "./state/state"
//   - Y.Doc-backed createEmptyDocument from "./state/initial-state"
//   - Layer 3 ops + ClonedSubtree from "./state/operations"
//   - Block / InlineContent / TextItem / EmbedItem interfaces from
//     "./state/block" and "./state/inline-content" (factory functions
//     have been removed; tests use buildBlock/text/embed/inlineContent
//     from "./test-utils/state-builders")
//   - History (Y.UndoManager wrapper) re-exported above
// The export-surface flip from legacy to new happens at the P11.4 cutover.

// Cascade
export { cascadePass, composeComputed, resolveLength } from "./cascade";

// Render tree
export type {
  RenderNode,
  ElementBox,
  TextBox,
} from "./render/render-node";
export {
  createElementBox,
  createTextBox,
} from "./render/render-node";
export { renderTree, renderTreeIncremental } from "./render/render";

// Layout tree
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
export { layoutTree } from "./layout/layout-engine";
export { layoutTreeIncremental } from "./layout/layout-incremental";
export { establishesNewBFC } from "./layout/bfc-establishment";
export type { PageBox } from "./layout/page-box";
export { createPageBox } from "./layout/page-box";
export type { PageConfig, PageMargins } from "./layout/page-config";

// Components
export type { ComponentRenderFn, ComponentDefinition } from "./components";
export {
  defaultComponents,
  documentComponent,
  paragraphComponent,
  textComponent,
  spanComponent,
  headingComponent,
  listComponent,
  listItemComponent,
  imageComponent,
  horizontalLineComponent,
  tableComponent,
  tableRowComponent,
  tableCellComponent,
  ComponentRegistry,
  createRegistry,
} from "./components";
export {
  createParagraph,
  createHeading,
  createText,
  createList,
  createListItem,
  createTable,
  createImage,
  createHorizontalLine,
} from "./components/factories";

// Cursor
export type { Selection } from "./cursor/selection";
export {
  createSelection,
  createCursor,
  isCollapsed,
  selectionStart,
  selectionEnd,
} from "./cursor/selection";
export {
  moveByCharacter,
  moveByWord,
  expandSelection,
  selectWord,
} from "./cursor/cursor-ops";

// Editor (platform-agnostic editor modules)
export type { EditorAction } from "./editor/editor-action";
export type { AbsoluteTextBox } from "./editor/layout-utils";
export { collectAllTextBoxes } from "./editor/layout-utils";
export type { PixelPosition } from "./editor/cursor-position";
export { resolvePixelPosition } from "./editor/cursor-position";
export { resolvePositionFromPixel } from "./editor/hit-test";
export type { SelectionRect } from "./editor/selection-geometry";
export { computeSelectionRects } from "./editor/selection-geometry";
export { moveToLine, moveToLineBoundary } from "./editor/line-navigation";
export type {
  EditorState,
  EditorConfig,
  EditorHistory,
  EditorHistoryEntry,
} from "./editor/editor-state";
export {
  createInitialEditorState,
  reduceEditor,
  findFirstTextDescendant,
  findLastTextDescendant,
} from "./editor/editor-state";

// Performance tracing
export type { PerfReport } from "./perf/perf-trace";
export {
  setPerfTraceEnabled, isPerfTraceEnabled,
  markStart, markEnd, recordSample, report, resetPerfTrace,
} from "./perf/perf-trace";

// =============================================================================
// === LEGACY (pre-P11.4 cutover) ===
//
// The exports below are part of the pre-Yjs StateNode model. They remain
// in the public API surface until P11.4 retires the path-based editor
// action layer. New code should not import them.
// =============================================================================

/** @deprecated Removed at P11.4 cutover. */
export type { StateNode } from "./state/state-node-legacy";
/** @deprecated Removed at P11.4 cutover. */
export { createNode, createTextNode } from "./state/create-node-legacy";
/** @deprecated Removed at P11.4 cutover. */
export {
  updateProperties,
  insertChild,
  removeChild,
  getNodeByPath,
  updateAtPath,
} from "./state/operations-legacy";
/** @deprecated Removed at P11.4 cutover. */
export type { Change } from "./state/change-legacy";
/** @deprecated Removed at P11.4 cutover. */
export { createChange } from "./state/change-legacy";
/** @deprecated Removed at P11.4 cutover. */
export {
  insertText,
  deleteRange,
  replaceRange,
  splitNode,
} from "./state/transformations-legacy";
/** @deprecated Removed at P11.4 cutover. */
export { findDirtyPaths, isDirty } from "./state/dirty-legacy";
/** @deprecated Removed at P11.4 cutover. Use Y.UndoManager-backed History from "./state/history". */
export type { History as HistoryLegacy } from "./state/history-legacy";
/** @deprecated Removed at P11.4 cutover. Use Y.UndoManager-backed History from "./state/history". */
export {
  createHistory as createHistoryLegacy,
  pushChange,
  undo as undoLegacy,
  redo as redoLegacy,
} from "./state/history-legacy";
/** @deprecated Removed at P11.4 cutover. */
export { createEmptyDocument } from "./state/initial-state-legacy";
/** @deprecated Removed at P11.4 cutover. */
export { getTextContent, getTextContentLength, clampOffset } from "./state/text-utils-legacy";
/** @deprecated Removed at P11.4 cutover. */
export { findPathById } from "./state/find-path-legacy";
/** @deprecated Removed at P11.4 cutover. */
export { extractText } from "./state/extract-text-legacy";
