// packages/core/src/layout/fit-core.ts
//
// Pure fragmentation-decision core (virtualized layout). The page-break
// decisions that today live inside `bfc.layoutBlock` / `ifc.layoutInlineContent`
// / `table-fc` as a side effect of producing positioned boxes are extracted
// here as PURE functions over per-block metadata. Both real layout (decide →
// position boxes) and the measure pass (decide → boundaries only) call the same
// functions, so page boundaries are computed identically whether or not boxes
// are materialized.
//
// SCOPE: float / `clear` documents are NOT modeled here — their break
// decisions are non-local (shared float environment). The measure-pass caller
// detects float/clear and falls back to the legacy full positioned layout.

import type { BreakToken } from "./fragmentation";
import { isResumeFromDegenerate } from "./fragmentation";
import { NO_RESERVE, lastChildReserve, reserveTotal } from "./complete-reserve";
import type { CompleteReserve } from "./complete-reserve";

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

  /**
   * `block` container and PARAGRAPH `ifc` leaf: the box's block-start border +
   * padding (CSS 2.1 §8). bfc starts its content there (`childBlockOffset`
   * starts at `contentBlockStart`), so the content's available block-size on
   * the box's FIRST fragment is `remaining − blockStartDecoration`; a
   * continuation fragment slices it off (`box-decoration-break: slice`). Absent
   * (0) for anonymous runs, tables and undecorated boxes.
   */
  readonly blockStartDecoration?: number;

  /**
   * `block` container and PARAGRAPH `ifc` leaf: the box's block-end padding +
   * border. Only the box's LAST fragment carries it (a non-final fragment slices
   * it off), so it never reduces the content's fragmentation space; it can still
   * push a last fragment past `remaining` (bfc's whole-block fit check). It also
   * bounds the trailing child margin (no end decoration ⇒ the margin collapses
   * through). Absent (0) for anonymous runs, tables and undecorated boxes.
   */
  readonly blockEndDecoration?: number;

  /**
   * `ifc` leaf only: distinguishes the TWO IFC-leaf shapes, which differ in the
   * break-token nesting bfc emits.
   *   - PARAGRAPH leaf (a block child whose own content is a single inline run):
   *     the inline content is an anonymous IFC block at the paragraph's OWN
   *     child index 0, so its break token is `{block i, {block 0, {ifc, L}}}`
   *     (the flow wraps the paragraph, the paragraph wraps its anon-IFC).
   *   - ANONYMOUS inline-run leaf (a bare inline run grouped directly inside a
   *     mixed container): the run IS the group at flow index i, so its break
   *     token is `{block i, {ifc, L}}` — the IFC token is the container's direct
   *     `resumeChildToken`, with NO intermediate paragraph layer.
   * `true` ⇒ anonymous inline-run leaf; `undefined`/`false` ⇒ paragraph leaf.
   */
  readonly anonymousInlineRun?: boolean;

  /** `ifc` leaf: per-line block-sizes (line heights), in order. */
  readonly lineBlockSizes?: readonly number[];
  /** `ifc` leaf: CSS `orphans` (min lines kept at fragment bottom). */
  readonly orphans?: number;
  /** `ifc` leaf: CSS `widows` (min lines carried to next fragment). */
  readonly widows?: number;
  /**
   * `ifc` leaf: per-line "this line ends mid-hyphenated-pair" flag. The
   * hyphen-pair back-off can move a break one or more lines earlier (it keeps
   * stepping back while the preceding line ends mid-hyphenated-pair), so the
   * fit needs to know which lines end mid-hyphenated-pair.
   */
  readonly lineEndsWithHyphen?: readonly boolean[];

  /** `table` leaf: per-row block-sizes, in order, covering ALL rows
   *  `[0, rowCount)` — header rows INCLUDED (the from-row-0 unfragmented layout in
   *  `buildBlockFitMetas` populates every row). The header-repeat feature reserves
   *  the first `headerRowCount` rows on every continuation fragment; see
   *  `headerRowCount` / `headerBlockSize` below. */
  readonly rowBlockSizes?: readonly number[];

  /** `table` leaf: number of leading rows `[0, headerRowCount)` that repeat at the
   *  top of every page/column continuation fragment (Google-Docs "pin header
   *  rows"). Absent / 0 ⇒ no header repetition (byte-identical to the pre-header
   *  behavior on every path). */
  readonly headerRowCount?: number;

  /** `table` leaf: the reserved block-size of the repeating header — the prefix
   *  sum `Σ rowBlockSizes[0, headerRowCount)`. Both the measure pass and the
   *  materialize pass read THIS value (the single source of truth of the
   *  header-repetition design) so a continuation fragment reserves and emits the
   *  identical header height. Absent / 0 when `headerRowCount` is absent / 0. */
  readonly headerBlockSize?: number;

  /**
   * bfc's empty-block rule (CSS 2.1 §8.3.1, `isCollapseThroughEmpty`): no
   * content height, padding, border or explicit size — its margins collapse
   * together and it takes no block space. Absent ⇒ false.
   */
  readonly collapseThrough?: boolean;

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
  /**
   * In-flow block-size consumed by this flow on this page — the recursion's
   * `runningOffset` at the moment it returned. A PARENT container reads this to
   * reconstruct the bfc height of a child container's fragment (partial:
   * `blockStartDecoration + consumedBlockSize`; a resumed container's last:
   * `consumedBlockSize + trailingMarginBlockEnd + blockEndDecoration`), so it can
   * run the same whole-block-fit / overflow check bfc does. Does NOT
   * include the flow's own border / padding (the flow models a container's
   * *children*; the parent adds the container's decoration).
   */
  readonly consumedBlockSize: number;
  /**
   * Bottom margin of the last in-flow child placed on this page (`prevMarginBlockEnd`
   * at return). Folded into a resumed container's last-fragment height when the
   * container's end decoration stops it collapsing through (bfc
   * `noBottomBoundary ? 0 : prevMarginBlockEnd`).
   */
  readonly trailingMarginBlockEnd: number;
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
 * orphans / widows / hyphen-pair back-off. Pure port of the IFC's line-fit loop. When
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
  // Faithful port of the IFC's line-fit loop (orphans/widows/break-inside). Operates on the suffix
  // lines[startLine..]. "Push the whole paragraph" (nothing placed) is
  // signaled by { placedLineCount: 0, resumeAtLine: startLine }.
  const pushWhole: FitLinesResult = { placedLineCount: 0, resumeAtLine: startLine };

  const suffixLength = Math.max(0, lineBlockSizes.length - startLine);

  // Greedy fit-loop on the suffix.
  let used = 0;
  let placedLineCount = 0;
  for (let fi = 0; fi < suffixLength; fi++) {
    const lineHeight = lineBlockSizes[startLine + fi];
    if (lineHeight === undefined) {
      throw new Error(`fit-core: line ${startLine + fi} missing (unreachable, fi < suffixLength)`);
    }
    if (used + lineHeight > remainingBlockSize) break;
    used += lineHeight;
    placedLineCount++;
  }

  if (placedLineCount === 0) return pushWhole;

  // Orphans: at least `orphans` lines must remain on this fragment.
  if (placedLineCount < suffixLength && placedLineCount < orphans) return pushWhole;

  // Widows: at least `widows` lines must carry to the next fragment.
  while (
    placedLineCount > 0 &&
    placedLineCount < suffixLength &&
    suffixLength - placedLineCount < widows
  ) {
    placedLineCount--;
  }
  if (placedLineCount < suffixLength && placedLineCount < orphans) return pushWhole;

  // Hyphen-pair: a break must not fall between two lines of a
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
 * port of table-fc's row fit loop, extended with the repeating-header
 * reservation.
 *
 * The header reservation is owned by the CALLEE (this function), NOT
 * pre-subtracted by the caller: it fits the suffix rows `[startRow, rowCount)`
 * into `remainingBlockSize − headerBlockSize` (the repeated header eats the top
 * of every continuation fragment). The callee owns the subtraction precisely so
 * the PROGRESS floor can distinguish "zero rows fit because the header ate the
 * space" from a default-path zero — only here, where `headerBlockSize` and
 * `forceProgress` are known, can that call be made.
 *
 * `forceProgress` is `headerRowCount > 0 && startRow > 0` (a header-reserved
 * continuation). When it is true and the reduced remaining admits ZERO body
 * rows, exactly ONE body row is force-placed (overflowing the fragment) so
 * `resumeAtRow` strictly advances every fragment — the progress anti-hang
 * floor that overrides the overflow-rule whole-suffix dump.
 *
 * When `forceProgress` is false (`startRow === 0` OR `headerBlockSize === 0`)
 * the function is byte-identical to the pre-header behavior: subtract −0 and
 * never force. "Nothing fits" ⇒ `{ placedRowCount: 0, resumeAtRow: startRow }`.
 */
export function fitRowsInTable(
  rowBlockSizes: readonly number[],
  remainingBlockSize: number,
  startRow: number,
  headerBlockSize = 0,
  forceProgress = false,
): FitRowsResult {
  // The repeated header reserves the top of the fragment; body rows fit into
  // what remains. `headerBlockSize === 0` ⇒ reducedRemaining === remaining ⇒
  // byte-identical to the pre-header behavior.
  const reducedRemaining = remainingBlockSize - headerBlockSize;
  const suffixLength = Math.max(0, rowBlockSizes.length - startRow);

  let used = 0;
  let placedRowCount = 0;
  for (let ri = 0; ri < suffixLength; ri++) {
    const rowHeight = rowBlockSizes[startRow + ri];
    if (rowHeight === undefined) {
      throw new Error(`fit-core: row ${startRow + ri} missing (unreachable, ri < suffixLength)`);
    }
    if (used + rowHeight > reducedRemaining) break;
    used += rowHeight;
    placedRowCount++;
  }

  if (placedRowCount === 0) {
    // Progress floor: on a header-reserved continuation, force exactly one
    // body row so the resume index strictly advances (no whole-suffix overflow-rule dump,
    // no hang). The forced row overflows the fragment; that is accepted.
    if (forceProgress && suffixLength > 0) {
      return {
        placedRowCount: 1,
        resumeAtRow: suffixLength > 1 ? startRow + 1 : null,
      };
    }
    return { placedRowCount: 0, resumeAtRow: startRow };
  }

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
 * overflow rule, recursing into container children and delegating
 * ifc/table leaves to `fitLinesInIFC` / `fitRowsInTable`. Pure port of
 * bfc.layoutBlock's fragmentation-aware decision logic — positions no boxes.
 */
export function fitOnePage(
  metas: readonly BlockFitMeta[],
  startIndex: number,
  resumeInto: BreakToken | null,
  pageContentBlockSize: number,
  listCounterAtStart: number,
  stopBeforeIndex?: number,
  // Coherent float+pagination: the page-CUMULATIVE document-flow offset of this
  // page's content top (gapless Σ in-flow content consumed on prior pages — the
  // measure pass's analog of paginate's `pageFlowBase`). Threaded as the
  // top-level `contentFlowBase` so the IFC `paraFlowStart` stamp is cumulative,
  // matching bfc's stamp field-for-field (measure↔materialize token agreement).
  // Defaults to 0 (single-page / non-paginated callers): byte-identical to today.
  pageFlowBase = 0,
): FitPageResult {
  // Mirror of bfc.layoutBlock's fragmentation-aware decision logic
  // (bfc.ts:240–745). Decides one page's content over the top-level block
  // metas, positioning no boxes. `pageContentBlockSize` is the FULL available
  // block-size on this fragment (== bfc's `fragmentation.availableBlockSize`);
  // bfc reduces it per-child by subtracting `childBlockOffset`, so the IFC /
  // table / recursive container fits use `remaining = pageContentBlockSize −
  // runningOffset`, matching bfc.ts:350 / 540 / 627.
  //
  // Section cap: `stopBeforeIndex` is an EXCLUSIVE upper bound on
  // the TOP-LEVEL child index this page may place — the page may place
  // `[startIndex, stopBeforeIndex)`. It forces a page break before the boundary
  // child exactly as if that child had break-before:page (the section-page-break
  // mechanism). Normalize here before delegating: the cap is ACTIVE only when it
  // is present AND strictly greater than `startIndex`; otherwise (omitted / null
  // / `<= startIndex`) there is NO cap (pass `undefined` down). A `<= startIndex` cap would mean "place nothing", which
  // must never happen — the measure-pass caller only passes a boundary strictly
  // greater than startIndex; normalizing to no-cap is the defensive guard.
  const normalizedStopBeforeIndex =
    stopBeforeIndex !== undefined &&
    stopBeforeIndex !== null &&
    stopBeforeIndex > startIndex
      ? stopBeforeIndex
      : undefined;
  return fitOnePageRecursive(
    metas,
    startIndex,
    resumeInto,
    pageContentBlockSize,
    listCounterAtStart,
    normalizedStopBeforeIndex,
    // Seed the recursion's cumulative content-box base with the page-cumulative
    // flow offset (0 for a single-page caller; the running gapless sum from the
    // measure pass for a paginated one).
    pageFlowBase,
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
  stopBeforeIndex?: number,
  // Coherent float+pagination: this flow's content-box CUMULATIVE document-flow
  // offset — the cumulative position of this flow's `runningOffset === 0` origin.
  // A child's `paraFlowStart` is `contentFlowBase + runningOffset` (+ the child's
  // own padding for a paragraph leaf), matching bfc's cumulative
  // `paraFlowStart = blockFlowBase + childBlockOffset`. The TOP-LEVEL call is
  // seeded with the page-cumulative `pageFlowBase` (gapless Σ prior pages'
  // in-flow content) supplied by the measure pass — bfc's `blockFlowBase` at the
  // page root is exactly `pageFlowBase + 0`. Nested container calls pass
  // `contentFlowBase + runningOffset + blockStartDecoration` (accumulating through
  // ancestors), mirroring bfc's per-container `blockFlowBase`.
  contentFlowBase = 0,
  // bfc's `completeReserve` of the box whose children this flow fits, and that
  // box's end decoration: its LAST child inherits `lastChildReserve(…)` of them.
  flowReserve: CompleteReserve = NO_RESERVE,
  flowEndDeco = 0,
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
    const skipped = metas[i];
    if (skipped === undefined) {
      throw new Error(`fit-core: meta ${i} missing (unreachable, i < effectiveStartIndex <= metas.length)`);
    }
    listCounter = accumulateListCounter(skipped, listCounter);
  }

  let runningOffset = 0;
  let childrenCount = 0; // whole blocks fully consumed on this page
  let prevMarginBlockEnd = 0;

  // Stamp every FitPageResult with the in-flow block-size consumed so far
  // (`runningOffset`) and the last child's bottom margin (`prevMarginBlockEnd`),
  // read at return time. A PARENT container uses these to reconstruct bfc's
  // partial-fragment height for a fragmenting child container (see
  // `FitPageResult.consumedBlockSize`). `checkBreakAfter` returns are stamped at
  // their call sites (it runs after the consume that advanced `runningOffset`).
  const finish = (
    partial: Omit<FitPageResult, "consumedBlockSize" | "trailingMarginBlockEnd">,
  ): FitPageResult => ({
    ...partial,
    consumedBlockSize: runningOffset,
    trailingMarginBlockEnd: prevMarginBlockEnd,
  });

  for (let i = effectiveStartIndex; i < metas.length; i++) {
    // Section cap: stop before placing the child at stopBeforeIndex,
    // as if it had break-before:page. Top-level only. Placed BEFORE the
    // margin-advance / list-counter accumulation / per-child fit so the capped
    // child has NO side effects and the list counter is NOT rolled back — it
    // was never counted.
    //
    // Gated on `childrenCount > 0` (fragment-has-content), EXACTLY like the
    // break-before:page path below: a forced break cannot occur before the
    // first piece of content on a fragment. This makes the cap robust when the
    // page STARTS at the boundary child (a resume where
    // `effectiveStartIndex === stopBeforeIndex`): the boundary child is the
    // first child of the new section's first page and MUST be placed (and its
    // inner resume token honored), not re-broken — so the cap correctly does
    // not fire. In the normal case (page started before the boundary) content
    // is always placed by the time `i` reaches the cap, so the gate is
    // satisfied. (Reaching the cap also implies every child in
    // `[startIndex, stopBeforeIndex)` fully fit — a fragmenting one would have
    // returned earlier, height-wins.)
    if (stopBeforeIndex !== undefined && i === stopBeforeIndex && childrenCount > 0) {
      return finish({
        childrenCount,
        resumeOut: { type: "block", resumeChildIndex: i, resumeChildToken: null },
        listCounterAtEnd: listCounter,
      });
    }

    const meta = metas[i];
    if (meta === undefined) {
      throw new Error(`fit-core: meta ${i} missing (unreachable, i < metas.length)`);
    }
    const fragmentHasContent = childrenCount > 0;

    // An ANONYMOUS inline-run leaf participates in NO margin collapse. bfc lays
    // its synthesized anonymous IFC block directly at `childBlockOffset`
    // (bfc.ts:355) — the inline-run branch (bfc.ts:318–386) does NOT run the
    // `Math.max(prevMarginBlockEnd, childMarginBlockStart)` advance the block-
    // child branch does (bfc.ts:480–484), so the preceding sibling's bottom
    // margin is simply DROPPED (not collapsed into the run), and the run carries
    // no bottom margin out (bfc sets `prevMarginBlockEnd = 0` at bfc.ts:373). A
    // PARAGRAPH IFC leaf (anon = false) is a real block child and DOES collapse
    // margins normally, so this skip is gated on `anonymousInlineRun`.
    const isAnonInlineRun = meta.anonymousInlineRun === true;

    // §5.4 first-on-fragment top-margin truncation (bfc.ts:466–468): the first
    // child placed on a fresh fragment has its top margin truncated to 0.
    let childMarginBlockStart = meta.marginBlockStart;
    if (!fragmentHasContent) {
      childMarginBlockStart = 0;
    }

    // Advance the running offset by the collapsed/truncated margin
    // (bfc.ts:480–484). No clearance (floats out of scope). The first child of
    // a fragment already had `childMarginBlockStart` truncated to 0 by §5.4
    // above, so its advance is 0 regardless of the flow's top boundary. An
    // anonymous inline-run leaf is laid flush (no margin advance, see above).
    // A break before this child ends the fragment here, before its top margin
    // (CSS Fragmentation §5.2 margin truncation) — bfc's `offsetBeforeChild`.
    const offsetBeforeChild = runningOffset;
    const breakBeforeChild = (resumeChildToken: BreakToken | null): FitPageResult => {
      runningOffset = offsetBeforeChild;
      return finish({
        childrenCount,
        resumeOut: { type: "block", resumeChildIndex: i, resumeChildToken },
        // This child is not consumed here: roll back its list contribution.
        listCounterAtEnd: meta.listItem ? listCounter - 1 : listCounter,
      });
    };
    // A whole child is placed here (the full-fit paths of every child kind):
    // bfc's empty-block rule for a collapse-through child — it takes no space,
    // its margin advance is undone and its collapsed margin carries on — else
    // it advances by its size.
    const placeWhole = (blockSize: number): void => {
      if (meta.collapseThrough === true) {
        runningOffset = offsetBeforeChild;
        prevMarginBlockEnd = Math.max(prevMarginBlockEnd, childMarginBlockStart, meta.marginBlockEnd);
      } else {
        runningOffset += blockSize;
        prevMarginBlockEnd = meta.marginBlockEnd;
      }
    };
    if (isAnonInlineRun) {
      // No advance; also drop the preceding sibling's pending bottom margin so
      // it does not flow past the run into the NEXT sibling's collapse (bfc
      // resets prevMarginBlockEnd to 0 the moment it lays the anonymous IFC).
      prevMarginBlockEnd = 0;
    } else if (fragmentHasContent) {
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
      return breakBeforeChild(null);
    }

    // --- Per-child fit. ---
    // `remaining` mirrors bfc's child `availableBlockSize`
    // (`fragmentation.availableBlockSize − childBlockOffset`, bfc.ts:540/627).
    const remaining = availableBlockSize - runningOffset;
    // The end-decoration reserve: only the last child carries it (bfc
    // `childReserve`), with its end margin — for a collapse-through empty child,
    // its collapsed margin (bfc's empty-block rule) less the part already advanced.
    const childMarginEnd = meta.collapseThrough === true
      ? Math.max(prevMarginBlockEnd, childMarginBlockStart, meta.marginBlockEnd) - (runningOffset - offsetBeforeChild)
      : meta.marginBlockEnd;
    const reserveState = i === metas.length - 1 ? lastChildReserve(flowReserve, flowEndDeco, childMarginEnd) : undefined;
    const reserve = reserveState === undefined ? 0 : reserveTotal(reserveState);
    const leafResumeToken = i === effectiveStartIndex ? firstChildResumeToken : null;

    if (meta.kind === "ifc") {
      // An ifc-leaf meta is one of TWO shapes (see `BlockFitMeta.anonymousInlineRun`):
      //   - PARAGRAPH leaf: a block child whose inline content forms a single
      //     anonymous IFC group at the paragraph's child index 0 (bfc.ts:320).
      //     Its break token is `{block i, {block 0, {ifc, L}}}` — the resume
      //     token THIS flow threads in (`leafResumeToken`) is that paragraph-
      //     level block token, one level deeper than a bare IFC token.
      //   - ANONYMOUS inline-run leaf: a bare inline run grouped directly inside
      //     a mixed container (bfc.ts:320–386). The run IS the group at flow
      //     index i, so bfc emits the IFC token as the container's DIRECT
      //     `resumeChildToken` (`{block i, {ifc, L}}`), with no paragraph layer.
      const isAnonRun = meta.anonymousInlineRun === true;
      const lineSizes = meta.lineBlockSizes ?? [];
      const startLine = isAnonRun
        ? bareIfcResumeAtLine(leafResumeToken)
        : ifcResumeAtLineFromParagraphToken(leafResumeToken);
      // Coherent float+pagination: the paragraph's first-line CUMULATIVE
      // document-flow offset, carried across page fragments. `contentFlowBase` is
      // this flow's content-box CUMULATIVE offset (page-cumulative `pageFlowBase`
      // at the top level — supplied by the measure pass — plus accumulated
      // container origins through nesting); `runningOffset` is this child's
      // offset within the flow. Stamped to match bfc's cumulative
      // `paraFlowStart = blockFlowBase + childBlockOffset` EXACTLY by leaf shape:
      //   - PARAGRAPH leaf: bfc lays the paragraph via its OWN `layoutBlock`,
      //     whose `blockFlowBase` includes the paragraph's flow position
      //     (`contentFlowBase + runningOffset`) and whose IFC `blockOffset` is the
      //     paragraph's local block-start border + padding. So the cumulative
      //     stamp is `contentFlowBase + runningOffset + blockStartDecoration`.
      //   - ANONYMOUS inline-run leaf: the run is a direct child group of the
      //     container at the cumulative offset `contentFlowBase + runningOffset`,
      //     matching bfc's cumulative `childBlockOffset` for that run.
      // A RESUMED leaf (either shape) carries the SAME `paraFlowStart` it began
      // with (a fixed property of where it first appeared), read from the resume
      // token — mirroring bfc, which reads it from the resume token rather than
      // recomputing. This cumulative value MUST equal bfc's stamp (measure↔
      // materialize resume tokens are compared field-for-field under
      // `breakTokensEqual`), so the page-cumulative `contentFlowBase` threading
      // here is the lockstep partner of bfc's `blockFlowBase`.
      // A PARAGRAPH leaf's own block decoration, sliced like bfc's (CSS
      // Fragmentation §5.4 `box-decoration-break: slice`): the start border +
      // padding only on its first fragment (a line-0 resume IS its first), the
      // end only on its last. An anonymous run has none.
      const startDeco = isAnonRun || startLine > 0 ? 0 : meta.blockStartDecoration ?? 0;
      const endDeco = isAnonRun ? 0 : meta.blockEndDecoration ?? 0;
      // A line-0 resume is the paragraph's real start (it moved whole, and the
      // margin before the break was truncated): stamp it fresh, like bfc.
      const carriedParaFlowStart = startLine > 0 ? paraFlowStartFromResumeToken(leafResumeToken) : undefined;
      const freshParaFlowStart = contentFlowBase + runningOffset + startDeco;
      const ifcParaFlowStart = carriedParaFlowStart ?? freshParaFlowStart;
      const makeIfcResumeToken = (resumeAtLine: number): BreakToken =>
        isAnonRun
          ? { type: "ifc", resumeAtLine, paraFlowStart: ifcParaFlowStart }
          : paragraphIfcToken(resumeAtLine, ifcParaFlowStart);
      const fitIn = (budget: number): FitLinesResult => fitLinesInIFC(
        lineSizes,
        meta.lineEndsWithHyphen,
        meta.orphans ?? 2,
        meta.widows ?? 2,
        budget,
        startLine,
      );
      // bfc lays the lines below the paragraph's start decoration.
      let fit = fitIn(remaining - startDeco);
      // The last fragment must hold its own end decoration and the reserve
      // (bfc's run refit): every line fits but they do not → refit in the space
      // left after them, so the last line(s) move with the end decorations.
      // The run inside the leaf: a paragraph hands it its own end decoration on
      // top of its reserve (margin 0); an anonymous run IS the last child.
      const runReserve = isAnonRun
        ? reserve
        : reserveTotal(lastChildReserve(reserveState ?? NO_RESERVE, endDeco, 0));
      if (
        runReserve > 0 && fit.placedLineCount > 0 && fit.resumeAtLine === null &&
        remainingIfcBlockSize(lineSizes, startLine) + runReserve > remaining - startDeco
      ) {
        fit = fitIn(remaining - startDeco - runReserve);
      }
      const fragments = fit.placedLineCount === 0 || fit.resumeAtLine !== null;

      // break-inside:avoid on a paragraph that would fragment: bfc.ts:645–665
      // applies the SAME rule a fragmenting container gets — discard the partial,
      // push the WHOLE remainder to the next fragment; or overflow-consume-
      // whole when first-on-fragment. The IFC line-fit is bypassed entirely.
      if (fragments && meta.breakInsideAvoid) {
        if (!fragmentHasContent) {
          // overflow-consume-whole for a break-inside:avoid paragraph that
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
          runningOffset += startDeco + remainingIfcBlockSize(lineSizes, startLine) + endDeco;
          prevMarginBlockEnd = meta.marginBlockEnd;
          childrenCount++;
          const afterBreak = checkBreakAfter(meta, i, metas.length, childrenCount, listCounter);
          if (afterBreak !== null) return finish(afterBreak);
          continue;
        }
        return breakBeforeChild(null);
      }

      if (fit.placedLineCount === 0) {
        // IFC couldn't place anything (bfc.ts:356–364). Overflow rule: if first on the
        // fragment, consume whole (overflow); else break here.
        if (!fragmentHasContent) {
          // Overflow-consume-whole: place the remaining (from startLine) lines.
          runningOffset += startDeco + remainingIfcBlockSize(lineSizes, startLine) + endDeco;
          prevMarginBlockEnd = meta.marginBlockEnd;
          childrenCount++;
          // break-after still applies after a consumed block.
          const afterBreak = checkBreakAfter(meta, i, metas.length, childrenCount, listCounter);
          if (afterBreak !== null) return finish(afterBreak);
          continue;
        }
        return breakBeforeChild(makeIfcResumeToken(startLine));
      }
      if (fit.resumeAtLine !== null) {
        // Partial IFC fit → this child is the last on the page (bfc.ts:376–382).
        // Advance `runningOffset` by the PLACED lines' heights so a parent
        // container's `consumedBlockSize` is exact (bfc.ts:372 advances
        // `childBlockOffset` by the partial IFC box height before propagating the
        // break).
        //
        // Trailing margin out of this partial fragment, by leaf shape:
        //   - ANONYMOUS inline-run leaf: `prevMarginBlockEnd` was already zeroed
        //     in the pre-advance step above (bfc resets it to 0 the moment it
        //     lays the anonymous IFC, bfc.ts:373), so the container's
        //     reconstructed partial-fragment height carries NO trailing margin —
        //     never the preceding block sibling's stale bottom margin.
        //   - PARAGRAPH leaf (anon = false): bfc does NOT reset `prevMarginBlockEnd`
        //     before propagating a paragraph's partial token, so we leave it
        //     unchanged — the previous sibling's bottom margin is preserved, as in
        //     bfc.
        let placedUsed = 0;
        for (let li = startLine; li < startLine + fit.placedLineCount; li++) {
          const h = lineSizes[li];
          if (h === undefined) throw new Error(`fit-core: line ${li} missing (unreachable, < placedLineCount)`);
          placedUsed += h;
        }
        // A non-final fragment: start decoration (first fragment only), no end.
        runningOffset += startDeco + placedUsed;
        return finish({
          childrenCount,
          resumeOut: { type: "block", resumeChildIndex: i, resumeChildToken: makeIfcResumeToken(fit.resumeAtLine) },
          listCounterAtEnd: listCounter,
        });
      }
      // All remaining lines fit. Advance by the consumed line heights.
      let used = 0;
      for (let li = startLine; li < startLine + fit.placedLineCount; li++) {
        const h = lineSizes[li];
        if (h === undefined) throw new Error(`fit-core: line ${li} missing (unreachable, < placedLineCount)`);
        used += h;
      }
      // The paragraph's last fragment adds its end decoration; bfc's whole-block
      // fit check then moves it whole when that overflows (or, first on the
      // fragment, overflows in place).
      const lastFragmentSize = startDeco + used + endDeco;
      // bfc's whole-block fit check with the reserve (a paragraph box only; an
      // anonymous run is not a child box).
      if (lastFragmentSize + (isAnonRun ? 0 : reserve) > remaining && fragmentHasContent) {
        return breakBeforeChild(null);
      }
      placeWhole(lastFragmentSize);
      childrenCount++;
      const afterBreak = checkBreakAfter(meta, i, metas.length, childrenCount, listCounter);
      if (afterBreak !== null) return finish(afterBreak);
      continue;
    }

    if (meta.kind === "table") {
      const rowSizes = meta.rowBlockSizes ?? [];
      const startRow =
        leafResumeToken !== null && leafResumeToken.type === "table"
          ? leafResumeToken.resumeAtRow
          : 0;
      // A rowSpan cell straddling THIS table's incoming break is carried
      // on the leaf resume token's `spanningCells`. The measure pass works only off
      // `rowBlockSizes` (no cell interiors), so it cannot recompute the list — it
      // THREADS the incoming continuation through unchanged so the page plan doesn't
      // drop it; the FC refines the exact interiorBreakToken at getPage time.
      const inheritedSpanningCells =
        leafResumeToken !== null && leafResumeToken.type === "table"
          ? leafResumeToken.spanningCells
          : undefined;
      // Header repetition: a continuation fragment (startRow > 0) of a table
      // with header rows reserves `headerBlockSize` at the top for the re-emitted
      // header. `forceProgress` guarantees ≥1 placed body row in that case (the
      // progress floor), so the overflow-rule placedRowCount===0 overflow-consume path below
      // is never reached when the header is reserved. On the FIRST fragment
      // (startRow === 0) the header rows are ordinary leading rows: no reservation,
      // byte-identical to today (headerBlockSize subtracts −0, no force).
      const headerRowCount = meta.headerRowCount ?? 0;
      const headerBlockSize =
        startRow > 0 && headerRowCount > 0 ? meta.headerBlockSize ?? 0 : 0;
      const forceProgress = startRow > 0 && headerRowCount > 0;
      let fit = fitRowsInTable(rowSizes, remaining, startRow, headerBlockSize, forceProgress);
      // The reserve (table-fc's refit): every row fits but the reserve does not →
      // refit, so the last row(s) move with the end decorations.
      if (reserve > 0 && fit.placedRowCount > 0 && fit.resumeAtRow === null &&
          headerBlockSize + remainingIfcBlockSize(rowSizes, startRow) + reserve > remaining) {
        fit = fitRowsInTable(rowSizes, remaining - reserve, startRow, headerBlockSize, forceProgress);
      }
      if (fit.placedRowCount === 0) {
        // Table couldn't place a row (bfc.ts:573–588). overflow if first.
        if (!fragmentHasContent) {
          // Overflow-consume the SUFFIX rows actually on this fragment
          // (`rowSizes[startRow..]`), NOT `meta.totalBlockSize` (the WHOLE table).
          // On a RESUMED table (startRow > 0) rows `0..startRow-1` were already
          // consumed on earlier pages, so totalBlockSize double-counts them and a
          // sibling after the table on this overflow page would be positioned too
          // low. Mirrors the partial-fit branch's `placedRowsUsed` suffix sum below.
          //
          // `headerBlockSize` is INTENTIONALLY NOT added here (unlike the
          // partial-fit and all-fit advancing paths). Under the progress floor,
          // `forceProgress` guarantees `fitRowsInTable` returns `placedRowCount >= 1`
          // whenever `suffixLength > 0`, so this `placedRowCount === 0` path is only
          // reached for the header-reserved case when `suffixLength === 0` (no body
          // rows remain) — in which case `suffixRowsUsed === 0` and the table
          // terminates here. Adding `headerBlockSize` would account for a repeated
          // header on a fragment the materializer cannot emit (it would produce a
          // header-only "continuation" with no body rows). So the rule "all three
          // advancing paths add headerBlockSize" holds for the two REACHABLE header
          // paths; this path is structurally excluded for the header case.
          let suffixRowsUsed = 0;
          for (let ri = startRow; ri < rowSizes.length; ri++) {
            const h = rowSizes[ri];
            if (h === undefined) throw new Error(`fit-core: row ${ri} missing (unreachable, ri < rowSizes.length)`);
            suffixRowsUsed += h;
          }
          runningOffset += suffixRowsUsed;
          prevMarginBlockEnd = meta.marginBlockEnd;
          childrenCount++;
          const afterBreak = checkBreakAfter(meta, i, metas.length, childrenCount, listCounter);
          if (afterBreak !== null) return finish(afterBreak);
          continue;
        }
        return breakBeforeChild({ type: "table", resumeAtRow: startRow, ...(inheritedSpanningCells ? { spanningCells: inheritedSpanningCells } : {}) });
      }
      if (fit.resumeAtRow !== null) {
        // Advance `runningOffset` by the repeated-header reservation PLUS the
        // PLACED rows' heights so a parent container's `consumedBlockSize` — and a
        // sibling positioned after the table on this fragment — is exact (mirrors
        // the partial-IFC case above). `headerBlockSize` is 0 on the first fragment
        // and when the table has no header (header repetition). The fragmenting table
        // carries no trailing margin.
        let placedRowsUsed = 0;
        for (let ri = startRow; ri < startRow + fit.placedRowCount; ri++) {
          const h = rowSizes[ri];
          if (h === undefined) throw new Error(`fit-core: row ${ri} missing (unreachable, < placedRowCount)`);
          placedRowsUsed += h;
        }
        runningOffset += headerBlockSize + placedRowsUsed;
        return finish({
          childrenCount,
          resumeOut: { type: "block", resumeChildIndex: i, resumeChildToken: { type: "table", resumeAtRow: fit.resumeAtRow, ...(inheritedSpanningCells ? { spanningCells: inheritedSpanningCells } : {}) } },
          listCounterAtEnd: listCounter,
        });
      }
      // All remaining rows fit on this fragment. A continuation fragment still
      // re-emits the repeated header above the body rows, so its consumed height
      // includes `headerBlockSize` (0 on the first fragment / no-header case).
      let used = 0;
      for (let ri = startRow; ri < startRow + fit.placedRowCount; ri++) {
        const h = rowSizes[ri];
        if (h === undefined) throw new Error(`fit-core: row ${ri} missing (unreachable, < placedRowCount)`);
        used += h;
      }
      // bfc's whole-block fit check with the reserve.
      if (headerBlockSize + used + reserve > remaining && fragmentHasContent) {
        return breakBeforeChild(null);
      }
      placeWhole(headerBlockSize + used);
      childrenCount++;
      const afterBreak = checkBreakAfter(meta, i, metas.length, childrenCount, listCounter);
      if (afterBreak !== null) return finish(afterBreak);
      continue;
    }

    // --- Container block (kind:"block" with children) → RECURSE. ---
    // Mirror bfc.ts:536–543 (child fragmentation threading: the recursed
    // container gets the reduced `remaining` and the resume token only on the
    // first iteration) + 593–673 (nested token build + break-inside/overflow-rule).
    const childResume =
      leafResumeToken !== null && leafResumeToken.type === "block" ? leafResumeToken : null;
    const childChildren = meta.children ?? [];
    // bfc insets the container's children by its block-start border + padding:
    // the children's available block-size is `remaining − blockStartDecoration`
    // — on its first fragment only; a resumed container slices its start side
    // (CSS Fragmentation §5.4 `box-decoration-break: slice`). The end decoration
    // is added to the container height AFTER all children are placed, so it does
    // NOT reduce the children's fragmentation space.
    const containerResumed = !isResumeFromDegenerate(childResume);
    const containerBlockStart = containerResumed ? 0 : meta.blockStartDecoration ?? 0;
    const childAvailable = remaining - containerBlockStart;
    // The recursion relies on the §5.4 truncation (which always zeroes the first
    // child of a fresh fragment) for the page-break-relevant first-child margin
    // case — matching bfc, which truncates the first child of every fragment
    // regardless of the container's own top boundary.
    const childResult = fitOnePageRecursive(
      childChildren,
      0,
      childResume,
      childAvailable,
      listCounter,
      // No section cap inside a nested container (matches bfc: `stopBeforeIndex`
      // is top-level only).
      undefined,
      // The child container's content-box CUMULATIVE offset. bfc lays each nested
      // container via a fresh `layoutBlock` whose `blockFlowBase` accumulates the
      // container's position in the flow (`contentFlowBase + runningOffset`, the
      // container's border-box top) plus the container's own `blockStartDecoration`
      // (the content-box top). So this base IS a page-cumulative sum — it
      // accumulates through ancestors, matching bfc's cumulative `blockFlowBase`
      // for the nested container.
      contentFlowBase + runningOffset + containerBlockStart,
      // Its last child completes with it: it inherits this box's reserve + end decoration.
      reserveState ?? NO_RESERVE,
      meta.blockEndDecoration ?? 0,
    );

    // When the container fragmented (resumeOut !== null), reconstruct the bfc
    // PARTIAL-fragment height of the container box (`buildPartialResult`): its
    // start decoration (first fragment only) + the children's consumed offset. A
    // non-final fragment slices its end side and truncates the trailing margin
    // adjoining the break. bfc's per-child whole-block-fit check compares THIS
    // partial height against `remaining` BEFORE the break-inside / nested-resume
    // handling.
    if (childResult.resumeOut !== null) {
      const partialContainerHeight = containerBlockStart + childResult.consumedBlockSize;

      // bfc's whole-block fit check on the PARTIAL box height: when it overflows
      // `remaining` and the fragment has content, break BEFORE this container.
      // First on the fragment, the overflowing partial stays here AND keeps its
      // nested resume token (handled below, like any partial).
      if (partialContainerHeight > remaining && fragmentHasContent) {
        return breakBeforeChild(null);
      }

      // Partial placed. bfc.ts:645–673: break-inside:avoid → discard partial, push
      // whole (or overflow if first-on-fragment); otherwise the container is
      // the last on the page and threads its nested resume token.
      if (meta.breakInsideAvoid) {
        if (!fragmentHasContent) {
          // overflow-consume-whole (bfc.ts:653–658): re-lay the WHOLE
          // container unfragmented → its `totalBlockSize`.
          runningOffset += meta.totalBlockSize;
          prevMarginBlockEnd = meta.marginBlockEnd;
          childrenCount++;
          listCounter = childResult.listCounterAtEnd;
          const afterBreak = checkBreakAfter(meta, i, metas.length, childrenCount, listCounter);
          if (afterBreak !== null) return finish(afterBreak);
          continue;
        }
        return breakBeforeChild(null);
      }
      // Container is the last block on this page; thread its nested resume.
      // Its list contribution counts (the items it placed are consumed). Advance
      // `runningOffset` by the partial height so `consumedBlockSize` is exact for
      // a grandparent container (this flow may itself be nested).
      runningOffset += partialContainerHeight;
      prevMarginBlockEnd = meta.marginBlockEnd;
      return finish({
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
      });
    }

    // Container fit fully. Its height: the whole unfragmented box, or — for the
    // LAST fragment of a resumed container — bfc's full-return height with the
    // start side sliced: children's offset + trailing margin (unless the end
    // decoration bounds it) + end decoration.
    const containerBlockEnd = meta.blockEndDecoration ?? 0;
    const lastMarginBlockEnd = containerBlockEnd === 0 ? 0 : childResult.trailingMarginBlockEnd;
    const completeHeight = containerResumed
      ? childResult.consumedBlockSize + lastMarginBlockEnd + containerBlockEnd
      : meta.totalBlockSize;
    // Whole-block fit check (bfc.ts:626–642).
    if (completeHeight + reserve > remaining) {
      // Overflow rule: first-on-fragment too-tall → consume whole + overflow.
      if (!fragmentHasContent) {
        runningOffset += completeHeight;
        prevMarginBlockEnd = meta.marginBlockEnd;
        childrenCount++;
        listCounter = childResult.listCounterAtEnd;
        const afterBreak = checkBreakAfter(meta, i, metas.length, childrenCount, listCounter);
        if (afterBreak !== null) return finish(afterBreak);
        continue;
      }
      return breakBeforeChild(null);
    }

    // Fits fully.
    placeWhole(completeHeight);
    childrenCount++;
    listCounter = childResult.listCounterAtEnd;
    const afterBreak = checkBreakAfter(meta, i, metas.length, childrenCount, listCounter);
    if (afterBreak !== null) return finish(afterBreak);
  }

  // All blocks consumed — document (or container) end.
  return finish({ childrenCount, resumeOut: null, listCounterAtEnd: listCounter });
}

/**
 * Block-axis size of an ifc-leaf's lines from `startLine` to the end — the
 * height consumed when the paragraph is overflow-consumed-whole or
 * pushed whole (break-inside:avoid). Mirrors bfc's `applyOverflowRule`
 * re-laying the block unfragmented (it places every remaining line).
 */
function remainingIfcBlockSize(lineSizes: readonly number[], startLine: number): number {
  let total = 0;
  for (let i = startLine; i < lineSizes.length; i++) {
    const h = lineSizes[i];
    if (h === undefined) throw new Error(`fit-core: line ${i} missing (unreachable, i < lineSizes.length)`);
    total += h;
  }
  return total;
}

/**
 * Build the block-break token a fragmenting PARAGRAPH (ifc-leaf) emits. The
 * paragraph's inline content is a single anonymous IFC group at the paragraph's
 * child index 0 (bfc.ts:320), so the paragraph-level break token is
 * `{block, resumeChildIndex:0, resumeChildToken:{ifc, resumeAtLine}}`. The
 * caller wraps THIS in the flow-level `{block, resumeChildIndex:i, …}`.
 */
function paragraphIfcToken(resumeAtLine: number, paraFlowStart: number): BreakToken {
  return {
    type: "block",
    resumeChildIndex: 0,
    resumeChildToken: { type: "ifc", resumeAtLine, paraFlowStart },
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
 * Extract the IFC resume line from a BARE `{ifc}` token threaded to an anonymous
 * inline-run leaf (no intermediate paragraph layer — see
 * `BlockFitMeta.anonymousInlineRun`). The container threads its direct
 * `resumeChildToken`, which for an anonymous inline-run group is the IFC token
 * itself. Returns 0 when there is no resume state.
 */
function bareIfcResumeAtLine(token: BreakToken | null): number {
  if (token === null) return 0;
  if (token.type === "ifc") return token.resumeAtLine;
  return 0;
}

/**
 * Coherent float+pagination: extract the carried `paraFlowStart` from a resume
 * token, or `undefined` when the token carries none (fresh paragraph). Mirrors
 * bfc's resume read: an `ifc` token directly, or a `block` token whose
 * `resumeChildToken` is an `ifc`. A resumed paragraph must carry the SAME
 * `paraFlowStart` it began with (a fixed property of where it first appeared),
 * exactly as bfc does, so the two passes' resume-out tokens stay byte-identical.
 */
function paraFlowStartFromResumeToken(token: BreakToken | null): number | undefined {
  if (token === null) return undefined;
  if (token.type === "ifc") return token.paraFlowStart;
  if (token.type === "block" && token.resumeChildToken?.type === "ifc") {
    return token.resumeChildToken.paraFlowStart;
  }
  return undefined;
}

/**
 * Recursively accumulate the ordered-list counter contribution of `meta`:
 * +1 if it is a `list-item`, plus the contribution of every descendant
 * list-item (a container's nested list items, walked in order). Mirrors the
 * effect of bfc's per-level `listCounter` increment as the walk recurses.
 *
 * Exported for the VL float fast-path producer closure (`floatPageMeasurer`),
 * which advances the per-page list counter over the consumed metas the SAME way
 * `fitOnePage` does — so the float path's `listCounterAtStart` is byte-identical
 * to the `fitOnePage` path.
 */
export function accumulateListCounter(meta: BlockFitMeta, counter: number): number {
  let next = counter;
  if (meta.listItem === true) next++;
  if (meta.children !== undefined) {
    for (const child of meta.children) next = accumulateListCounter(child, next);
  }
  return next;
}

/**
 * break-after:page handling (bfc.ts:711–724). Only fires when more children
 * remain in this flow. Returns a PARTIAL result (the caller's `finish` closure
 * stamps `consumedBlockSize` / `trailingMarginBlockEnd`) to STOP the page, or
 * `null` to continue. `childrenCount` already includes the just-consumed child.
 */
function checkBreakAfter(
  meta: BlockFitMeta,
  index: number,
  total: number,
  childrenCount: number,
  listCounter: number,
): Omit<FitPageResult, "consumedBlockSize" | "trailingMarginBlockEnd"> | null {
  if (meta.breakAfter !== "page") return null;
  const hasMoreChildren = index + 1 < total;
  if (!hasMoreChildren) return null;
  return {
    childrenCount,
    resumeOut: { type: "block", resumeChildIndex: index + 1, resumeChildToken: null },
    listCounterAtEnd: listCounter,
  };
}
