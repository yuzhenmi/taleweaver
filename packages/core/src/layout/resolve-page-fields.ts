import type { TextMeasurer } from "./text-measurer";
import type { FieldSpec } from "./collect-page-fields";
import { formatCounter } from "../styles/format-counter";

export interface ResolvedPageFields {
  /** page-count (and later page-ref / TOC) → one value each, keyed by embedKey. */
  readonly globalFieldValues: ReadonlyMap<string, string>;
  /**
   * Widest resolved display width per field (px) — for page-count the single
   * value's width; for page-number the largest page index's width. Compared
   * against the reserved placeholder width by the convergence rule (a later slice).
   */
  readonly maxValueWidthByKey: ReadonlyMap<string, number>;
}

/**
 * Pure post-pagination pass. `page-count` resolves ONCE from `plan.entries.length`
 * (same value on every page); `page-number` resolves per-page at materialize (no
 * global entry here). For BOTH kinds the widest plausible value is
 * `formatCounter(totalPages, numberStyle)` — for page-count it is the value, for
 * page-number it is the last page's number (the largest digit count) — so that one
 * `formatCounter` call drives both the value and its width.
 *
 * Reads only `plan.entries.length`; the structural param type keeps test fixtures
 * from having to stub full `PagePlanEntry` objects. Each spec carries its own
 * `computedStyle`, so width measurement needs only a {@link TextMeasurer}.
 */
export function resolvePageFields(
  plan: { readonly entries: { readonly length: number } },
  fieldSpecs: readonly FieldSpec[],
  measurer: TextMeasurer,
): ResolvedPageFields {
  const totalPages = plan.entries.length;
  const globalFieldValues = new Map<string, string>();
  const maxValueWidthByKey = new Map<string, number>();

  for (const spec of fieldSpecs) {
    // `formatCounter(totalPages, ...)` is the widest value for decimal/alpha
    // (monotonic in digit count). For ROMAN numerals it can UNDER-estimate — e.g.
    // "viii" (8) is wider than "ix" (9) or "x" (10) — so `maxValueWidthByKey` is a
    // best-effort estimate, not a guaranteed maximum. The §4.4 convergence loop
    // (a later slice) treats this as a lower bound and GROWS the reservation if the
    // real value overflows, so an under-estimate here is corrected, not a bug.
    const widest = formatCounter(totalPages, spec.numberStyle);
    maxValueWidthByKey.set(spec.embedKey, measurer.measureWidth(widest, spec.computedStyle));
    if (spec.fieldKind === "page-count") {
      globalFieldValues.set(spec.embedKey, widest); // same value on every page
    }
    // page-number gets no global entry — substitutePageFields computes pageIndex+1 per page.
  }

  return { globalFieldValues, maxValueWidthByKey };
}
