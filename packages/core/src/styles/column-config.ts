/**
 * @module column-config
 *
 * Per-section multi-column configuration vocabulary (Google Docs Format ▸ Columns).
 *
 * Multi-column layout is SECTION-SCOPED (the Google-Docs model): a `section`
 * declares a column count + gap + optional line-between, and its content flows
 * through N equal-width columns per page. This module is the type vocabulary +
 * the doc default; `layout/section-column-config.resolveColumnConfig` validates a
 * section's overrides, and `layout/section-plan` threads the resolved config onto
 * each `SectionBoundary` (mirroring the per-section `PageConfig` machinery, C.2b-2).
 *
 * This is pure style vocabulary — it imports only from `styles/`, so core-logical
 * files (editor actions, the editor-action union) can reference `ColumnRule`
 * without crossing into `layout/`. The doc default gap (`DEFAULT_COLUMN_GAP`)
 * lives here too, since it is a CONFIG DEFAULT (it only populates
 * `DEFAULT_COLUMN_CONFIG`), not layout math. The column LAYOUT MATH
 * (`computeTrackInlineSize`) lives in `layout/column-config`, consumed only by
 * the layout passes.
 */
import type { BorderStyle } from "./style";
import type { Color } from "./color";

/**
 * The rule (line-between) painted in each gap between adjacent columns (CSS
 * `column-rule`). `null` (on `ColumnConfig`) means no rule. Reuses the existing
 * `BorderStyle` / `Color` vocabulary.
 */
export interface ColumnRule {
  readonly width: number; // px, >= 0
  readonly style: BorderStyle;
  readonly color: Color;
}

/** Per-section column configuration. `columnCount === 1` is single-column (no-op). */
export interface ColumnConfig {
  /** Number of equal-width columns; >= 1 (1 = single-column). */
  readonly columnCount: number;
  /** Inline-axis space (px) between adjacent columns. */
  readonly columnGap: number;
  /** The line-between, or `null` for no rule. */
  readonly columnRule: ColumnRule | null;
}

/**
 * The Google-Docs default column gap: 0.5 inch. At the engine's 96 px/in page
 * convention (see `page-config` — US-Letter pages are 816 × 1056 = 8.5 × 11 in
 * × 96) that is 48 px. A config default (the sole population of
 * `DEFAULT_COLUMN_CONFIG`), not layout math — hence it lives in `styles/`.
 */
export const DEFAULT_COLUMN_GAP = 48;

/** The engine-wide default: a single column, the default gap, no rule. */
export const DEFAULT_COLUMN_CONFIG: ColumnConfig = {
  columnCount: 1,
  columnGap: DEFAULT_COLUMN_GAP,
  columnRule: null,
};

/** Deep-equal two `ColumnRule`s (null-aware). */
function columnRulesEqual(a: ColumnRule | null, b: ColumnRule | null): boolean {
  if (a === null || b === null) {
    return a === b; // both null → equal; exactly one null → not equal.
  }
  return a.width === b.width && a.style === b.style && a.color === b.color;
}

/**
 * Deep-equal two `ColumnConfig`s over their scalar fields + the rule. Mirrors
 * `pageConfigsEqual`: keeps the no-override path inert — a section whose resolved
 * config equals the doc default gets NO `columnConfig` stamped on its boundary,
 * and a page's column geometry reuse gate (slice 2) shares this comparison.
 */
export function columnConfigsEqual(a: ColumnConfig, b: ColumnConfig): boolean {
  return (
    a.columnCount === b.columnCount &&
    a.columnGap === b.columnGap &&
    columnRulesEqual(a.columnRule, b.columnRule)
  );
}
