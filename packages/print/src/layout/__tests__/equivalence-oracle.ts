// packages/core/src/layout/__tests__/equivalence-oracle.ts
//
// THE SHARED ORACLE for the virtualized-layout equivalence tests. For each
// fixture it runs the REAL paginated layout (`layoutBlock`, driven page-by-page
// the way `paginateRoot` itself drives it) and extracts the per-page boundary
// facts — children-count, page blockOffset, and the break-token chain. The
// measure-pass equivalence tests assert their `measurePass` plan matches this
// ground truth EXACTLY. Real layout is ground truth: if the pure fit-core (or the
// VL float fast-path's `floatPageMeasurer`) diverges, the test fails.
//
// Extracted from `measure-pass-equivalence.test.ts` (VL float fast-path Task 6
// PR1-5) so BOTH the no-float measure equivalence test AND the float
// virtualization equivalence test share the identical oracle.

import { layoutBlock } from "../bfc";
import { makeRootContext } from "../layout-context";
import type { LayoutContext } from "../layout-context";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";
import { createMockShaper } from "@taleweaver/core";
import type { Hyphenator } from "@taleweaver/core";
import type { ElementBox } from "@taleweaver/core";
import type { BreakToken, FragmentationContext } from "../fragmentation";
import type { PageConfig } from "../page-config";

/** Narrowing array access: throws on a missing index instead of returning `undefined`. */
export function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

export interface OraclePage {
  readonly pageIndex: number;
  readonly blockOffset: number;
  /** First top-level child index on this page. */
  readonly startIndex: number;
  /** Resume token INTO this page. */
  readonly resumeInto: BreakToken | null;
  /** Resume token OUT of this page (the layoutBlock breakToken). */
  readonly resumeOut: BreakToken | null;
  /**
   * Children fully/partially counted on this page, per paginateRoot's
   * fingerprint slice: [startIndex, nextStartIndex) where nextStartIndex is
   * breakToken.resumeChildIndex (or root.children.length when no break).
   */
  readonly childrenCount: number;
}

/**
 * Drive the real layout page-by-page (mirror of paginateRoot's loop) and capture
 * per-page boundary facts. Threads the document-cumulative `pageFlowBase` into
 * `layoutBlock` EXACTLY like production `paginateRoot` does — so float exclusion
 * geometry + IFC `paraFlowStart` stamps are document-cumulative, the only correct
 * reference for both the real paginator and `measurePass`.
 */
export function runOracle(
  root: ElementBox,
  shaper: ReturnType<typeof createMockShaper>,
  pageConfig: PageConfig,
  hyphenator?: Hyphenator,
): { pages: OraclePage[]; totalBlockSize: number } {
  const margins = pageConfig.pageMargins;
  const pageContentBlockSize =
    pageConfig.pageBlockSize - margins.blockStart - margins.blockEnd;
  const pageContentInlineSize =
    pageConfig.pageInlineSize - margins.inlineStart - margins.inlineEnd;
  const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, pageConfig.pageInlineSize);
  const contentCtx: LayoutContext = { ...ctx, containingInlineSize: pageContentInlineSize };

  const pages: OraclePage[] = [];
  let resumeFrom: BreakToken | null = null;
  let startIndex = 0;
  let pageIndex = 0;
  let pageFlowBase = 0;

  for (;;) {
    const fragmentation: FragmentationContext = {
      availableBlockSize: pageContentBlockSize,
      pageIndex,
      resumeFrom,
    };
    const { box, breakToken, inFlowConsumed } = layoutBlock(
      root,
      margins.inlineStart,
      margins.blockStart,
      contentCtx,
      shaper,
      hyphenator,
      fragmentation,
      pageFlowBase,
    );
    const blockOffset = pageIndex * (pageConfig.pageBlockSize + pageConfig.pageGap);
    const nextStartIndex =
      breakToken === null
        ? root.children.length
        : breakToken.type === "block"
          ? breakToken.resumeChildIndex
          : startIndex;
    pages.push({
      pageIndex,
      blockOffset,
      startIndex,
      resumeInto: resumeFrom,
      resumeOut: breakToken,
      childrenCount: nextStartIndex - startIndex,
    });
    pageFlowBase += box !== null ? inFlowConsumed : 0;
    if (breakToken === null) {
      pageIndex++;
      break;
    }
    if (breakToken.type === "block") startIndex = breakToken.resumeChildIndex;
    resumeFrom = breakToken;
    pageIndex++;
  }

  const pageCount = pageIndex;
  const totalBlockSize =
    pageCount * pageConfig.pageBlockSize + Math.max(0, pageCount - 1) * pageConfig.pageGap;
  return { pages, totalBlockSize };
}
