// @taleweaver/digital — the contenteditable digital editing backend + the read-only DOM viewer.
// The browser computes pixels; this package runs NO layout engine. Depends on @taleweaver/core only.
//
// The "digital ships no layout engine" guarantee holds in full: core has shed its geometric layout
// (BFC/IFC/fragmentation/pagination now live in `@taleweaver/print`). What remains under core's
// `layout/` is headless TEXT mechanics only (grapheme segmentation, shapers, UAX #9 bidi / UAX #14
// line-break, intrinsic sizing), and core's `cursor/` is ID-based selection primitives — neither is
// pixel geometry. So `digital → core` pulls a geometry-free dependency.

// Read-only DOM viewer: render a document State into real, browser-flowed DOM via the styled tree.
export { renderDocumentToDom, renderNodeToDom } from "./dom-view/render-to-dom";
export type { RenderDocumentToDomOptions } from "./dom-view/render-to-dom";
export { computedStyleToInlineStyle } from "./dom-view/computed-style-to-css";

// Contenteditable editing controller (the interactive digital backend).
export { createDigitalController } from "./editor-digital/digital-controller";
export type { DigitalController, DigitalControllerOptions } from "./editor-digital/digital-controller";
