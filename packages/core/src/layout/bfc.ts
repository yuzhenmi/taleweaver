import type { ElementBox } from "../render/render-node";
import type { LayoutBox, BlockBox } from "./layout-box";
import { createBlockBox, createMarkerBox, withOffsets, assertLayoutBoxConsistent } from "./layout-box";
import type { BlockBreakToken, BreakToken, FragmentationContext, LayoutResult } from "./fragmentation";
import { normalizeBreakValue } from "./fragmentation";
import { layoutInlineContent } from "./ifc";
import { layoutTable } from "./table-fc";
import type { TextShaper } from "./text-shaper";
import { adaptShaperToMeasurer } from "./text-measurer";
import type { ComputedStyle } from "../styles";
import { formatCounter } from "./list-counter";
import { computeUsedStyle, resolveUsedLength } from "./used-style";
import type { LayoutContext } from "./layout-context";
import { makeChildContext } from "./layout-context";
import { computeIntrinsicSizes } from "./intrinsic-sizes-pass";
import { groupChildren, anonymousBlockKey } from "./group-children";
import { isLayoutBoxReusable, renderNodesLayoutEquivalent } from "./layout-reuse";
import { markStart, markEnd } from "../perf/perf-trace";

/**
 * Lay out a block-level element in a Block Formatting Context.
 * Plan 1 D.4 scope: stacked block children, padding, adjacent-sibling margin collapse.
 */
/**
 * True when a resume-token chain ultimately says "start from the
 * beginning at every level": the chain is null, or each block-typed
 * level resumes at child 0 with a degenerate inner token, or the
 * terminal IFC level resumes at line 0. Used by the paginated-mode
 * cache reuse check (L-PERF-A) — a cached complete-block layout is
 * a valid reuse target only when the requested call doesn't have
 * partial mid-fragmentation state to honor.
 *
 * Note: `{block, resumeChildIndex:0, resumeChildToken:{ifc, resumeAtLine:0}}`
 * is classified as degenerate because the CSS Fragmentation L4 §3.5
 * overflow rule (C.6 in the BFC implementation) guarantees the first
 * child always fits on a fragment — if it can't fit, the rule re-
 * invokes layout without fragmentation and accepts the overflowing
 * box. A token at child-0/line-0 can therefore only arise from a
 * full-layout round-trip in practice, not from a genuine mid-
 * fragmentation state. If C.6 ever changes (or a future FC introduces
 * a different overflow rule), revisit this case — a non-degenerate
 * `{idx:0, line:0}` token could silently win cache reuse and emit a
 * complete-block layout where a partial-fragment was expected.
 */
function isResumeFromDegenerate(rf: BreakToken | null): boolean {
  if (rf === null) return true;
  if (rf.type === "ifc") return rf.resumeAtLine === 0;
  if (rf.type === "block") {
    return rf.resumeChildIndex === 0 && isResumeFromDegenerate(rf.resumeChildToken);
  }
  // Other types (table) — be conservative.
  return false;
}

/**
 * Diagnostic counters for the paginated cache reuse path. Tests +
 * the example app's `__twPerf` hook expose these so we can verify
 * that a single-block edit on a large doc cache-hits ~N-1 of N
 * paragraph-level layoutBlock calls (instead of cache-missing all N).
 * Production code only pays the integer increments.
 */
const _layoutCacheStats = {
  /** Cache hit returning the cached box AS-IS (positions matched). */
  hits: 0,
  /** Cache hit but the requested outer position differs — L-PERF-G
   *  clones the cached box at the new position. Counted separately
   *  because each clone has a small allocation cost; useful to know
   *  whether the workload is hitting the clone path or the as-is
   *  path. */
  hitsRepositioned: 0,
  missesNoEntry: 0,
  missesRenderInequiv: 0,
  missesSize: 0,
  missesResumeFrom: 0,
  missesReusableGate: 0,
  fullLayoutInvocations: 0,
};

export function __getLayoutCacheStatsForTest(): typeof _layoutCacheStats {
  return { ..._layoutCacheStats };
}

export function __resetLayoutCacheStatsForTest(): void {
  _layoutCacheStats.hits = 0;
  _layoutCacheStats.hitsRepositioned = 0;
  _layoutCacheStats.missesNoEntry = 0;
  _layoutCacheStats.missesRenderInequiv = 0;
  _layoutCacheStats.missesSize = 0;
  _layoutCacheStats.missesResumeFrom = 0;
  _layoutCacheStats.missesReusableGate = 0;
  _layoutCacheStats.fullLayoutInvocations = 0;
}

export function layoutBlock(
  node: ElementBox,
  inlineOffset: number,
  blockOffset: number,
  ctx: LayoutContext,
  shaper: TextShaper,
  fragmentation?: FragmentationContext,
): LayoutResult<BlockBox> {
  const t = markStart("bfc.layoutBlock");
  try {
  const availableInlineSize = ctx.containingInlineSize;
  const writingMode = ctx.writingMode;
  const direction = ctx.direction;
  if (!node.computedStyle) throw new Error("cascade required");
  const cs = node.computedStyle;

  // Subtree reuse: if a previous layout exists, check whether this block's
  // output is still valid. Conservative — only reuse when all inputs match.
  //
  // The render-node identity gate accepts two equivalence levels:
  //   (a) `node === entry.renderNode` — strictly the same reference.
  //   (b) `renderNodesLayoutEquivalent(node, entry.renderNode)` — the parent
  //       was rebuilt because its children-array changed, but its children
  //       are reference-equal to the cached version (a "structurally inert"
  //       rebuild). This is the common case for the document root after a
  //       single-paragraph edit: 999 of 1000 children flow through unchanged
  //       via renderTreeIncremental + cascadePassIncremental, the parent's
  //       children array is fresh, and only one child actually mutated.
  //       Without this gate, every keystroke would force the document root
  //       to iterate all N children — O(N) reuse-cache hits even when 999
  //       are inert.
  //
  // Paginated reuse (L-PERF-A). When `fragmentation` is defined, the cache
  // is gated more tightly:
  //   - position match: the cached box's (inlineOffset, blockOffset) MUST
  //     equal the requested (inlineOffset, blockOffset). The cached box is
  //     returned as-is — its absolute coordinates are baked in, so a reuse
  //     at a different position would render content at the wrong place.
  //   - fits-on-page: cached blockSize ≤ availableBlockSize remaining on
  //     this fragment. Otherwise the cached box overflows and we'd lose
  //     the breakToken that the original layout would have emitted.
  //   - clean start: no resume token to honor (the cached box was laid
  //     out fresh, not as a continuation; reusing it as a continuation
  //     would lose the resume context).
  // The outer all-pages root box (key === root.key, positioned at (0, 0))
  // doesn't match the per-page layoutBlock's (margins.inlineStart,
  // margins.blockStart) request, so the root cache entry never accidentally
  // wins reuse — only paragraph-level children do.
  if (ctx.prevLayoutCache !== null) {
    const entry = ctx.prevLayoutCache.get(node.key);
    if (entry === undefined || entry.box.type !== "block") {
      _layoutCacheStats.missesNoEntry++;
    } else if (!renderNodesLayoutEquivalent(node, entry.renderNode)) {
      _layoutCacheStats.missesRenderInequiv++;
    } else {
      const dirtyOffset = ctx.prevFloatEnv !== null
        ? ctx.floatEnv.dirtyBlockOffsetSince(ctx.prevFloatEnv)
        : Number.POSITIVE_INFINITY;
      // A resumeFrom is "degenerate" (no actual mid-fragmentation
      // state to honor) when every level of the token chain says
      // "start from the beginning". The cached entry is a complete
      // from-scratch layout, so any degenerate resumeFrom can reuse
      // it; non-degenerate resumeFroms require honoring partial
      // state the cached box has already collapsed away.
      if (fragmentation !== undefined && !isResumeFromDegenerate(fragmentation.resumeFrom)) {
        _layoutCacheStats.missesResumeFrom++;
      } else if (fragmentation !== undefined &&
                 entry.box.blockSize > fragmentation.availableBlockSize) {
        _layoutCacheStats.missesSize++;
      } else if (!isLayoutBoxReusable(entry.box, {
        computedStyle: cs,
        availableInlineSize,
        writingMode,
        direction,
        floatEnvDirtyBlockOffset: dirtyOffset,
      })) {
        _layoutCacheStats.missesReusableGate++;
      } else {
        _layoutCacheStats.hits++;
        // L-PERF-G: reposition-on-clone. When content matches but the
        // requested outer position differs (typical after SPLIT/PASTE
        // at the top of a long doc: every subsequent block shifts y by
        // delta even though its content is unchanged), clone the
        // cached box at the new outer (inlineOffset, blockOffset).
        // Descendants keep their local positions — they're parent-
        // relative in the layout-box coordinate system, so painter /
        // hit-test / line-flatten all accumulate correctly through
        // the cloned outer offset. Skips full IFC tokenization +
        // measureText for the shifted-but-content-stable child case,
        // which was the dominant cost on ENTER-at-top of a long doc.
        const needsReposition =
          entry.box.inlineOffset !== inlineOffset ||
          entry.box.blockOffset !== blockOffset;
        if (!needsReposition) {
          return { box: entry.box, breakToken: null };
        }
        _layoutCacheStats.hitsRepositioned++;
        return {
          box: createBlockBox(
            entry.box.key,
            inlineOffset,
            blockOffset,
            entry.box.inlineSize,
            entry.box.blockSize,
            entry.box.writingMode,
            entry.box.direction,
            entry.box.computedStyle,
            entry.box.usedStyle,
            entry.box.children,
            /* containingInlineSize */ availableInlineSize,
            entry.box.metadata,
          ),
          breakToken: null,
        };
      }
    }
  }
  _layoutCacheStats.fullLayoutInvocations++;
  const usedStyle = computeUsedStyle(cs, availableInlineSize, "indefinite");

  const paddingBlockStart  = usedStyle.paddingBlockStart;
  const paddingInlineEnd   = usedStyle.paddingInlineEnd;
  const paddingBlockEnd    = usedStyle.paddingBlockEnd;
  const paddingInlineStart = usedStyle.paddingInlineStart;

  // CSS parent/first and parent/last collapse rules:
  // if the parent has no top padding/border, the first child's marginBlockStart
  // is suppressed (collapses with parent's outside margin).
  // Symmetric for bottom.
  const noTopBoundary = paddingBlockStart === 0 && usedStyle.borderBlockStartWidth === 0;
  const noBottomBoundary = paddingBlockEnd === 0 && usedStyle.borderBlockEndWidth === 0;

  const finalInlineSize = resolveBoxInlineSize(cs, availableInlineSize, false, node, shaper, ctx);
  const contentInlineSize = finalInlineSize - paddingInlineStart - paddingInlineEnd;

  let childBlockOffset = paddingBlockStart;
  const layoutChildren: LayoutBox[] = [];
  // Use the float environment from the context. If this block establishes a new
  // BFC, makeChildContext (called by our parent) already gave us a fresh env.
  // If it doesn't, we share the parent's env so floats rise up to the BFC.
  const floatEnv = ctx.floatEnv;
  // ctx.isBFCRoot is true when the parent gave this box its OWN fresh float env.
  // Only a BFC root encloses its floats; non-BFC blocks pass floats to the ancestor BFC.
  const isOwnBFC = ctx.isBFCRoot;

  let prevMarginBlockEnd = 0;
  let listCounter = 0;

  const groups = groupChildren(node);

  // C.7: Parse the resume token to determine where to start the child loop.
  let startIndex = 0;
  let firstChildResumeToken: BreakToken | null = null;
  // D.5: When resumeFrom is an IFCBreakToken, this block element is a leaf block
  // whose inline content (inline-run group) is being resumed. Thread the token to
  // layoutInlineContent rather than treating it as a block-level resume.
  let inlineRunResumeToken: BreakToken | null = null;
  if (fragmentation !== undefined && fragmentation.resumeFrom !== null) {
    if (fragmentation.resumeFrom.type === "ifc") {
      // IFC resume: this block's inline-run group resumes from this token.
      inlineRunResumeToken = fragmentation.resumeFrom;
    } else if (fragmentation.resumeFrom.type === "block") {
      startIndex = fragmentation.resumeFrom.resumeChildIndex;
      firstChildResumeToken = fragmentation.resumeFrom.resumeChildToken;
    } else {
      throw new Error(
        `layoutBlock: unexpected top-level resumeFrom type (expected "block" or "ifc", got "${fragmentation.resumeFrom.type}")`,
      );
    }
  }

  // When resuming at startIndex > 0, seed listCounter from preceding list-item
  // children so ordered-list numbering continues correctly across page breaks.
  // Without this, list items on page 2+ would restart from 1.
  if (startIndex > 0) {
    for (let i = 0; i < startIndex; i++) {
      const g = groups[i];
      if (g.kind === "block") {
        const c = g.child;
        if (c.type === "element" && c.computedStyle?.display === "list-item") {
          listCounter++;
        }
      }
    }
  }

  /**
   * Build a partial LayoutResult<BlockBox> from the children placed so far
   * and a non-null break token. Used when fragmentation stops the loop early.
   */
  function buildPartialResult(
    placedChildren: LayoutBox[],
    breakToken: BlockBreakToken,
  ): LayoutResult<BlockBox> {
    if (placedChildren.length === 0) {
      return { box: null, breakToken };
    }
    // TODO (P1.C or later): per CSS Fragmentation L4 §5.4, the last placed
    // child's bottom-margin and the parent's paddingBlockEnd should be
    // suppressed in non-final partial fragments (margin truncation across
    // breaks, bottom side). C.5 implemented top-margin truncation only;
    // the common case (parent with noBottomBoundary) already drops via the
    // existing collapse rule, so the visible bug is limited to parents with
    // bottom padding/border on a partial fragment.
    const lastMarginBlockEndPartial = noBottomBoundary ? 0 : prevMarginBlockEnd;
    const inFlowBlockSizePartial = childBlockOffset + lastMarginBlockEndPartial + paddingBlockEnd;
    let totalBlockSizePartial: number;
    if (isOwnBFC) {
      const floatBlockEnd = floatEnv.lowestFloatBlockEdge();
      totalBlockSizePartial = Math.max(inFlowBlockSizePartial, floatBlockEnd + paddingBlockEnd);
    } else {
      totalBlockSizePartial = inFlowBlockSizePartial;
    }
    return {
      box: createBlockBox(
        node.key, inlineOffset, blockOffset, finalInlineSize, totalBlockSizePartial,
        writingMode, direction, cs, usedStyle, placedChildren,
        /* containingInlineSize */ availableInlineSize,
        node.metadata,
      ),
      breakToken,
    };
  }

  for (let i = startIndex; i < groups.length; i++) {
    // Section cap (C.2b-1): stop before placing the TOP-LEVEL child at
    // `fragmentation.stopBeforeIndex`, as if it had `break-before:page`. This
    // mirrors the plan's `fitOnePage` cap so positioning agrees with the page
    // plan — without it, a section's last page (with leftover room) greedily
    // fills with the next section's leading block(s), duplicating them across
    // pages. Placed at the TOP of the loop body, BEFORE any per-child side
    // effects (margin advance / list counter / marker), so the capped child has
    // no side effects — identical to fit-core's pre-side-effect cap.
    //
    // Gated on `layoutChildren.length > 0` (fragment-has-content), EXACTLY like
    // the `break-before:page` path below: a forced break cannot occur before the
    // first piece of content on a fragment. This makes the cap robust when the
    // page STARTS at the boundary child (a resume where
    // `startIndex === stopBeforeIndex`): that child is the new section's first
    // page's first child and MUST be placed, so the cap correctly does not fire.
    //
    // TOP-LEVEL ONLY: this reads `fragmentation.stopBeforeIndex` directly; the
    // child `FragmentationContext`s built later in this loop (`ifcFragmentation`,
    // `childFragmentation`) are constructed fresh WITHOUT this field, so nested
    // containers / IFC leaves are never capped.
    if (
      fragmentation !== undefined &&
      fragmentation.stopBeforeIndex !== undefined &&
      i === fragmentation.stopBeforeIndex &&
      layoutChildren.length > 0
    ) {
      return buildPartialResult(layoutChildren, {
        type: "block",
        resumeChildIndex: i,
        resumeChildToken: null,
      });
    }

    const group = groups[i];
    if (group.kind === "inline-run") {
      // Synthesize an anonymous ElementBox for this inline-run group and lay it out via IFC.
      const anonKey = anonymousBlockKey(node.key, group.positionalIndex);
      const anonElement: ElementBox = Object.freeze({
        type: "element" as const,
        key: anonKey,
        style: node.style,
        computedStyle: cs,
        children: Object.freeze([...group.children]),
      });

      // Pass floatEnv explicitly via the context: the anonymous IFC element
      // inherits this block's float env (same BFC), so pass it in ctx.floatEnv.
      // We create a child context that carries the same floatEnv.
      const ifcCtx = makeChildContext(ctx, cs, contentInlineSize, "indefinite");

      // Build IFC fragmentation context if paginating. Thread the IFC resume token
      // (D.5) when this block is being resumed from a previous IFC break.
      // Two sources of IFC resume tokens:
      //   1. inlineRunResumeToken — set when layoutBlock received resumeFrom.type === "ifc" directly
      //      (e.g., when this block IS the resumed paragraph, called from parent with IFC token).
      //   2. firstChildResumeToken — set when layoutBlock received a BlockBreakToken whose
      //      resumeChildToken is an IFCBreakToken (e.g., paragraph resumed from its own inline group).
      const ifcResumeFrom: BreakToken | null =
        inlineRunResumeToken ??
        (i === startIndex ? firstChildResumeToken : null);
      const ifcFragmentation: FragmentationContext | undefined =
        fragmentation === undefined
          ? undefined
          : {
              availableBlockSize: fragmentation.availableBlockSize - childBlockOffset,
              pageIndex: fragmentation.pageIndex,
              resumeFrom: ifcResumeFrom,
            };

      const ifcResult = layoutInlineContent(anonElement, paddingInlineStart, childBlockOffset, ifcCtx, shaper, ifcFragmentation);
      if (ifcResult.box === null) {
        // IFC couldn't fit anything — propagate as a partial result.
        // If nothing was placed yet (empty fragment), return null so parent can apply overflow rule.
        return buildPartialResult(layoutChildren, {
          type: "block",
          resumeChildIndex: i,
          resumeChildToken: ifcResult.breakToken,
        });
      }
      const ifcBox = ifcResult.box;

      const anonBlockSize = ifcBox.height;

      // Append lines directly to layoutChildren (anonymous boxes are layout-time-only).
      for (const line of ifcBox.children) layoutChildren.push(line);

      childBlockOffset += anonBlockSize;
      prevMarginBlockEnd = 0; // anonymous box has no margin

      // If IFC produced a break token, stop here and propagate it.
      if (ifcResult.breakToken !== null) {
        return buildPartialResult(layoutChildren, {
          type: "block",
          resumeChildIndex: i,
          resumeChildToken: ifcResult.breakToken,
        });
      }

      // Reset inlineRunResumeToken after the first inline-run group is processed.
      inlineRunResumeToken = null;
      continue;
    }

    // group.kind === "block"
    const child = group.child;
    if (child.type !== "element") continue;
    if (!child.computedStyle) throw new Error("cascade required");
    const childCs = child.computedStyle;
    const childUsedStyle = computeUsedStyle(childCs, contentInlineSize, "indefinite");

    // In-flow inline-axis margins (CSS box model). An in-flow block child is
    // positioned at logical inline offset `paddingInlineStart +
    // marginInlineStart` and its content box is narrowed by both inline
    // margins. `marginInlineStart`/`marginInlineEnd` default to 0, so for the
    // common (no-inline-margin) document `childInlineStart === paddingInlineStart`
    // and `childContentInlineSize === contentInlineSize` — the values below and
    // every site that consumes them are byte-identical to the pre-margin code.
    //
    // NOTE: this is the IN-FLOW path only. The FLOAT branch below has its own
    // inline-margin handling (the float environment reserves the margin space
    // during placement) — do NOT route floats through these values.
    const childMarginInlineStart = childUsedStyle.marginInlineStart;
    const childMarginInlineEnd   = childUsedStyle.marginInlineEnd;
    const childInlineStart = paddingInlineStart + childMarginInlineStart;
    const childContentInlineSize = contentInlineSize - childMarginInlineStart - childMarginInlineEnd;
    const hasInlineMargin = childMarginInlineStart !== 0 || childMarginInlineEnd !== 0;

    // Reposition a child box laid out at `paddingInlineStart` (relative to its
    // OWN content box of size `childContentInlineSize`) so its outer inline
    // offset is `childInlineStart` measured against the PARENT content box
    // (`contentInlineSize`). This mirrors the FLOAT branch's `withOffsets(...,
    // contentInlineSize)` re-mirror: the child's descendants stay parent-
    // relative to the child's own content box, while the child box itself is
    // positioned (and RTL-mirrored) against the parent's content box.
    //
    // When there is no inline margin this is a pure no-op (same offset, same
    // containing inline size, same width) — so we skip the clone entirely to
    // keep the common path allocation-free.
    function positionChildInline(box: LayoutBox): LayoutBox {
      if (!hasInlineMargin) return box;
      return withOffsets(box, childInlineStart, box.blockOffset, contentInlineSize);
    }

    // FLOAT BRANCH: floated children are out of normal flow.
    // Fragmentation is NOT applied to floats in C.1 (deferred to a later task).
    if (childCs.float === "inline-start" || childCs.float === "inline-end") {
      // Floats shrink-to-fit by default (auto), but also respect intrinsic keywords.
      const available = contentInlineSize - childUsedStyle.marginInlineStart - childUsedStyle.marginInlineEnd;
      let floatInlineSizeForCtx: number;
      if (childCs.inlineSize === "auto") {
        const intrinsic = computeIntrinsicSizes(child, shaper, ctx.intrinsicCache);
        floatInlineSizeForCtx = Math.min(
          intrinsic.maxContent,
          available,
          Math.max(intrinsic.minContent, available),
        );
      } else {
        floatInlineSizeForCtx = resolveBoxInlineSize(childCs, available, true, child, shaper, ctx);
      }
      // Float establishes its own BFC (cs.float !== "none"); pass childCs so
      // makeChildContext detects this and gives the float a fresh float env.
      const floatCtxChild = makeChildContext(ctx, childCs, floatInlineSizeForCtx, "indefinite");
      const floatResult = layoutBlock(child, 0, 0, floatCtxChild, shaper);
      if (floatResult.box === null) {
        throw new Error("layoutBlock without fragmentation returned null box; should be unreachable (no FragmentationContext passed)");
      }
      const floatLayout = floatResult.box;
      const floatExplicitBlockSize = resolveExplicitBlockSize(childCs.blockSize, contentInlineSize);
      const floatInlineSize = floatLayout.width;
      const floatBlockSize = floatExplicitBlockSize > 0 ? floatExplicitBlockSize : floatLayout.height;
      const result = floatEnv.placeFloat(
        childCs.float === "inline-start" ? "inline-start" : "inline-end",
        childBlockOffset,
        floatInlineSize,
        floatBlockSize,
        contentInlineSize,
      );
      const placedInlineOffset = result.inlineOffset;
      const placedBlockOffset = result.blockOffset;

      // Reposition the float at the place returned by floatEnv. Use the
      // `withOffsets` factory helper rather than spread-and-cast — the latter
      // would patch physical `x` / `y` while leaving `inlineOffset` /
      // `blockOffset` stale, breaking the logical↔physical invariant.
      const positioned = withOffsets(
        floatLayout,
        paddingInlineStart + placedInlineOffset,
        placedBlockOffset,
        contentInlineSize,
      );
      assertLayoutBoxConsistent(positioned, contentInlineSize);
      layoutChildren.push(positioned);
      // Float is out of normal flow — do NOT advance childBlockOffset or update prevMarginBlockEnd.
      continue;
    }

    // CLEAR BRANCH: compute clearance.
    let clearanceApplied = 0;
    if (childCs.clear !== "none") {
      const clearedY = floatEnv.clearance(childCs.clear, childBlockOffset);
      if (clearedY > childBlockOffset) {
        clearanceApplied = clearedY - childBlockOffset;
        childBlockOffset = clearedY;
      }
    }

    let childMarginBlockStart = childUsedStyle.marginBlockStart;
    const childMarginBlockEnd   = childUsedStyle.marginBlockEnd;

    // Fragmentation truncation (CSS Fragmentation L4 §5.4): the first child placed
    // on a fresh fragment has its top-margin truncated to 0, since the margin would
    // otherwise span the fragmentation break. This applies to both the initial
    // fragment and resumed fragments (first child of each new fragment).
    if (fragmentation !== undefined && layoutChildren.length === 0) {
      childMarginBlockStart = 0;
    }

    const preAdvanceBlockOffset = childBlockOffset;

    if (clearanceApplied > 0) {
      // CSS 8.3.1: clearance interrupts margin collapse. The box's
      // marginBlockStart adds without collapsing with prev sibling's
      // marginBlockEnd or with parent's marginBlockStart.
      childBlockOffset += childMarginBlockStart;
      // prevMarginBlockEnd is consumed by the clearance — reset so it does not
      // flow through to the next sibling collapse.
      prevMarginBlockEnd = 0;
    } else if (layoutChildren.length > 0) {
      childBlockOffset += Math.max(prevMarginBlockEnd, childMarginBlockStart);
    } else {
      childBlockOffset += noTopBoundary ? 0 : childMarginBlockStart;
    }

    // Break-before consumer (CSS Fragmentation Level 4 §3.4).
    // Only when paginated AND the fragment already has placed content.
    // If the fragment is empty (no preceding placed children), suppress the
    // forced break — a forced break cannot occur before the first piece of
    // content in a fragmentation flow.
    //
    // MUST run BEFORE marker generation below. If the marker were pushed first,
    // (a) `fragmentHasContent` would be spuriously true for the FIRST child (its
    // own marker counts as "preceding content"), and (b) on a real forced break
    // the marker would be orphaned into the partial result AND regenerated when
    // the block resumes on the next page — a double marker, and a double
    // list-counter increment. Deciding the break first means the marker (and the
    // `listCounter++`) only happen once the block is actually placed on this page.
    if (fragmentation !== undefined) {
      const breakBefore = normalizeBreakValue(childCs.breakBefore ?? "auto");
      const fragmentHasContent = layoutChildren.length > 0;
      if (breakBefore === "page" && fragmentHasContent) {
        return buildPartialResult(layoutChildren, {
          type: "block",
          resumeChildIndex: i,
          resumeChildToken: null,
        });
      }
    }

    // Marker generation. Two sources, mutually exclusive:
    //   1. Explicit `markerText` (a `::marker`-content-like presentation string)
    //      — takes precedence, works on ANY display, and does NOT advance the
    //      list-item auto-counter.
    //   2. `display: list-item` auto-counter (resolveMarkerText from
    //      `list-style-type`) — only when no explicit markerText is set.
    // Either way the marker is a GENERATED sibling box, never an offset-bearing
    // inline item, so it adds zero cursor stops.
    let markerText: string | null = null;
    if (childCs.markerText !== undefined && childCs.markerText !== "") {
      markerText = childCs.markerText;
    } else if (childCs.display === "list-item") {
      listCounter++;
      markerText = resolveMarkerText(childCs, listCounter);
    }
    // Auto-widen state (#426). When an `outside` marker is wider than the item's
    // OWN paddingInlineStart (its marker gutter), the item's effective
    // paddingInlineStart is widened so the marker fills the widened gutter
    // instead of hanging LEFT of the item's border edge. Computed in the marker
    // block below and read by the child-layout call so the content shifts right
    // to match. Defaults to the authored padding (no widening) so non-marker /
    // fits-case children are byte-identical.
    let effectivePaddingInlineStart = childUsedStyle.paddingInlineStart;
    if (markerText !== null) {
      // Use a measurer adapter for the simple width/height calls needed for marker boxes.
      const measurer = adaptShaperToMeasurer(shaper);
      const markerInlineSize = measurer.measureWidth(markerText, childCs);
      const markerBlockSize = measurer.measureHeight(childCs);
      const markerGap = 4;
      // Compose the marker against the list-item's CONTENT edge — the
      // inline-start of where the item's own text begins. That edge is the
      // item's outer inline offset (`childInlineStart = parent paddingInlineStart
      // + child marginInlineStart`) PLUS the item's OWN paddingInlineStart.
      //
      // The item's own padding is the structural list-indent / marker gutter in
      // the word-processor leaf model (list membership is a per-paragraph
      // property; the `list-item` leaf carries `paddingInlineStart` itself,
      // there is no wrapping `list` container — see components/list-item.ts).
      // An `outside` marker hangs into that gutter at `contentEdge -
      // markerWidth - markerGap`, landing at a positive offset INSIDE the
      // content column rather than out in the page margin.
      //
      // For the legacy container-wrapped shape (padding on the parent `list`,
      // none on the item) `childUsedStyle.paddingInlineStart === 0`, so this is
      // byte-identical to the pre-leaf marker position.
      //
      // AUTO-WIDEN (#426, Google Docs parity): when the marker + gap is WIDER
      // than the item's OWN paddingInlineStart — i.e.
      // `markerInlineSize + markerGap > childUsedStyle.paddingInlineStart` — the
      // `outside` marker would hang LEFT of `childInlineStart` (the item's border
      // edge), overlapping sibling content / running off the inline-start. The
      // `childInlineStart` term cancels: marker-left
      // `= childInlineStart + padding − markerW − gap ≥ childInlineStart` iff
      // `markerW + gap ≤ padding`. So the gate is on the item's OWN padding, NOT
      // on `childInlineStart + padding` — gating on the latter under-fires for an
      // INDENTED leaf (`marginInlineStart > 0`, so `childInlineStart > 0`), where
      // a marker with `padding < markerW+gap ≤ childInlineStart+padding` would
      // STILL hang left of the border. When it fires, widen the effective
      // paddingInlineStart to exactly `markerInlineSize + markerGap`: the marker
      // lands flush at `childInlineStart` and the content shifts right to match.
      // `inside` markers sit AT the content edge and never hang, so they never
      // widen.
      effectivePaddingInlineStart =
        childCs.listStylePosition !== "inside" &&
        markerInlineSize + markerGap > childUsedStyle.paddingInlineStart
          ? markerInlineSize + markerGap
          : childUsedStyle.paddingInlineStart;
      const effectiveContentEdge = childInlineStart + effectivePaddingInlineStart;
      const markerInlineOffset = childCs.listStylePosition === "inside"
        ? effectiveContentEdge
        : effectiveContentEdge - markerInlineSize - markerGap;
      const markerBox = createMarkerBox(
        `${child.key}-marker`,
        markerInlineOffset, childBlockOffset,
        markerInlineSize, markerBlockSize,
        cs.writingMode, cs.direction,
        childCs, childUsedStyle,
        markerText,
        /* containingInlineSize */ contentInlineSize,
      );
      layoutChildren.push(markerBox);
    }

    // When the marker auto-widened the gutter (#426), lay the child's content
    // out against the WIDENED padding so the content edge matches the marker's
    // new flush position. We clone the child element with a paddingInlineStart-
    // overridden ComputedStyle — ONLY when widened, so the common (fits) case
    // uses the original `child`/`childCs` unchanged and stays byte-identical
    // (including layout-cache reuse, which keys on `child.key` — preserved by
    // the clone). The cloned childCs is used for BOTH the child layout call and
    // `makeChildContext` (padding does not affect BFC detection, but keeping a
    // single childCs identity avoids any drift).
    const widened = effectivePaddingInlineStart > childUsedStyle.paddingInlineStart;
    const layoutChild: ElementBox = widened
      ? Object.freeze({
          ...child,
          computedStyle: Object.freeze({
            ...childCs,
            paddingInlineStart: effectivePaddingInlineStart,
          }),
        })
      : child;
    const layoutChildCs = layoutChild.computedStyle ?? childCs;

    // Pass layoutChildCs (child's own computed style) so makeChildContext can
    // detect whether the child establishes a new BFC and create a fresh float
    // env. The child's containing inline size is its OWN content box, narrowed
    // by its inline margins (`childContentInlineSize`); the parent re-mirrors
    // the resulting box against the parent content box via `positionChildInline`.
    const childCtx = makeChildContext(ctx, layoutChildCs, childContentInlineSize, "indefinite");

    // Derive a FragmentationContext for the child with reduced availableBlockSize.
    // C.7: thread firstChildResumeToken into the FIRST iteration (the resumed child);
    // subsequent iterations get resumeFrom: null (fresh start).
    const childFragmentation: FragmentationContext | undefined =
      fragmentation === undefined
        ? undefined
        : {
            availableBlockSize: fragmentation.availableBlockSize - childBlockOffset,
            pageIndex: fragmentation.pageIndex,
            resumeFrom: i === startIndex ? firstChildResumeToken : null,
          };

    /**
     * CSS Fragmentation L4 §3.5 — overflow rule (C.6):
     * "avoid is preferred but not mandatory; if no valid break point exists,
     *  layout proceeds as if avoid were not set."
     *
     * When this fragment is empty (layoutChildren.length === 0) and child K
     * cannot fit, there is no valid break point before K in this fragment.
     * We re-invoke K's layout without fragmentation and accept the overflowing
     * result. The next sibling will then be pushed to a new fragment via the
     * standard fit-check.
     */
    // Use the (possibly auto-widened, #426) child element so the closure below
    // lays out the content against the same padding the marker positioned
    // against. `layoutChild` is a properly-narrowed `ElementBox` (the original
    // `child` when not widened) — no separate narrowing capture needed.
    function applyOverflowRule(): LayoutBox {
      const fullResult = childCs.display === "table"
        ? layoutTable(layoutChild, paddingInlineStart, childBlockOffset, childCtx, shaper, undefined)
        : layoutBlock(layoutChild, paddingInlineStart, childBlockOffset, childCtx, shaper, undefined);
      if (fullResult.box === null) {
        throw new Error("layout without fragmentation returned null box; unreachable");
      }
      // Re-mirror against the parent content box and apply the inline-start
      // margin offset (no-op when the child has no inline margin).
      return positionChildInline(fullResult.box);
    }

    let childLayout: LayoutBox;
    let childResultBreakToken: BreakToken | null = null;
    if (childCs.display === "table") {
      const tableResult = layoutTable(layoutChild, paddingInlineStart, childBlockOffset, childCtx, shaper, childFragmentation);
      if (tableResult.box === null) {
        // Table couldn't fit anything on this fragment.
        // C.6 overflow rule: if fragment is empty, place it anyway (overflow).
        if (fragmentation !== undefined && layoutChildren.length === 0) {
          const overflowBox = applyOverflowRule();
          layoutChildren.push(overflowBox);
          childBlockOffset += overflowBox.height;
          prevMarginBlockEnd = childUsedStyle.marginBlockEnd;
          continue;
        }
        // Propagate as a break.
        return buildPartialResult(layoutChildren, {
          type: "block",
          resumeChildIndex: i,
          resumeChildToken: tableResult.breakToken,
        });
      }
      childLayout = positionChildInline(tableResult.box);
      childResultBreakToken = tableResult.breakToken;
    } else {
      const childResult = layoutBlock(layoutChild, paddingInlineStart, childBlockOffset, childCtx, shaper, childFragmentation);
      if (childResult.box === null) {
        // Child couldn't fit anything on this fragment.
        // C.6 overflow rule: if fragment is empty, place it anyway (overflow).
        if (fragmentation !== undefined && layoutChildren.length === 0) {
          const overflowBox = applyOverflowRule();
          layoutChildren.push(overflowBox);
          childBlockOffset += overflowBox.height;
          prevMarginBlockEnd = childUsedStyle.marginBlockEnd;
          continue;
        }
        // Propagate as a break.
        return buildPartialResult(layoutChildren, {
          type: "block",
          resumeChildIndex: i,
          resumeChildToken: childResult.breakToken,
        });
      }
      childLayout = positionChildInline(childResult.box);
      childResultBreakToken = childResult.breakToken;
    }

    const explicitBlockSize = resolveExplicitBlockSize(childCs.blockSize, contentInlineSize);
    const finalBlockSize = explicitBlockSize > 0 ? explicitBlockSize : childLayout.height;
    const placedChild = explicitBlockSize > 0
      ? createBlockBox(child.key, childInlineStart, childBlockOffset, childContentInlineSize, finalBlockSize, cs.writingMode, cs.direction, childCs, childUsedStyle, [],
          /* containingInlineSize */ contentInlineSize,
          child.metadata,
        )
      : childLayout;

    // Whole-block fit check: does the placed child fit in remaining space?
    // This check uses the final placed size (after explicit block-size override).
    if (fragmentation !== undefined) {
      const remaining = fragmentation.availableBlockSize - childBlockOffset;
      if (placedChild.height > remaining) {
        // C.6 overflow rule: if fragment is empty, place it anyway (overflow).
        if (layoutChildren.length === 0) {
          layoutChildren.push(placedChild);
          childBlockOffset += placedChild.height;
          prevMarginBlockEnd = childUsedStyle.marginBlockEnd;
          continue;
        }
        return buildPartialResult(layoutChildren, {
          type: "block",
          resumeChildIndex: i,
          resumeChildToken: null,
        });
      }
    }

    // Propagate child break token if the child itself was mid-fragmenting.
    if (childResultBreakToken !== null) {
      // Break-inside: avoid (CSS Fragmentation L4 §3.5): discard the partial
      // fragment and push the whole child to the next fragment instead.
      if (fragmentation !== undefined) {
        const breakInside = normalizeBreakValue(childCs.breakInside ?? "auto");
        if (breakInside === "avoid") {
          // C.6 overflow rule: if fragment is empty, re-invoke without fragmentation
          // and place the whole child, accepting the overflow.
          if (layoutChildren.length === 0) {
            const overflowBox = applyOverflowRule();
            layoutChildren.push(overflowBox);
            childBlockOffset += overflowBox.height;
            prevMarginBlockEnd = childUsedStyle.marginBlockEnd;
            continue;
          }
          return buildPartialResult(layoutChildren, {
            type: "block",
            resumeChildIndex: i,
            resumeChildToken: null,
          });
        }
      }
      layoutChildren.push(placedChild);
      childBlockOffset += placedChild.height;
      return buildPartialResult(layoutChildren, {
        type: "block",
        resumeChildIndex: i,
        resumeChildToken: childResultBreakToken,
      });
    }

    // CSS empty-block rule: a block with no content, padding, border, or explicit height
    // has its top and bottom margins collapsed together. The combined margin is passed to
    // the next sibling collapse, and the empty block does not advance childBlockOffset.
    const childPaddingV = childUsedStyle.paddingBlockStart + childUsedStyle.paddingBlockEnd;
    const childBorderV  = childUsedStyle.borderBlockStartWidth + childUsedStyle.borderBlockEndWidth;
    const childExplicitBlockSize = resolveExplicitBlockSizeOrNull(childCs.blockSize, contentInlineSize);
    const isEmpty = (childExplicitBlockSize === null || childExplicitBlockSize === 0)
                 && childPaddingV === 0
                 && childBorderV === 0
                 && childLayout.height === 0;

    if (isEmpty) {
      // Undo the marginBlockStart advance; the combined margin is held for the next sibling collapse
      childBlockOffset = preAdvanceBlockOffset;
      prevMarginBlockEnd = Math.max(prevMarginBlockEnd, childMarginBlockStart, childMarginBlockEnd);
      // Place the empty block at preAdvanceBlockOffset (zero height, no y-slot consumed).
      //
      // L-F / A7 followup: use placedChild.inlineSize (the resolved
      // inline size, including explicit 0) instead of contentInlineSize
      // (the parent's content width). Pre-fix, this branch silently
      // re-widened an explicit inlineSize: 0 to the parent's full
      // content width, defeating the same intentional-zero authoring
      // that the resolveBoxInlineSize fix protects.
      layoutChildren.push(
        createBlockBox(child.key, childInlineStart, preAdvanceBlockOffset, placedChild.inlineSize, 0, cs.writingMode, cs.direction, childCs, childUsedStyle, [],
          /* containingInlineSize */ contentInlineSize,
          child.metadata,
        ),
      );
    } else {
      layoutChildren.push(placedChild);
      childBlockOffset += placedChild.height;
      prevMarginBlockEnd = childMarginBlockEnd;
    }

    // Break-after consumer (CSS Fragmentation Level 4 §3.5).
    // Only when paginated AND there are remaining children to displace.
    // If the child was mid-fragmenting, we already returned early above.
    if (fragmentation !== undefined) {
      const breakAfter = normalizeBreakValue(childCs.breakAfter ?? "auto");
      const hasMoreChildren = i + 1 < groups.length;
      if (breakAfter === "page" && hasMoreChildren) {
        return buildPartialResult(layoutChildren, {
          type: "block",
          resumeChildIndex: i + 1,
          resumeChildToken: null,
        });
      }
    }
  }

  const lastMarginBlockEnd = noBottomBoundary ? 0 : prevMarginBlockEnd;
  const inFlowBlockSize = childBlockOffset + lastMarginBlockEnd + paddingBlockEnd;

  // FLOAT ENCLOSURE: only a BFC root encloses its own floats. A non-BFC block
  // shares the parent BFC's float env — its floats belong to the ancestor BFC,
  // so this block's height is determined solely by in-flow content.
  let totalBlockSize: number;
  if (isOwnBFC) {
    const floatBlockEnd = floatEnv.lowestFloatBlockEdge();
    totalBlockSize = Math.max(inFlowBlockSize, floatBlockEnd + paddingBlockEnd);
  } else {
    totalBlockSize = inFlowBlockSize;
  }

  return { box: createBlockBox(
    node.key, inlineOffset, blockOffset, finalInlineSize, totalBlockSize, writingMode, direction, cs, usedStyle, layoutChildren,
    /* containingInlineSize */ availableInlineSize,
    node.metadata,
  ), breakToken: null };
  } finally {
    markEnd("bfc.layoutBlock", t);
  }
}

/**
 * Resolve the inline-size of a box, handling CSS Sizing 3 intrinsic-sizing keywords
 * (min-content, max-content, fit-content) as well as auto, number, and percent lengths.
 *
 * @param isShrinkToFit  true for shrink-to-fit contexts (inline-block, floats, etc.)
 *   — used only when the keyword is "auto" to decide fill vs. shrink.
 */
function resolveBoxInlineSize(
  cs: ComputedStyle,
  containingInlineSize: number,
  isShrinkToFit: boolean,
  node: ElementBox,
  shaper: TextShaper,
  ctx: LayoutContext,
): number {
  const v = cs.inlineSize;
  if (v === "min-content") {
    const intrinsic = computeIntrinsicSizes(node, shaper, ctx.intrinsicCache);
    return intrinsic.minContent;
  }
  if (v === "max-content") {
    const intrinsic = computeIntrinsicSizes(node, shaper, ctx.intrinsicCache);
    return intrinsic.maxContent;
  }
  if (v === "fit-content") {
    const intrinsic = computeIntrinsicSizes(node, shaper, ctx.intrinsicCache);
    return Math.min(
      intrinsic.maxContent,
      Math.max(intrinsic.minContent, containingInlineSize),
    );
  }
  if (v === "auto") {
    if (isShrinkToFit) {
      const intrinsic = computeIntrinsicSizes(node, shaper, ctx.intrinsicCache);
      return Math.min(
        intrinsic.maxContent,
        Math.max(intrinsic.minContent, containingInlineSize),
      );
    }
    return containingInlineSize; // fill
  }
  // ComputedLength (number or percent)
  //
  // L-F / A7: only NEGATIVE resolved values fall back to containing
  // inline size. Zero is a valid CSS value — e.g., a collapsed column
  // header, a zero-width spacer, or an explicitly hidden inline box.
  // The previous `resolved > 0` check silently turned `inlineSize: 0`
  // into `inlineSize: auto` (full-width), defeating intentional zero-
  // size authoring.
  const resolved = resolveUsedLength(v, containingInlineSize, containingInlineSize);
  return resolved < 0 ? containingInlineSize : resolved;
}

/**
 * Resolve an explicit block-size for layout (returns 0 for "auto" or intrinsic keywords,
 * which means "use content height").
 */
function resolveExplicitBlockSize(
  blockSize: ComputedStyle["blockSize"],
  containingInlineSize: number,
): number {
  if (blockSize === "auto" || blockSize === "min-content" || blockSize === "max-content" || blockSize === "fit-content") {
    return 0;
  }
  return resolveUsedLength(blockSize, containingInlineSize, 0);
}

/**
 * Resolve an explicit block-size, returning null for "auto" or intrinsic keywords.
 * Used to distinguish "no explicit size given" from "explicit size of 0".
 */
function resolveExplicitBlockSizeOrNull(
  blockSize: ComputedStyle["blockSize"],
  containingInlineSize: number,
): number | null {
  if (blockSize === "auto" || blockSize === "min-content" || blockSize === "max-content" || blockSize === "fit-content") {
    return null;
  }
  return resolveUsedLength(blockSize, containingInlineSize, 0);
}

function resolveMarkerText(cs: ComputedStyle, counter: number): string | null {
  const lst = cs.listStyleType;
  if (lst === "none") return null;
  if (typeof lst === "object") return lst.content;
  switch (lst) {
    case "disc":   return "•";
    case "circle": return "○";
    case "square": return "▪";
    case "decimal":
    case "lower-alpha":
    case "upper-alpha":
    case "lower-roman":
    case "upper-roman":
      return formatCounter(counter, lst);
    default: {
      // Exhaustiveness check: if a new ListStyleType literal is added, this
      // forces TS to flag the missing case here instead of silently returning
      // null. Closes Plan 1 F7.x preexisting unreachable-code diagnostic.
      const _exhaustive: never = lst;
      return _exhaustive;
    }
  }
}
