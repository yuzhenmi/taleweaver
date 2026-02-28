// @taleweaver/dom — DOM integration layer for the Taleweaver engine

// Font config
export { FONT_CONFIG, buildCssFontString, getEffectiveStyles } from "./font-config";

// Canvas measurer
export { createCanvasMeasurer } from "./canvas-measurer";

// Key handler
export type { EditorAction } from "./key-handler";
export { mapKeyEvent } from "./key-handler";

// Cursor position
export type { PixelPosition } from "./cursor-position";
export { resolvePixelPosition } from "./cursor-position";

// Editor state
export type {
  EditorState,
  EditorConfig,
  EditorHistory,
  EditorHistoryEntry,
} from "./editor-state";
export {
  createInitialEditorState,
  reduceEditor,
  findFirstTextDescendant,
  findLastTextDescendant,
} from "./editor-state";

// Hit testing
export { resolvePositionFromPixel } from "./hit-test";

// Selection geometry
export type { SelectionRect } from "./selection-geometry";
export { computeSelectionRects } from "./selection-geometry";

// Line navigation
export { moveToLine, moveToLineBoundary } from "./line-navigation";

// Layout utils
export type { AbsoluteTextBox } from "./layout-utils";
export { collectAllTextBoxes } from "./layout-utils";

// Canvas renderer
export type { CursorState } from "./canvas-renderer";
export { paintCanvas } from "./canvas-renderer";
