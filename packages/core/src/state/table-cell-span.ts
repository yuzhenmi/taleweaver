/**
 * Shared table-cell span predicate (P8 / P15a).
 *
 * A REAL (non-identity) `rowSpan`/`colSpan` is a finite integer `> 1`. A span of
 * 1 is the HTML default; an absent / malformed value (`undefined`, a string,
 * `1.5`, `0`, `NaN`) is treated as no-span. This single source is consumed by
 *  - the `table-cell` component, which stamps `metadata.rowSpan`/`colSpan` only
 *    for real spans (keeping 1×1 cells byte-identical to pre-P8), and
 *  - the table-editing context resolver, which detects whether a table has any
 *    span (the P15a no-span boundary).
 * Keeping both on one predicate means the layout's span view and the editor's
 * span view can never drift.
 */
export function spanValue(v: unknown): number | undefined {
  // `Number.isInteger` already excludes NaN, Infinity, and non-integers, so no
  // separate `Number.isFinite` check is needed.
  return typeof v === "number" && Number.isInteger(v) && v > 1 ? v : undefined;
}

/** True iff `v` is a real span (finite integer `> 1`). */
export function isSpan(v: unknown): boolean {
  return spanValue(v) !== undefined;
}
