// @taleweaver/print — DOM integration layer for the Taleweaver engine

// Knuth-Liang auto-hyphenation: the print layout engine owns the algorithm; the
// host injects per-language pattern data (`@taleweaver/hyphenation-*`) via
// `createLiangHyphenator(languages)`. `PatternSet` is re-exported from core for
// ergonomic typing of the injected map.
export { createLiangHyphenator } from "./layout/hyphenation/create-liang-hyphenator";
export { compilePatterns, hyphenateWord } from "./layout/hyphenation/liang";
export type { PatternSet } from "@taleweaver/core";

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
// `taleweaver-html` (de)serialization now lives in `@taleweaver/core`
// (`state/serialize/`); core stays DOM-free by parsing through an injected
// `HtmlParser`. This package provides the browser DOM adapter that supplies one.
export { browserHtmlParser } from "./html-parser";
// Accessibility DOM mirror: pure AccessibilityNode → detached, visually-hidden
// semantic DOM subtree (consumes core's buildAccessibilityTree projection).
export { buildDomMirror } from "./dom-mirror";
// Accessibility DOM mirror host (slice 2b): mounts the hidden, AT-visible,
// focusable contenteditable mirror, full-rebuilds it from the AccessibilityNode
// tree each paint, and wires input + browser-Selection mapping.
export { createDomMirrorHost } from "./dom-mirror-host";
export type { DomMirrorHost, DomMirrorHostOptions } from "./dom-mirror-host";
export {
  positionFromMirrorNode,
  locateOffsetInMirror,
  placeMirrorSelection,
  readMirrorSelection,
} from "./dom-mirror-selection";
export { createEditorController } from "./editor-controller";
export type { EditorController, EditorControllerOptions, FindStatus, CommentHighlight, SuggestionHighlight, CaretViewportRect } from "./editor-controller";
export type { PrintPdfEmitInput, PdfEmitter } from "./pdf-export";
export { ImageCache } from "./image-cache";
export type { PaintInputHash, PaintCache } from "./paint-cache";
export type { Rect, CursorSnapshot, MatchHighlightRectSnapshot, CommentHighlightRectSnapshot, SuggestionHighlightRectSnapshot } from "./paint-cache";
export { hashPaintInputs, createPaintCache } from "./paint-cache";

// The read-only DOM viewer + contenteditable editing backend moved to @taleweaver/digital
// (dual-mode Phase 3a). @taleweaver/print is the PRINT backend (canvas/layout-driver/paint).

// Re-exports from core (backward compatibility, geometry-free)
export type { EditorAction } from "@taleweaver/core";
export type { EditorState, EditorConfig } from "@taleweaver/core";
export { History } from "@taleweaver/core";
export type { SelectionEntry, UndoRedoResult } from "@taleweaver/core";
export { createInitialEditorState, reduceEditor } from "@taleweaver/core";
export type { CounterFormat, FootnoteNumberingPolicy } from "@taleweaver/core";
export { documentFootnotePolicy } from "@taleweaver/core";
// Find & Replace (#433): re-export the find primitives the find-bar UI needs.
export { findMatches } from "@taleweaver/core";
export type { TextMatch, FindMatchesOptions } from "@taleweaver/core";

// === Geometric layout engine — RELOCATED HERE from @taleweaver/core ===
// (dual-mode Phase 3 sub-phase 3). The positioned-box layout types, the layout
// passes (BFC / IFC / fragmentation / pagination / virtual tree), the table FCs,
// used-style, footnote-resolve, the PDF outline/goto-destination helpers, and the
// D3 geometric cursor surface (hit-test / cursor-position / selection-geometry /
// line-navigation / line-bidi / line-flatten / atomic-box-index / comment+suggestion
// rects) all live in this package now. Consumers (react, pdf, examples) import them
// from `@taleweaver/print`.
//
// Layout — positioned boxes + factories.
export type { LayoutBox, BlockBox, LineBox, TextRunBox } from "./layout/layout-node";
export {
  createBlockBox,
  createLineBox,
  createTextRunBox,
  createMarkerBox,
} from "./layout/layout-node";
export type { PageBox } from "./layout/page-box";
export { createPageBox } from "./layout/page-box";
// Layout — passes + engine entry points.
export { layoutTree } from "./layout/dispatch";
export { layoutTreeIncremental } from "./layout/layout-incremental";
export { establishesNewBFC } from "./layout/bfc-establishment";
export { sourceBlockIdOf, markerOwnerKey, collectTokens } from "./layout/ifc";
export { collectPageFields } from "./layout/collect-page-fields";
export type { IFCState, IFCStateCache } from "./layout/ifc-state";
export { createIFCStateCache } from "./layout/ifc-state";
export { computeIntrinsicSizes } from "./layout/intrinsic-sizes-pass";
export { computeUsedStyle } from "./layout/used-style";
// Virtualized layout: the `VirtualLayoutTree` is `EditorState.layoutTree` in
// paginated mode; consumers read it per-page via `getPage(i)`.
export type { VirtualLayoutTree } from "./layout/virtual-layout-tree";
// Layout-driver: the print backend's render → cascade → layout pipeline. A
// consumer builds a layout tree from a (geometry-free) core `State` by calling
// `createLayoutDriver(layoutConfig).rebuild(state, containerWidth, null)`. The
// `LayoutConfig` carries the print-only geometry capabilities (measurer /
// hyphenator) that left core's `EditorConfig` in Phase 0b.
export { createLayoutDriver } from "./layout-driver/layout-driver";
export type { LayoutDriver } from "./layout-driver/layout-driver";
export type { LayoutConfig } from "./layout-driver/layout-config";
export {
  __getGetPageDriverCountForTest,
  __resetGetPageDriverCountForTest,
} from "./layout/virtual-layout-tree";
// #522 — internal /GoTo destination resolution for the PDF exporter.
export {
  resolveGotoDestination,
  makeInternalDestinationResolver,
  type InternalDestination,
} from "./layout/resolve-goto-destination";
// #523 — PDF outline (`/Outlines` bookmark tree) helper.
export { buildPdfOutline, type PdfOutlineNode } from "./layout/pdf-outline";
// Cursor — D3 geometric surface.
export { resolvePositionFromPixel } from "./cursor/hit-test";
export type { PixelPosition } from "./cursor/cursor-position";
export { resolvePixelPosition } from "./cursor/cursor-position";
export type { SelectionRect } from "./cursor/selection-geometry";
export {
  computeSelectionRects,
  computeSelectionRectsForPage,
  computeObjectSelectionRect,
} from "./cursor/selection-geometry";
export { getCommentRangeRects } from "./cursor/comment-rects";
export { getSuggestionRangeRects } from "./cursor/suggestion-rects";
export { moveToLine, moveToLineBoundary } from "./cursor/line-navigation";
export { resolveLineForPosition, buildBlockGraphemeStepper } from "./cursor/visual-motion";
export { buildLineBidiView, moveVisually, inlineCoordForOffset } from "./cursor/line-bidi";
export type { LineBidiView, MoveVisuallyResult } from "./cursor/line-bidi";
export { getAtomicBoxIndex } from "./cursor/atomic-box-index";
export type { AtomicBoxIndex, AbsoluteRect } from "./cursor/atomic-box-index";
export type { AbsoluteLineBox, LineLeaf, LineIndex } from "./cursor/line-flatten";
export {
  collectLineBoxes,
  collectLineLeaves,
  findLineForPosition,
  getLineIndex,
} from "./cursor/line-flatten";

// === Test support (relocated geometric test-utils helpers) ===
// These construct positioned boxes / VirtualLayoutTrees and run the layout passes,
// so they live with the engine they exercise. Re-exported so the staying-core tests
// that still consume them resolve across the package boundary.
export { positionTreeForTest } from "./test-utils/position-tree";
export {
  paginatedHarness,
  assertPageHasLines,
  assertLineOnPage,
  buildSpanningTree,
} from "./test-utils/paginated-harness";
export type { PaginatedHarnessResult, SpanningTreeResult } from "./test-utils/paginated-harness";
export { resolveHitPosition } from "./test-utils/hit-position";
