// packages/core/src/state/page-config.ts
//
// Page-setup data (size, orientation, margins, gap). DOCUMENT data — NOT layout
// geometry: page setup round-trips with the document (Google Docs File ▸ Page
// setup; Word per-section; .docx). It lives in `state/` (mode-agnostic, no
// `layout/` dependency) so core's `EditorConfig` can carry it for
// `toggle-section-landscape` AND the print backend's `LayoutConfig` can carry it
// for pagination — the SAME instance supplied to both by the host. The
// `layout/page-config.ts` file re-exports these for back-compat.

/**
 * Page margins. Logical-axis fields; the painter maps them via writing-mode.
 * For horizontal-tb LTR: blockStart=top, blockEnd=bottom, inlineStart=left, inlineEnd=right.
 */
export interface PageMargins {
  readonly blockStart:  number;
  readonly blockEnd:    number;
  readonly inlineStart: number;
  readonly inlineEnd:   number;
}

/**
 * Pagination configuration. When the print backend's `LayoutConfig.pageConfig`
 * is set, the layout pass produces a sequence of `PageBox`es instead of a single
 * `BlockBox`. Core's `EditorConfig.pageConfig` carries the SAME data for
 * `toggle-section-landscape` (the landscape dimension swap reads the document's
 * default page dimensions).
 */
export interface PageConfig {
  /** Page's logical inline-size (width in horizontal-tb). */
  readonly pageInlineSize: number;
  /** Page's logical block-size (height in horizontal-tb). */
  readonly pageBlockSize:  number;
  /** Logical-axis margins around the content area. */
  readonly pageMargins:    PageMargins;
  /** Visual gap between pages (only affects rendering, not layout). */
  readonly pageGap:        number;
}
