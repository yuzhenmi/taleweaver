// @taleweaver/core — word processor engine

// Styles
export type {
  Style, ComputedStyle, Length, LengthOrAuto, Color,
  Display, BorderStyle, FontWeight, FontStyle, TextDecoration,
  WhiteSpace, VerticalAlign, Float, Clear,
  BreakBefore, BreakAfter, BreakInside,
  ListStyleType, ListStylePosition, BoxSizing,
} from "./styles";
export { PROPERTY_META, INITIAL_COMPUTED_STYLE } from "./styles";

// State tree
export type { StateNode } from "./state/state-node";
export type { NewNode } from "./state/new-node";
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
export { renderTree } from "./render/render";

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
export { createMockMeasurer } from "./layout/text-measurer";
export { layoutTree } from "./layout/layout-engine";

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
