import type { TextMeasurer } from "@taleweaver/core";
import type { FieldSpec } from "./collect-page-fields";
import { formatCounter } from "@taleweaver/core";
import { BROKEN_CROSS_REFERENCE_TEXT } from "@taleweaver/core";
import { pageOfFieldTarget, type BlockParentLookup } from "./page-of-field-target";

export interface ResolvedPageFields {
  /**
   * One value each, keyed by embedKey: `page-count` (the total-pages value) and
   * `cross-ref-page` (the target block's resolved page number, or `""` sentinel
   * when the target is not in the plan → broken-ref at substitute). `page-number`
   * carries NO entry here (it resolves per-page at materialize).
   */
  readonly globalFieldValues: ReadonlyMap<string, string>;
  /**
   * Widest resolved display width per field (px) — for page-count the single
   * value's width; for page-number the largest page index's width. Compared
   * against the reserved placeholder width by the §4.4 convergence rule.
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
 *  - `cross-ref-page` resolves the target's page via {@link pageOfFieldTarget}
 *    (`page + 1`, 1-based): a top-level target → its own first page; a nested target
 *    → its nearest top-level-indexed ancestor's first page (exact for a single-page
 *    container, container-start for a page-spanning one), walked via the optional
 *    `parentOf` lookup; `-1` → broken-ref. Absent `parentOf`, a nested target stays
 *    broken-ref (the top-level-only behavior). On broken-ref the value is the `""`
 *    sentinel and the width covers {@link BROKEN_CROSS_REFERENCE_TEXT} (what actually
 *    renders), so convergence reserves enough room for the error text rather than
 *    under-reserving.
 *
 * Reads `plan.entries.length` and (for `cross-ref-page` specs) `plan.pageSpanOfBlock`;
 * the structural param type keeps test fixtures from having to stub full
 * `PagePlanEntry` objects. Each spec carries its own `computedStyle`, so width
 * measurement needs only a {@link TextMeasurer}.
 */
export function resolvePageFields(
  plan: {
    readonly entries: { readonly length: number };
    pageSpanOfBlock(blockKey: string): { readonly first: number; readonly last: number } | null;
  },
  fieldSpecs: readonly FieldSpec[],
  measurer: TextMeasurer,
  parentOf?: BlockParentLookup,
): ResolvedPageFields {
  const totalPages = plan.entries.length;
  const globalFieldValues = new Map<string, string>();
  const maxValueWidthByKey = new Map<string, number>();

  for (const spec of fieldSpecs) {
    if (spec.fieldType === "page-count") {
      // One value, the same on every page — exact value + width.
      const value = formatCounter(totalPages, spec.numberStyle);
      globalFieldValues.set(spec.embedKey, value);
      maxValueWidthByKey.set(spec.embedKey, measurer.measureWidth(value, spec.computedStyle));
    } else if (spec.fieldType === "cross-ref-page") {
      // Resolve the cross-ref's value to the target's 1-based page. pageOfFieldTarget
      // returns the target's own first page (top-level), the nearest indexed
      // ancestor's first page (nested, via parentOf), or -1 (no indexed ancestor /
      // no parentOf) → broken-ref. (Was: top-level-only pageSpanOfBlock → broken-ref
      // for any nested target; see 2026-06-12 nested-block-page-resolution spec.)
      const page = pageOfFieldTarget(plan, spec.targetId, parentOf);
      if (page < 0) {
        globalFieldValues.set(spec.embedKey, "");
        maxValueWidthByKey.set(
          spec.embedKey,
          measurer.measureWidth(BROKEN_CROSS_REFERENCE_TEXT, spec.computedStyle),
        );
      } else {
        const value = formatCounter(page + 1, spec.numberStyle); // 1-based
        globalFieldValues.set(spec.embedKey, value);
        maxValueWidthByKey.set(spec.embedKey, measurer.measureWidth(value, spec.computedStyle));
      }
    } else {
      // page-number: the value varies 1..totalPages and width is non-monotonic
      // (roman/proportional), so measure every page's value to get a TRUE upper
      // bound — the last page alone would under-estimate. O(totalPages) per
      // page-number template field per build; such fields are rare (0-1 per doc)
      // and this is the same order as the measure pass — memoize by totalPages if a
      // profile ever demands it. No global entry: `substituteLayoutFields` computes
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
