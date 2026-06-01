// packages/core/src/layout/page-config.ts

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
 * Pagination configuration. When `EditorConfig.pageConfig` is set, the layout
 * pass produces a sequence of `PageBox`es instead of a single `BlockBox`.
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
