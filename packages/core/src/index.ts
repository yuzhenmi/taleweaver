// @taleweaver/core — word processor engine

// State tree
export type { StateNode, NodeStyles } from "./state/state-node";
export { createNode, createTextNode } from "./state/create-node";
export {
  updateProperties,
  insertChild,
  removeChild,
  getNodeByPath,
  updateAtPath,
} from "./state/operations";
export type { Position, Span } from "./state/position";
export {
  createPosition,
  createSpan,
  comparePositions,
  normalizeSpan,
} from "./state/position";
export type { Change } from "./state/change";
export { createChange } from "./state/change";
export {
  insertText,
  deleteRange,
  replaceRange,
  splitNode,
} from "./state/transformations";
export { findDirtyPaths, isDirty } from "./state/dirty";
export type { History } from "./state/history";
export { createHistory, pushChange, undo, redo } from "./state/history";
export { createEmptyDocument } from "./state/initial-state";
export { getTextContent, getTextContentLength, clampOffset } from "./state/text-utils";
export { findPathById } from "./state/find-path";
export {
  applyInlineStyle,
  getStyleInRange,
  remapPosition,
} from "./state/formatting";
export { extractText } from "./state/extract-text";

// Render tree
export type {
  RenderNode,
  RenderNodeType,
  RenderStyles,
  BlockRenderNode,
  GridRenderNode,
  InlineRenderNode,
  TextRenderNode,
} from "./render/render-node";
export {
  createBlockNode,
  createGridNode,
  createInlineNode,
  createTextRenderNode,
} from "./render/render-node";
export { renderTree, renderTreeIncremental } from "./render/render";

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

// Layout tree
export type {
  LayoutBox,
  BlockLayoutBox,
  GridLayoutBox,
  LineLayoutBox,
  PageLayoutBox,
  TextLayoutBox,
} from "./layout/layout-node";
export {
  createBlockLayoutBox,
  createGridLayoutBox,
  createLineLayoutBox,
  createPageLayoutBox,
  createTextLayoutBox,
} from "./layout/layout-node";
export type { TextMeasurer } from "./layout/text-measurer";
export { createMockMeasurer } from "./layout/text-measurer";
export type { WordBox } from "./layout/text-splitter";
export { splitTextIntoWords } from "./layout/text-splitter";
export type { PageMargins } from "./layout/layout-engine";
export { layoutTree, layoutTreeIncremental } from "./layout/layout-engine";

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
