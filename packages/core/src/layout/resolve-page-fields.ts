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
 * Pure post-pagination pass producing each field's document-global value (page-count
 * only) and the WIDEST value width it can show across the pages it appears on. The
 * width is the §4.4 convergence loop's overflow signal, so it MUST be a true upper
 * bound on every page's actual value width — never an under-estimate (a too-small
 * width would let the loop converge on an under-sized slot reservation).
 *
 *  - `page-count` shows ONE value (`formatCounter(totalPages, numberStyle)`) on every
 *    page, so its value and width are exact from that single `formatCounter`.
 *  - `page-number` VARIES per page (`1..totalPages`). The widest is NOT always the
 *    last page: non-decimal styles are non-monotonic in width (lower-roman "viii" at
 *    page 8 is wider than "x" at page 10), and proportional fonts make even decimal
 *    widths non-monotonic. So the max is taken over EVERY page's value.
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
    if (spec.fieldKind === "page-count") {
      // One value, the same on every page — exact value + width.
      const value = formatCounter(totalPages, spec.numberStyle);
      globalFieldValues.set(spec.embedKey, value);
      maxValueWidthByKey.set(spec.embedKey, measurer.measureWidth(value, spec.computedStyle));
    } else {
      // page-number: the value varies 1..totalPages and width is non-monotonic
      // (roman/proportional), so measure every page's value to get a TRUE upper
      // bound — the last page alone would under-estimate. O(totalPages) per
      // page-number template field per build; such fields are rare (0-1 per doc)
      // and this is the same order as the measure pass — memoize by totalPages if a
      // profile ever demands it. No global entry: `substitutePageFields` computes
      // `pageIndex + 1` per page at materialize.
      let maxWidth = 0;
      for (let page = 1; page <= totalPages; page++) {
        const w = measurer.measureWidth(formatCounter(page, spec.numberStyle), spec.computedStyle);
        if (w > maxWidth) maxWidth = w;
      }
      maxValueWidthByKey.set(spec.embedKey, maxWidth);
    }
  }

  return { globalFieldValues, maxValueWidthByKey };
}
