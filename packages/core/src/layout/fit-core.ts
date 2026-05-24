// packages/core/src/layout/fit-core.ts
//
// Pure fragmentation-decision core (virtualized-layout Phase 1). The page-break
// decisions that today live inside `bfc.layoutBlock` / `ifc.layoutInlineContent`
// / `table-fc` as a side effect of producing positioned boxes are extracted
// here as PURE functions over per-block metadata. Both real layout (decide →
// position boxes) and the measure pass (decide → boundaries only) call the same
// functions, so page boundaries are computed identically whether or not boxes
// are materialized.
//
// Design: docs/superpowers/specs/2026-05-24-virtualized-layout-design.md
// Plan:   docs/superpowers/plans/2026-05-24-virtualized-layout-phase1.md
//
// SCOPE: float / `clear` documents are NOT modeled here — their break
// decisions are non-local (shared float environment). The measure-pass caller
// detects float/clear and falls back to the legacy full positioned layout.

import type { BreakToken } from "./fragmentation";

/**
 * Per-block fragmentation metadata — the allocation-free inputs the fit-core
 * needs to reproduce every break decision. RECURSIVE: mirrors the block tree.
 * A container block (list, blockquote, nested BFC) carries `children`; a leaf
 * carries either ifc line data (`lineBlockSizes` …) or table row data
 * (`rowBlockSizes`). The recursion is required because a nested container can
 * itself fragment across a page boundary, producing a recursive
 * `BlockBreakToken.resumeChildToken` that a flat top-level model cannot
 * reproduce.
 *
 * Produced from a block's cached intrinsic `BlockBox` (heights are
 * position-independent); cached per block and refreshed only for dirty blocks.
 */
export interface BlockFitMeta {
  readonly kind: "block" | "ifc" | "table";

  /** Margin-block-start / -end (logical), for adjacent-sibling collapse. */
  readonly marginBlockStart: number;
  readonly marginBlockEnd: number;

  /** Normalized break-* values (see `normalizeBreakValue`). */
  readonly breakBefore: "auto" | "page" | "avoid";
  readonly breakAfter: "auto" | "page" | "avoid";
  readonly breakInsideAvoid: boolean;

  /** Unfragmented block-size (height) of the whole block. */
  readonly totalBlockSize: number;

  /** `block` (container): recursive child metas; absent for leaves. */
  readonly children?: readonly BlockFitMeta[];

  /** `ifc` leaf: per-line block-sizes (line heights), in order. */
  readonly lineBlockSizes?: readonly number[];
  /** `ifc` leaf: CSS `orphans` (min lines kept at fragment bottom). */
  readonly orphans?: number;
  /** `ifc` leaf: CSS `widows` (min lines carried to next fragment). */
  readonly widows?: number;
  /**
   * `ifc` leaf: per-line "this line ends mid-hyphenated-pair" flag. The D.4
   * hyphen-pair back-off can move a break a line earlier; reproducing the
   * boundary needs to know which line ends a hyphenated pair.
   */
  readonly lineEndsWithHyphen?: readonly boolean[];

  /** `table` leaf: body row block-sizes, in order. (No thead/header-repeat
   *  feature exists in the engine — do not model one.) */
  readonly rowBlockSizes?: readonly number[];

  /** True when this block is `display: list-item` (ordered-list counter
   *  contribution). `fitOnePage` recurses, so nested list items are seeded
   *  correctly via the recursive walk. */
  readonly listItem?: boolean;
}

/** Result of fitting one page's worth of top-level blocks. */
export interface FitPageResult {
  /** Whole top-level blocks fully consumed on this page (from `startIndex`). */
  readonly childrenCount: number;
  /** Resume state out of this page; `null` ⇒ document end. */
  readonly resumeOut: BreakToken | null;
  /** Ordered-list counter value after this page (seed for the next page). */
  readonly listCounterAtEnd: number;
}

/** Result of fitting lines of one IFC leaf into the remaining page space. */
export interface FitLinesResult {
  /** Lines placed on this fragment (from `startLine`). */
  readonly placedLineCount: number;
  /** 0-based line to resume at on the next fragment; `null` ⇒ all placed. */
  readonly resumeAtLine: number | null;
}

/** Result of fitting body rows of one table leaf into the remaining page space. */
export interface FitRowsResult {
  /** Body rows placed on this fragment (from `startRow`). */
  readonly placedRowCount: number;
  /** 0-based body row to resume at on the next fragment; `null` ⇒ all placed. */
  readonly resumeAtRow: number | null;
}

/**
 * Decide how many lines of an IFC leaf fit in `remainingBlockSize`, honoring
 * orphans / widows / hyphen-pair back-off. Pure port of ifc.ts D.1–D.4. When
 * the result places fewer than all remaining lines but the orphans/widows/
 * hyphen rules force pushing the whole paragraph, `placedLineCount` is 0 and
 * `resumeAtLine === startLine`.
 *
 * `orphans` / `widows` are plain numbers — the CALLER must apply the CSS
 * default of 2 (`meta.orphans ?? 2`, `meta.widows ?? 2`) when reading the
 * optional `BlockFitMeta.orphans` / `.widows`; ifc.ts uses `parentCs.orphans
 * ?? 2`, so passing a raw `undefined`/`0` here would diverge.
 */
export function fitLinesInIFC(
  lineBlockSizes: readonly number[],
  lineEndsWithHyphen: readonly boolean[] | undefined,
  orphans: number,
  widows: number,
  remainingBlockSize: number,
  startLine: number,
): FitLinesResult {
  // Faithful port of ifc.ts:880–996 D.1–D.4. Operates on the suffix
  // lines[startLine..]. "Push the whole paragraph" (nothing placed) is
  // signaled by { placedLineCount: 0, resumeAtLine: startLine }.
  const pushWhole: FitLinesResult = { placedLineCount: 0, resumeAtLine: startLine };

  const suffixLength = Math.max(0, lineBlockSizes.length - startLine);

  // D.1 — greedy fit-loop on the suffix.
  let used = 0;
  let placedLineCount = 0;
  for (let fi = 0; fi < suffixLength; fi++) {
    const lineHeight = lineBlockSizes[startLine + fi];
    if (used + lineHeight > remainingBlockSize) break;
    used += lineHeight;
    placedLineCount++;
  }

  if (placedLineCount === 0) return pushWhole;

  // D.2 — orphans: at least `orphans` lines must remain on this fragment.
  if (placedLineCount < suffixLength && placedLineCount < orphans) return pushWhole;

  // D.3 — widows: at least `widows` lines must carry to the next fragment.
  while (
    placedLineCount > 0 &&
    placedLineCount < suffixLength &&
    suffixLength - placedLineCount < widows
  ) {
    placedLineCount--;
  }
  if (placedLineCount < suffixLength && placedLineCount < orphans) return pushWhole;

  // D.4 — hyphen-pair: a break must not fall between two lines of a
  // hyphenated word. The flag at suffix index (placedLineCount - 1) maps to the
  // absolute line (startLine + placedLineCount - 1).
  while (
    placedLineCount > 0 &&
    placedLineCount < suffixLength &&
    lineEndsWithHyphen?.[startLine + placedLineCount - 1] === true
  ) {
    placedLineCount--;
  }
  if (placedLineCount < suffixLength && placedLineCount < orphans) return pushWhole;

  return {
    placedLineCount,
    resumeAtLine:
      placedLineCount < suffixLength ? startLine + placedLineCount : null,
  };
}

/**
 * Decide how many body rows of a table leaf fit in `remainingBlockSize`. Pure
 * port of table-fc's row fit loop. No header-repeat (the engine has none).
 */
export function fitRowsInTable(
  rowBlockSizes: readonly number[],
  remainingBlockSize: number,
  startRow: number,
): FitRowsResult {
  // Faithful port of table-fc.ts:374–408 E.1 row fit-check, on the suffix
  // rows[startRow..]. No orphans/widows/header. "Nothing fits" ⇒
  // { placedRowCount: 0, resumeAtRow: startRow }.
  const suffixLength = Math.max(0, rowBlockSizes.length - startRow);

  let used = 0;
  let placedRowCount = 0;
  for (let ri = 0; ri < suffixLength; ri++) {
    const rowHeight = rowBlockSizes[startRow + ri];
    if (used + rowHeight > remainingBlockSize) break;
    used += rowHeight;
    placedRowCount++;
  }

  if (placedRowCount === 0) return { placedRowCount: 0, resumeAtRow: startRow };

  return {
    placedRowCount,
    resumeAtRow:
      placedRowCount < suffixLength ? startRow + placedRowCount : null,
  };
}

/**
 * Decide one page's content: walk top-level block metas from `startIndex`,
 * accumulating the running in-page block offset (collapsed margins + §5.4
 * first-on-fragment truncation), honoring break-before/after/inside and the
 * §C.6 overflow rule, recursing into container children and delegating
 * ifc/table leaves to `fitLinesInIFC` / `fitRowsInTable`. Pure port of
 * bfc.layoutBlock's fragmentation-aware decision logic — positions no boxes.
 */
export function fitOnePage(
  metas: readonly BlockFitMeta[],
  startIndex: number,
  resumeInto: BreakToken | null,
  pageContentBlockSize: number,
  listCounterAtStart: number,
): FitPageResult {
  // Mirror of bfc.layoutBlock's fragmentation-aware decision logic
  // (bfc.ts:240–745). Decides one page's content over the top-level block
  // metas, positioning no boxes. `pageContentBlockSize` is the FULL available
  // block-size on this fragment (== bfc's `fragmentation.availableBlockSize`);
  // bfc reduces it per-child by subtracting `childBlockOffset`, so the IFC /
  // table / recursive container fits use `remaining = pageContentBlockSize −
  // runningOffset`, matching bfc.ts:350 / 540 / 627.
  return fitOnePageRecursive(
    metas,
    startIndex,
    resumeInto,
    pageContentBlockSize,
    listCounterAtStart,
  );
}

/**
 * Recursive engine for `fitOnePage`. The first child placed on every fragment
 * has its top margin truncated to 0 by the CSS Fragmentation §5.4 rule
 * (bfc.ts:466–468), which fires for both the document-root flow AND every
 * recursed container. This is the only first-on-fragment margin rule the
 * measure pass needs: in the paginated path the §5.4 truncation runs BEFORE
 * bfc's `noTopBoundary` first-child suppression (bfc.ts:483), so the latter is
 * always a no-op here (it would zero an already-zeroed margin). We therefore do
 * not model `noTopBoundary` at all.
 */
function fitOnePageRecursive(
  metas: readonly BlockFitMeta[],
  startIndex: number,
  resumeInto: BreakToken | null,
  availableBlockSize: number,
  listCounterAtStart: number,
): FitPageResult {
  // --- Resume-token parse (bfc.ts:244–263). ---
  // A "block" token gives the resume child index + that child's inner token.
  // An "ifc"/"table" token means THIS flow's first child (a leaf) is being
  // resumed mid-fragment; bfc threads it into the leaf as `firstChildResumeToken`.
  let effectiveStartIndex = startIndex;
  let firstChildResumeToken: BreakToken | null = null;
  if (resumeInto !== null) {
    if (resumeInto.type === "block") {
      effectiveStartIndex = resumeInto.resumeChildIndex;
      firstChildResumeToken = resumeInto.resumeChildToken;
    } else {
      // ifc / table token: the leaf at `startIndex` resumes from it.
      firstChildResumeToken = resumeInto;
    }
  }

  // --- List-counter seed for skipped children (bfc.ts:268–278). ---
  // List numbering does NOT influence break boundaries; it is accumulated only
  // to pass through `listCounterAtEnd`.
  let listCounter = listCounterAtStart;
  for (let i = startIndex; i < effectiveStartIndex; i++) {
    listCounter = accumulateListCounter(metas[i], listCounter);
  }

  let runningOffset = 0;
  let childrenCount = 0; // whole blocks fully consumed on this page
  let prevMarginBlockEnd = 0;

  for (let i = effectiveStartIndex; i < metas.length; i++) {
    const meta = metas[i];
    const fragmentHasContent = childrenCount > 0;

    // §5.4 first-on-fragment top-margin truncation (bfc.ts:466–468): the first
    // child placed on a fresh fragment has its top margin truncated to 0.
    let childMarginBlockStart = meta.marginBlockStart;
    if (!fragmentHasContent) {
      childMarginBlockStart = 0;
    }

    // Advance the running offset by the collapsed/truncated margin
    // (bfc.ts:480–484). No clearance (floats out of scope). The first child of
    // a fragment already had `childMarginBlockStart` truncated to 0 by §5.4
    // above, so its advance is 0 regardless of the flow's top boundary.
    if (fragmentHasContent) {
      runningOffset += Math.max(prevMarginBlockEnd, childMarginBlockStart);
    } else {
      runningOffset += childMarginBlockStart;
    }

    // List-item counter contribution (bfc.ts:487–488). Counted before the
    // break-before check so the seed is correct even if we break here.
    listCounter = accumulateListCounter(meta, listCounter);

    // --- break-before:page (bfc.ts:517–527). ---
    // Only fires when the fragment already has content; a forced break cannot
    // occur before the first piece of content on a fragment.
    if (meta.breakBefore === "page" && fragmentHasContent) {
      return {
        childrenCount,
        resumeOut: { type: "block", resumeChildIndex: i, resumeChildToken: null },
        // Roll back the list contribution we just counted — this child is NOT
        // consumed on this page; its counter belongs to the next page's seed.
        listCounterAtEnd: meta.listItem ? listCounter - 1 : listCounter,
      };
    }

    // --- Per-child fit. ---
    // `remaining` mirrors bfc's child `availableBlockSize`
    // (`fragmentation.availableBlockSize − childBlockOffset`, bfc.ts:540/627).
    const remaining = availableBlockSize - runningOffset;
    const leafResumeToken = i === effectiveStartIndex ? firstChildResumeToken : null;

    if (meta.kind === "ifc") {
      // An ifc-leaf meta models a PARAGRAPH block whose inline content forms a
      // single anonymous IFC group at the paragraph's child index 0 (bfc.ts:320
      // synthesizes that anonymous block). So the paragraph's own break token is
      // `{block, resumeChildIndex:0, resumeChildToken:{ifc, resumeAtLine}}`, and
      // the resume token THIS flow threads in (`leafResumeToken`) is that
      // paragraph-level block token — one level deeper than a bare IFC token.
      const lineSizes = meta.lineBlockSizes ?? [];
      const startLine = ifcResumeAtLineFromParagraphToken(leafResumeToken);
      const fit = fitLinesInIFC(
        lineSizes,
        meta.lineEndsWithHyphen,
        meta.orphans ?? 2,
        meta.widows ?? 2,
        remaining,
        startLine,
      );
      const fragments = fit.placedLineCount === 0 || fit.resumeAtLine !== null;

      // break-inside:avoid on a paragraph that would fragment: bfc.ts:645–665
      // applies the SAME rule a fragmenting container gets — discard the partial,
      // push the WHOLE remainder to the next fragment; or §C.6 overflow-consume-
      // whole when first-on-fragment. The IFC line-fit is bypassed entirely.
      if (fragments && meta.breakInsideAvoid) {
        if (!fragmentHasContent) {
          // §C.6 overflow-consume-whole for a break-inside:avoid paragraph that
          // is first-on-fragment and too tall.
          //
          // UNREACHABLE when resuming (startLine > 0): a break-inside:avoid
          // paragraph is never split, so it never produces a resume token —
          // `leafResumeToken` for it is always null and `startLine` is always 0.
          // In that (only reachable) case `remainingIfcBlockSize(.., 0)` equals
          // the full `totalBlockSize`, matching bfc's `applyOverflowRule`
          // re-laying the WHOLE paragraph. Were a future change to make a
          // break-inside:avoid paragraph resumable (startLine > 0), this would
          // diverge — the suffix-only height here vs. bfc re-laying the whole
          // block — and this branch MUST be revisited then.
          runningOffset += remainingIfcBlockSize(lineSizes, startLine);
          prevMarginBlockEnd = meta.marginBlockEnd;
          childrenCount++;
          const afterBreak = checkBreakAfter(meta, i, metas.length, childrenCount, listCounter);
          if (afterBreak !== null) return afterBreak;
          continue;
        }
        return {
          childrenCount,
          resumeOut: { type: "block", resumeChildIndex: i, resumeChildToken: null },
          listCounterAtEnd: meta.listItem ? listCounter - 1 : listCounter,
        };
      }

      if (fit.placedLineCount === 0) {
        // IFC couldn't place anything (bfc.ts:356–364). §C.6: if first on the
        // fragment, consume whole (overflow); else break here.
        if (!fragmentHasContent) {
          // Overflow-consume-whole: place the remaining (from startLine) lines.
          runningOffset += remainingIfcBlockSize(lineSizes, startLine);
          prevMarginBlockEnd = meta.marginBlockEnd;
          childrenCount++;
          // break-after still applies after a consumed block.
          const afterBreak = checkBreakAfter(meta, i, metas.length, childrenCount, listCounter);
          if (afterBreak !== null) return afterBreak;
          continue;
        }
        return {
          childrenCount,
          resumeOut: { type: "block", resumeChildIndex: i, resumeChildToken: paragraphIfcToken(startLine) },
          listCounterAtEnd: meta.listItem ? listCounter - 1 : listCounter,
        };
      }
      if (fit.resumeAtLine !== null) {
        // Partial IFC fit → this child is the last on the page (bfc.ts:376–382).
        return {
          childrenCount,
          resumeOut: { type: "block", resumeChildIndex: i, resumeChildToken: paragraphIfcToken(fit.resumeAtLine) },
          listCounterAtEnd: listCounter,
        };
      }
      // All remaining lines fit. Advance by the consumed line heights.
      let used = 0;
      for (let li = startLine; li < startLine + fit.placedLineCount; li++) used += lineSizes[li];
      runningOffset += used;
      prevMarginBlockEnd = meta.marginBlockEnd;
      childrenCount++;
      const afterBreak = checkBreakAfter(meta, i, metas.length, childrenCount, listCounter);
      if (afterBreak !== null) return afterBreak;
      continue;
    }

    if (meta.kind === "table") {
      const rowSizes = meta.rowBlockSizes ?? [];
      const startRow =
        leafResumeToken !== null && leafResumeToken.type === "table"
          ? leafResumeToken.resumeAtRow
          : 0;
      const fit = fitRowsInTable(rowSizes, remaining, startRow);
      if (fit.placedRowCount === 0) {
        // Table couldn't place a row (bfc.ts:573–588). §C.6 overflow if first.
        if (!fragmentHasContent) {
          runningOffset += meta.totalBlockSize;
          prevMarginBlockEnd = meta.marginBlockEnd;
          childrenCount++;
          const afterBreak = checkBreakAfter(meta, i, metas.length, childrenCount, listCounter);
          if (afterBreak !== null) return afterBreak;
          continue;
        }
        return {
          childrenCount,
          resumeOut: { type: "block", resumeChildIndex: i, resumeChildToken: { type: "table", resumeAtRow: startRow } },
          listCounterAtEnd: meta.listItem ? listCounter - 1 : listCounter,
        };
      }
      if (fit.resumeAtRow !== null) {
        return {
          childrenCount,
          resumeOut: { type: "block", resumeChildIndex: i, resumeChildToken: { type: "table", resumeAtRow: fit.resumeAtRow } },
          listCounterAtEnd: listCounter,
        };
      }
      let used = 0;
      for (let ri = startRow; ri < startRow + fit.placedRowCount; ri++) used += rowSizes[ri];
      runningOffset += used;
      prevMarginBlockEnd = meta.marginBlockEnd;
      childrenCount++;
      const afterBreak = checkBreakAfter(meta, i, metas.length, childrenCount, listCounter);
      if (afterBreak !== null) return afterBreak;
      continue;
    }

    // --- Container block (kind:"block" with children) → RECURSE. ---
    // Mirror bfc.ts:536–543 (child fragmentation threading: the recursed
    // container gets the reduced `remaining` and the resume token only on the
    // first iteration) + 593–673 (nested token build + break-inside/§C.6).
    const childResume =
      leafResumeToken !== null && leafResumeToken.type === "block" ? leafResumeToken : null;
    const childChildren = meta.children ?? [];
    // The recursion relies on the §5.4 truncation (which always zeroes the first
    // child of a fresh fragment) for the page-break-relevant first-child margin
    // case — matching bfc, which truncates the first child of every fragment
    // regardless of the container's own top boundary.
    const childResult = fitOnePageRecursive(
      childChildren,
      0,
      childResume,
      remaining,
      listCounter,
    );

    // Determine the container's consumed height on this page. When the
    // container fragmented (resumeOut !== null) it consumed exactly `remaining`
    // (it filled to the page bottom); when it fit fully, it consumed its
    // totalBlockSize.
    if (childResult.resumeOut !== null) {
      // Container fragmented across the page boundary. bfc.ts:645–673:
      // break-inside:avoid → discard partial, push whole (or §C.6 overflow if
      // first-on-fragment); otherwise the container is the last on the page.
      if (meta.breakInsideAvoid) {
        if (!fragmentHasContent) {
          // §C.6 overflow-consume-whole (bfc.ts:653–658).
          runningOffset += meta.totalBlockSize;
          prevMarginBlockEnd = meta.marginBlockEnd;
          childrenCount++;
          listCounter = childResult.listCounterAtEnd;
          const afterBreak = checkBreakAfter(meta, i, metas.length, childrenCount, listCounter);
          if (afterBreak !== null) return afterBreak;
          continue;
        }
        return {
          childrenCount,
          resumeOut: { type: "block", resumeChildIndex: i, resumeChildToken: null },
          listCounterAtEnd: meta.listItem ? listCounter - 1 : listCounter,
        };
      }
      // Container is the last block on this page; thread its nested resume.
      // Its list contribution counts (the items it placed are consumed).
      return {
        childrenCount,
        resumeOut: {
          type: "block",
          resumeChildIndex: i,
          resumeChildToken: {
            type: "block",
            resumeChildIndex:
              childResult.resumeOut.type === "block" ? childResult.resumeOut.resumeChildIndex : 0,
            resumeChildToken:
              childResult.resumeOut.type === "block" ? childResult.resumeOut.resumeChildToken : childResult.resumeOut,
          },
        },
        listCounterAtEnd: childResult.listCounterAtEnd,
      };
    }

    // Container fit fully. Whole-block fit check (bfc.ts:626–642).
    if (meta.totalBlockSize > remaining) {
      // §C.6: first-on-fragment too-tall → consume whole + overflow.
      if (!fragmentHasContent) {
        runningOffset += meta.totalBlockSize;
        prevMarginBlockEnd = meta.marginBlockEnd;
        childrenCount++;
        listCounter = childResult.listCounterAtEnd;
        const afterBreak = checkBreakAfter(meta, i, metas.length, childrenCount, listCounter);
        if (afterBreak !== null) return afterBreak;
        continue;
      }
      return {
        childrenCount,
        resumeOut: { type: "block", resumeChildIndex: i, resumeChildToken: null },
        listCounterAtEnd: meta.listItem ? listCounter - 1 : listCounter,
      };
    }

    // Fits fully.
    runningOffset += meta.totalBlockSize;
    prevMarginBlockEnd = meta.marginBlockEnd;
    childrenCount++;
    listCounter = childResult.listCounterAtEnd;
    const afterBreak = checkBreakAfter(meta, i, metas.length, childrenCount, listCounter);
    if (afterBreak !== null) return afterBreak;
  }

  // All blocks consumed — document (or container) end.
  return { childrenCount, resumeOut: null, listCounterAtEnd: listCounter };
}

/**
 * Block-axis size of an ifc-leaf's lines from `startLine` to the end — the
 * height consumed when the paragraph is overflow-consumed-whole (§C.6) or
 * pushed whole (break-inside:avoid). Mirrors bfc's `applyOverflowRule`
 * re-laying the block unfragmented (it places every remaining line).
 */
function remainingIfcBlockSize(lineSizes: readonly number[], startLine: number): number {
  let total = 0;
  for (let i = startLine; i < lineSizes.length; i++) total += lineSizes[i];
  return total;
}

/**
 * Build the block-break token a fragmenting PARAGRAPH (ifc-leaf) emits. The
 * paragraph's inline content is a single anonymous IFC group at the paragraph's
 * child index 0 (bfc.ts:320), so the paragraph-level break token is
 * `{block, resumeChildIndex:0, resumeChildToken:{ifc, resumeAtLine}}`. The
 * caller wraps THIS in the flow-level `{block, resumeChildIndex:i, …}`.
 */
function paragraphIfcToken(resumeAtLine: number): BreakToken {
  return {
    type: "block",
    resumeChildIndex: 0,
    resumeChildToken: { type: "ifc", resumeAtLine },
  };
}

/**
 * Extract the IFC resume line from the paragraph-level block token a resumed
 * ifc-leaf is threaded (the inverse of `paragraphIfcToken`). Tolerates a bare
 * `{ifc}` token too (defensive). Returns 0 when there is no resume state.
 */
function ifcResumeAtLineFromParagraphToken(token: BreakToken | null): number {
  if (token === null) return 0;
  if (token.type === "ifc") return token.resumeAtLine;
  if (token.type === "block" && token.resumeChildToken?.type === "ifc") {
    return token.resumeChildToken.resumeAtLine;
  }
  return 0;
}

/**
 * Recursively accumulate the ordered-list counter contribution of `meta`:
 * +1 if it is a `list-item`, plus the contribution of every descendant
 * list-item (a container's nested list items, walked in order). Mirrors the
 * effect of bfc's per-level `listCounter` increment as the walk recurses.
 */
function accumulateListCounter(meta: BlockFitMeta, counter: number): number {
  let next = counter;
  if (meta.listItem === true) next++;
  if (meta.children !== undefined) {
    for (const child of meta.children) next = accumulateListCounter(child, next);
  }
  return next;
}

/**
 * break-after:page handling (bfc.ts:711–724). Only fires when more children
 * remain in this flow. Returns a FitPageResult to STOP the page, or null to
 * continue. `childrenCount` already includes the just-consumed child.
 */
function checkBreakAfter(
  meta: BlockFitMeta,
  index: number,
  total: number,
  childrenCount: number,
  listCounter: number,
): FitPageResult | null {
  if (meta.breakAfter !== "page") return null;
  const hasMoreChildren = index + 1 < total;
  if (!hasMoreChildren) return null;
  return {
    childrenCount,
    resumeOut: { type: "block", resumeChildIndex: index + 1, resumeChildToken: null },
    listCounterAtEnd: listCounter,
  };
}
