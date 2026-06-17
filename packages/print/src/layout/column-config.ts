/**
 * @module column-config
 *
 * Multi-column layout MATH (the part the layout passes consume).
 *
 * The per-section column VOCABULARY (`ColumnRule` / `ColumnConfig` /
 * `DEFAULT_COLUMN_CONFIG` / `DEFAULT_COLUMN_GAP` / `columnConfigsEqual`) lives in
 * `styles/column-config` so core-logical files can reference it without crossing
 * into `layout/`. This module holds only the layout geometry helper — the
 * per-track inline size — which is consumed exclusively by the layout passes
 * (measure / footnote re-fit / materialize).
 */

/**
 * The inline size available to ONE column track on a multi-column page:
 * the content inline size minus the inter-column gaps, divided evenly.
 * The single source of truth shared by the measure pass, the footnote
 * re-fit pass, and the materialize pass — they MUST agree on this number
 * (a divergence here was the root cause of the #494 multicol drift), so it
 * lives in one function rather than three copy-pasted expressions.
 */
export function computeTrackInlineSize(
  contentInlineSize: number,
  columnCount: number,
  columnGap: number,
): number {
  return (contentInlineSize - (columnCount - 1) * columnGap) / columnCount;
}
