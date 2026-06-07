/**
 * Pure helpers for the `columnWidths` attr (an array of fractions summing to ~1.0)
 * a `table` block carries when it uses explicit column sizing. Used by the P15a
 * column insert/delete ops to keep the fractions consistent. When a table has NO
 * `columnWidths` (auto-layout), the ops skip these entirely — auto-layout
 * recomputes widths from the new cell set.
 */

/** Renormalize so the fractions sum to exactly 1.0 (within float). A degenerate
 *  all-zero / empty input distributes evenly (or returns `[]`). */
function normalize(widths: readonly number[]): number[] {
  const n = widths.length;
  if (n === 0) return [];
  const sum = widths.reduce((s, w) => s + w, 0);
  if (sum <= 0) return widths.map(() => 1 / n);
  return widths.map((w) => w / sum);
}

/**
 * Insert a new column fraction at index `at`. The new column takes `1/(n+1)` of
 * the table; the existing columns are pre-scaled by `n/(n+1)` so their relative
 * proportions are preserved. The final `normalize` pass is not redundant — it
 * corrects float imprecision so the stored fractions sum to exactly 1.0 across
 * repeated edits. `at` is clamped to `[0, n]`; an empty input yields `[1]`.
 */
export function spliceColumnWidth(widths: readonly number[], at: number): number[] {
  const n = widths.length;
  if (n === 0) return [1];
  const clamped = Math.max(0, Math.min(Math.trunc(at), n));
  const scaled = widths.map((w) => w * (n / (n + 1)));
  const inserted = [...scaled.slice(0, clamped), 1 / (n + 1), ...scaled.slice(clamped)];
  return normalize(inserted);
}

/**
 * Remove the column fraction at index `at` and renormalize the rest to sum 1.0.
 * An out-of-range `at` returns a normalized copy (no structural change). Removing
 * the last remaining fraction yields `[]` (the caller deletes the whole table in
 * that case).
 */
export function removeColumnWidth(widths: readonly number[], at: number): number[] {
  const n = widths.length;
  if (at < 0 || at >= n) return normalize(widths);
  return normalize(widths.filter((_, i) => i !== at));
}

/**
 * True when a `table` block's raw `columnWidths` attr is a usable fraction array
 * (explicit column sizing). Absent / non-array / non-numeric → false, meaning
 * auto-layout: the column ops then make NO `columnWidths` change and let
 * auto-layout recompute widths from the new cell set.
 */
export function isColumnWidths(v: unknown): v is readonly number[] {
  return Array.isArray(v) && v.every((n) => typeof n === "number");
}
