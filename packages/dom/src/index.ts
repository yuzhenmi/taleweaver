// @taleweaver/dom — DOM integration layer for the Taleweaver engine

// DOM-specific (local)
export { FONT_CONFIG, buildCssFontString, getEffectiveStyles } from "./font-config";
export { createCanvasMeasurer } from "./canvas-measurer";
export { createCanvasShaper } from "./canvas-shaper";
export { mapKeyEvent } from "./key-handler";
export type { CursorState, MatchHighlightRect } from "./canvas-renderer";
export {
  paintCanvas,
  paintPage,
  MATCH_HIGHLIGHT_FILL,
  ACTIVE_MATCH_HIGHLIGHT_FILL,
} from "./canvas-renderer";
export { createEditorController } from "./editor-controller";
export type { EditorController, EditorControllerOptions, FindStatus } from "./editor-controller";
export { ImageCache } from "./image-cache";
export type { PaintInputHash, PaintCache } from "./paint-cache";
export { hashPaintInputs, createPaintCache } from "./paint-cache";

// Re-exports from core (backward compatibility)
export type { EditorAction, PixelPosition, SelectionRect, AbsoluteLineBox, LineLeaf } from "@taleweaver/core";
export type { EditorState, EditorConfig } from "@taleweaver/core";
export { History } from "@taleweaver/core";
export type { SelectionEntry, UndoRedoResult } from "@taleweaver/core";
export { resolvePixelPosition, resolvePositionFromPixel, computeSelectionRects } from "@taleweaver/core";
export { moveToLine, moveToLineBoundary } from "@taleweaver/core";
export { collectLineBoxes, collectLineLeaves, findLineForPosition } from "@taleweaver/core";
export { createInitialEditorState, reduceEditor } from "@taleweaver/core";
export type { CounterFormat, FootnoteNumberingPolicy } from "@taleweaver/core";
export { documentFootnotePolicy } from "@taleweaver/core";
// Find & Replace (#433): re-export the find primitives the find-bar UI needs.
export { findMatches } from "@taleweaver/core";
export type { TextMatch, FindMatchesOptions } from "@taleweaver/core";
