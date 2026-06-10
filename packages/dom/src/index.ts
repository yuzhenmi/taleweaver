// @taleweaver/dom — DOM integration layer for the Taleweaver engine

// DOM-specific (local)
export { FONT_CONFIG, buildCssFontString, getEffectiveStyles } from "./font-config";
export { createCanvasMeasurer } from "./canvas-measurer";
export { createCanvasShaper } from "./canvas-shaper";
export { mapKeyEvent } from "./key-handler";
export type { CursorState, MatchHighlightRect, CommentHighlightRect, SuggestionHighlightRect } from "./canvas-renderer";
export {
  paintCanvas,
  paintPage,
  MATCH_HIGHLIGHT_FILL,
  ACTIVE_MATCH_HIGHLIGHT_FILL,
  COMMENT_HIGHLIGHT_FILL,
  ACTIVE_COMMENT_HIGHLIGHT_FILL,
  SUGGESTION_HIGHLIGHT_FILL,
  ACTIVE_SUGGESTION_HIGHLIGHT_FILL,
} from "./canvas-renderer";
// Human-friendly HTML serializer (taleweaver-html) — DOMParser-backed, so it
// lives in dom. The host composes it into a core SerializerRegistry manually.
export { HTML_FORMAT, createHtmlDocumentSerializer } from "./html-serializer";
export { createEditorController } from "./editor-controller";
export type { EditorController, EditorControllerOptions, FindStatus, CommentHighlight, SuggestionHighlight } from "./editor-controller";
export { ImageCache } from "./image-cache";
export type { PaintInputHash, PaintCache } from "./paint-cache";
export type { Rect, CursorSnapshot, MatchHighlightRectSnapshot, CommentHighlightRectSnapshot, SuggestionHighlightRectSnapshot } from "./paint-cache";
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
