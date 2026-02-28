// @taleweaver/core — word processor engine

// State tree
export type { StateNode } from "./state/state-node";
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
export { getTextContent, getTextContentLength } from "./state/text-utils";
export { findPathById } from "./state/find-path";
export {
  applyInlineStyle,
  removeInlineStyle,
  isFullyStyled,
  remapPosition,
} from "./state/formatting";
export { extractText } from "./state/extract-text";

// Render tree
export type {
  RenderNode,
  RenderNodeType,
  RenderStyles,
  BlockRenderNode,
  InlineRenderNode,
  TextRenderNode,
} from "./render/render-node";
export {
  createBlockNode,
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
  pickInlineStyles,
  ComponentRegistry,
  createRegistry,
} from "./components";

// Layout tree
export type {
  LayoutBox,
  BlockLayoutBox,
  LineLayoutBox,
  TextLayoutBox,
} from "./layout/layout-node";
export {
  createBlockLayoutBox,
  createLineLayoutBox,
  createTextLayoutBox,
} from "./layout/layout-node";
export type { TextMeasurer } from "./layout/text-measurer";
export { createMockMeasurer } from "./layout/text-measurer";
export type { WordBox } from "./layout/text-splitter";
export { splitTextIntoWords } from "./layout/text-splitter";
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
