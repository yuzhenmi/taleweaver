/**
 * @module section-page-config
 *
 * Section-level page-geometry resolution (P1.C.2b-2, Task 1).
 *
 * A `section` block may carry page-geometry overrides in its attrs (page size,
 * margins, gap). The section component stamps those attrs into its ElementBox
 * `metadata` (open-schema, possibly `undefined`); this module resolves a
 * section's EFFECTIVE `PageConfig` by validating each override and merging it
 * over the doc-wide config.
 *
 * This is a pure validator/normalizer, NOT a cascade Style interpreter — it
 * reads already-attr-extracted values off the metadata bag and only decides
 * "is this a usable number?". It never throws: section attrs are open-schema,
 * so a malformed value is simply ignored (the doc-wide value wins). If the
 * resulting page content block-size would be non-positive (e.g. margins exceed
 * the page), it falls back to docWide entirely rather than emit an unusable
 * config — mirroring `measurePass`'s existing content-size guard.
 */
import type { LayoutBoxMetadata } from "@taleweaver/core";
import type { PageConfig, PageMargins } from "./page-config";

/** A finite, strictly-positive number (page size dimensions). */
function isPositiveSize(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** A finite, non-negative number (gaps, margins). */
function isNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

const MARGIN_KEYS = ["blockStart", "blockEnd", "inlineStart", "inlineEnd"] as const;

/**
 * Resolve a section's effective `PageConfig` from the doc-wide config plus the
 * section's stamped geometry metadata.
 *
 * Validation rules:
 * - `pageInlineSize`, `pageBlockSize`: accepted only if finite and strictly
 *   positive; otherwise the doc-wide value is kept.
 * - `pageGap`: accepted if finite and `>= 0`.
 * - `pageMargins`: must be an object; each of `blockStart/blockEnd/inlineStart/
 *   inlineEnd` is accepted if finite and `>= 0`, and merged over docWide's.
 *
 * DEFENSIVE: if the resolved page content block-size
 * (`pageBlockSize - blockStart - blockEnd`) would be `<= 0`, the override is
 * unusable, so docWide is returned unchanged.
 */
export function resolveSectionPageConfig(
  docWide: PageConfig,
  sectionMetadata: Readonly<LayoutBoxMetadata> | undefined,
): PageConfig {
  if (sectionMetadata === undefined) {
    return docWide;
  }

  const pageInlineSize = isPositiveSize(sectionMetadata.pageInlineSize)
    ? sectionMetadata.pageInlineSize
    : docWide.pageInlineSize;
  const pageBlockSize = isPositiveSize(sectionMetadata.pageBlockSize)
    ? sectionMetadata.pageBlockSize
    : docWide.pageBlockSize;
  const pageGap = isNonNegative(sectionMetadata.pageGap)
    ? sectionMetadata.pageGap
    : docWide.pageGap;

  // Merge valid margin entries over docWide's. A non-object `pageMargins`
  // contributes nothing (docWide margins survive intact). Build in a mutable
  // record, then assemble the readonly `PageMargins` result below.
  const margins: Record<keyof PageMargins, number> = {
    blockStart: docWide.pageMargins.blockStart,
    blockEnd: docWide.pageMargins.blockEnd,
    inlineStart: docWide.pageMargins.inlineStart,
    inlineEnd: docWide.pageMargins.inlineEnd,
  };
  const rawMargins = sectionMetadata.pageMargins;
  if (typeof rawMargins === "object" && rawMargins !== null) {
    const marginBag = rawMargins as Readonly<Record<string, unknown>>;
    for (const key of MARGIN_KEYS) {
      const value = marginBag[key];
      if (isNonNegative(value)) {
        margins[key] = value;
      }
    }
  }

  // Content-size guard (BOTH axes): an unusable combination falls back to
  // docWide entirely. measurePass / makeVirtualLayoutTree / paginateRoot THROW
  // on a non-positive content block- OR inline-size, so a section whose margins
  // swallow its page must not produce such a config — it falls back instead.
  const contentBlockSize = pageBlockSize - margins.blockStart - margins.blockEnd;
  if (contentBlockSize <= 0) {
    return docWide;
  }
  const contentInlineSize = pageInlineSize - margins.inlineStart - margins.inlineEnd;
  if (contentInlineSize <= 0) {
    return docWide;
  }

  return {
    pageInlineSize,
    pageBlockSize,
    pageGap,
    pageMargins: margins,
  };
}
