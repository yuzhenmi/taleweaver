// @taleweaver/dom — DOM integration layer for the Taleweaver engine

// DOM-specific (local)
export { FONT_CONFIG, buildCssFontString, getEffectiveStyles } from "./font-config";
export { createCanvasMeasurer } from "./canvas-measurer";
export { mapKeyEvent } from "./key-handler";
export type { CursorState } from "./canvas-renderer";
export { paintCanvas, paintPage } from "./canvas-renderer";
export { createEditorController } from "./editor-controller";
export type { EditorController, EditorControllerOptions } from "./editor-controller";
export { ImageCache } from "./image-cache";

// Re-exports from core (backward compatibility)
export type { EditorAction, PixelPosition, SelectionRect, AbsoluteTextBox } from "@taleweaver/core";
export type { EditorState, EditorConfig, EditorHistory, EditorHistoryEntry } from "@taleweaver/core";
export { resolvePixelPosition, resolvePositionFromPixel, computeSelectionRects } from "@taleweaver/core";
export { moveToLine, moveToLineBoundary } from "@taleweaver/core";
export { collectAllTextBoxes } from "@taleweaver/core";
export { createInitialEditorState, reduceEditor } from "@taleweaver/core";
export { findFirstTextDescendant, findLastTextDescendant } from "@taleweaver/core";
