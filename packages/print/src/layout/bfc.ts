import type { ElementBox } from "@taleweaver/core";
import type { LayoutBox, BlockBox } from "./layout-box";
import { createBlockBox, createMarkerBox, withOffsets, assertLayoutBoxConsistent } from "./layout-box";
import type { BlockBreakToken, BreakToken, FragmentationContext, LayoutResult } from "./fragmentation";
import { normalizeBreakValue } from "./fragmentation";
import { layoutInlineContent } from "./ifc";
import { layoutTable } from "./table-fc";
import type { TextShaper } from "@taleweaver/core";
import type { Hyphenator } from "@taleweaver/core";
import { adaptShaperToMeasurer } from "@taleweaver/core";
import type { ComputedStyle } from "@taleweaver/core";
import type { WritingMode, Direction } from "@taleweaver/core";
import { logicalToPhysical } from "@taleweaver/core";
import { computeUsedStyle, resolveUsedLength } from "./used-style";
import type { LayoutContext } from "./layout-context";
import { makeChildContext } from "./layout-context";
import type { FloatEnvironment, PushedFloat } from "./float-context";
import type { PendingAbsChild } from "./abs-pos-context";
import { computeIntrinsicSizes } from "./intrinsic-sizes-pass";
import { groupChildren, anonymousBlockKey } from "./group-children";
import { isLayoutBoxReusable, renderNodesLayoutEquivalent } from "./layout-reuse";
import { markStart, markEnd } from "@taleweaver/core";

/**
 * Resolve a `ComputedLength | "auto"` inset against a containing-block axis size.
 * `"auto"` → 0 (no contribution). A `number` is px. A `{unit:"percent"}` resolves
 * against `axisSize` UNLESS `axisSize` is `"indefinite"` (the containing block has
 * no definite size on this axis), in which case the percent resolves to 0 — CSS
 * Positioned Layout §5: a percentage block-inset against an indefinite-height
 * containing block computes to `auto`. (A px inset still applies; only the percent
 * form is suppressed.)
 */
function resolveInset(
  value: ComputedStyle["insetInlineStart"],
  axisSize: number | "indefinite",
): number {
  if (value === "auto") return 0;
  if (typeof value === "number") return value;
  // percent
  if (axisSize === "indefinite") return 0;
  return resolveUsedLength(value, axisSize, 0);
}

/**
 * POSITIONING slice 2 — resolve the physical `position: relative` paint-time
 * offset for a box from its logical `inset*`, against its containing block.
 *
 * The relative box keeps its in-flow geometry; this is a SEPARATE physical
 * `(dx, dy)` delta the painter adds to the box's accumulated origin (shifting the
 * box and its descendants together). Resolved HERE, in layout, because percent
 * insets need both axis bases of the containing block (CSS resolves
 * `inset-inline-*` against inline size, `inset-block-*` against block size — two
 * distinct bases), which paint does not have.
 *
 * Logical→physical: the (inlineDelta, blockDelta) logical pair is mapped through
 * the SAME `logicalToPhysical` machinery the box uses for its physical x/y, so the
 * offset is writing-mode- and direction-correct (including the vertical-rl block-
 * axis reversal). Because a translation is constant-free, the mapping is computed
 * as the difference of the origin and the shifted point — the containing-block
 * sizes used for any mirror cancel, so a `0` is safe when block-size is indefinite.
 *
 * Returns `undefined` when `position !== "relative"` OR both deltas resolve to 0,
 * keeping the un-positioned fast path allocation-free.
 */
function resolveRelativeOffset(
  cs: ComputedStyle,
  writingMode: WritingMode,
  direction: Direction,
  containingInlineSize: number,
  containingBlockSize: number | "indefinite",
): { readonly dx: number; readonly dy: number } | undefined {
  if (cs.position !== "relative") return undefined;

  // Inline axis: inset-inline-start wins over inset-inline-end (CSS). A non-auto
  // start adds +start; else a non-auto end adds −end; else 0.
  let inlineDelta = 0;
  if (cs.insetInlineStart !== "auto") {
    inlineDelta = resolveInset(cs.insetInlineStart, containingInlineSize);
  } else if (cs.insetInlineEnd !== "auto") {
    inlineDelta = -resolveInset(cs.insetInlineEnd, containingInlineSize);
  }

  // Block axis: symmetric, against the containing-block BLOCK size.
  let blockDelta = 0;
  if (cs.insetBlockStart !== "auto") {
    blockDelta = resolveInset(cs.insetBlockStart, containingBlockSize);
  } else if (cs.insetBlockEnd !== "auto") {
    blockDelta = -resolveInset(cs.insetBlockEnd, containingBlockSize);
  }

  if (inlineDelta === 0 && blockDelta === 0) return undefined;

  // Map the logical (inlineDelta, blockDelta) to a physical (dx, dy) by taking the
  // difference of the shifted point and the origin under the box's own
  // logicalToPhysical mapping. A concrete containing-block size for the vertical-rl
  // mirror is irrelevant (it cancels in the difference) — pass 0 when indefinite.
  const cbSizeForMirror = containingBlockSize === "indefinite" ? 0 : containingBlockSize;
  const origin = logicalToPhysical(
    { inlineOffset: 0, blockOffset: 0, inlineSize: 0, blockSize: 0 },
    writingMode, direction, containingInlineSize, cbSizeForMirror,
  );
  const shifted = logicalToPhysical(
    { inlineOffset: inlineDelta, blockOffset: blockDelta, inlineSize: 0, blockSize: 0 },
    writingMode, direction, containingInlineSize, cbSizeForMirror,
  );
  return { dx: shifted.x - origin.x, dy: shifted.y - origin.y };
}

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
  // Auto-hyphenation (slice 2): threaded ALONGSIDE `shaper` to every site that
  // tokenizes text, so the (slice 4) producer can read it at `collectInlineTokens`.
  // `undefined` ⇒ no hyphenation. Carried but UNUSED in this slice.
  hyphenator: Hyphenator | undefined,
  fragmentation?: FragmentationContext,
  // Coherent float+pagination: cumulative document-flow offset of this page's
  // content top (Σ prior pages' `inFlowConsumed`). Feeds `blockFlowBase =
  // pageFlowBase + nestedOrigin`, which expresses every float-env interaction
  // (`placeFloat` / `clearance` / `lowestFloatBlockEdge` enclosure) and the IFC
  // `paraFlowStart` stamp in the global cumulative frame, so a float narrows the
  // page it actually sits on. The `= 0` default keeps the page root + every
  // non-paginated caller byte-identical (page 0 / no-float ⇒ `blockFlowBase = 0`).
  pageFlowBase: number = 0,
): LayoutResult<BlockBox> {
  const t = markStart("bfc.layoutBlock");
  try {
  const availableInlineSize = ctx.containingInlineSize;
  const writingMode = ctx.writingMode;
  const direction = ctx.direction;
  if (!node.computedStyle) throw new Error("cascade required");
  const cs = node.computedStyle;

  // POSITIONING slice 2 — `position: relative` paint-time offset. Resolved here
  // (in layout), where this box's containing-block inline + block sizes are in
  // hand (the two distinct percent bases for inset-inline-* vs inset-block-*).
  // `undefined` for the un-positioned common case (zero-cost). The box geometry
  // stays pre-offset; the painter adds this physical delta. NOTE the cache-reuse
  // fast paths below preserve `entry.box.relativeOffset` rather than recomputing
  // it: a cached box was laid out with the same cs/containing sizes, so its stored
  // offset is still correct, and the reposition-clone re-attaches it verbatim.
  const relativeOffset = resolveRelativeOffset(
    cs, writingMode, direction, availableInlineSize, ctx.containingBlockSize,
  );

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
          return { box: entry.box, breakToken: null, inFlowConsumed: entry.inFlowConsumed };
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
            /* containingBlockSize */ undefined,
            // Preserve the `position: relative` paint-time offset across the
            // reposition clone (slice 2): the offset is a physical delta added
            // at paint, independent of the outer (inlineOffset, blockOffset)
            // reposition, so it carries through verbatim.
            entry.box.relativeOffset,
            // Preserve abs-pos children across the reposition clone (slice 3):
            // they are positioned in this box's own frame, independent of the
            // outer reposition, so they carry through verbatim. A dropped clone
            // here would silently lose the abs subtree on cache reuse.
            entry.box.absoluteChildren,
            // Preserve the in-flow-consumed scalar across the reposition clone:
            // it is intrinsic to the box's content (independent of the outer
            // reposition), so it carries through verbatim — keeping the cloned
            // box's own `inFlowConsumed` exact for any downstream cache rebuild.
            entry.box.inFlowConsumed,
          ),
          breakToken: null,
          inFlowConsumed: entry.inFlowConsumed,
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

  // Coherent float+pagination: cumulative document-flow offset of THIS BFC's
  // `childBlockOffset === 0` origin (the content top of this box). For the page
  // root BFC that origin is the page's content top, whose cumulative flow offset
  // is `pageFlowBase` (sum of prior pages' `inFlowConsumed`); a NESTED BFC adds
  // its origin within the page (`ctx.originFromAbc.blockOffset`). A child's
  // cumulative flow offset is then `blockFlowBase + childBlockOffset`.
  //
  // Float placement, clearance, the IFC float query (via `paraFlowStart`), and
  // the BFC float-enclosure edge are ALL expressed in this cumulative frame, so
  // a float's line-narrowing applies to the lines beside/below it on the page
  // where it ACTUALLY SITS — across page boundaries — instead of being displaced
  // ~1 page. Box geometry stays page-relative: every consumer subtracts
  // `blockFlowBase` back off the cumulative float-env result (placeFloat return,
  // clearance, lowestFloatBlockEdge enclosure) before writing a box offset/height.
  //
  // LOCKSTEP with the measure pass: `paraFlowStart` is stamped CUMULATIVE here AND
  // in `fit-core`'s IFC producers (which receive the page-cumulative `contentFlowBase`
  // from the measure pass). The two passes' resume tokens are compared field-for-field
  // by `breakTokensEqual` at the measure↔materialize agreement gate
  // (`virtual-layout-tree.ts`) and the equivalence oracle, so both stamps MUST be the
  // same cumulative value.
  //
  // KNOWN LIMITATION: `ctx.originFromAbc.blockOffset` resets to 0 at an
  // absolute-containing-block boundary (`position: relative` / transforms), so a
  // float nested under such an ancestor would read a low base. Current float docs
  // use top-level floats (`nestedOrigin === 0`), where this is exact.
  const nestedOrigin = ctx.isBFCRoot ? 0 : ctx.originFromAbc.blockOffset;
  const blockFlowBase = pageFlowBase + nestedOrigin;

  let prevMarginBlockEnd = 0;

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

  // (List numbering is no longer counted in the BFC. The list-item marker is a
  // render-baked `markerText` on the cascaded ComputedStyle — produced by the
  // render-time numbering service (`numbering/`) and emitted by the list-item
  // component — so it is identical on every fragment and needs no seed/replay
  // across page boundaries. The BFC only READS `childCs.markerText` below.)

  /**
   * Build a partial LayoutResult<BlockBox> from the children placed so far
   * and a non-null break token. Used when fragmentation stops the loop early.
   */
  function buildPartialResult(
    placedChildren: LayoutBox[],
    breakToken: BlockBreakToken,
  ): LayoutResult<BlockBox> {
    if (placedChildren.length === 0) {
      return { box: null, breakToken, inFlowConsumed: 0 };
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
      // Coherent float+pagination: `lowestFloatBlockEdge()` is now a CUMULATIVE
      // edge; the box-enclosure height is PAGE-RELATIVE, so subtract `blockFlowBase`.
      const floatBlockEnd = floatEnv.lowestFloatBlockEdge();
      totalBlockSizePartial = Math.max(inFlowBlockSizePartial, (floatBlockEnd - blockFlowBase) + paddingBlockEnd);
    } else {
      totalBlockSizePartial = inFlowBlockSizePartial;
    }
    return {
      box: createBlockBox(
        node.key, inlineOffset, blockOffset, finalInlineSize, totalBlockSizePartial,
        writingMode, direction, cs, usedStyle, placedChildren,
        /* containingInlineSize */ availableInlineSize,
        node.metadata,
        /* containingBlockSize */ undefined,
        relativeOffset,
        // TODO (positioning v1 edge): abs-pos children registered into this box's
        // own abc BEFORE this fragmentation break are NOT drained onto the partial
        // box — the abs-pos second pass (which builds `absoluteChildren`) only runs
        // on the FULL, non-fragmented return below, never on a partial result. They
        // remain in `ctx.absoluteContainingBlock.pending` and are abandoned.
        // Correct behavior would drain the abs children whose static position falls
        // in this placed fragment onto this box (and carry the rest to the resumed
        // fragment). Tracked as a named v1 follow-up (spec §6, slice 3). No
        // `absoluteChildren` arg here, hence the omission is deliberate.
        /* absoluteChildren */ undefined,
        // Carry the partial-fragment in-flow-consumed scalar ON THE BOX (mirrors
        // the full-return site) so the cache reads it back EXACTLY.
        inFlowBlockSizePartial,
      ),
      breakToken,
      inFlowConsumed: inFlowBlockSizePartial,
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

    // `i < groups.length` (loop bound) ⇒ `groups[i]` is always present; the
    // throw is an unreachable invariant guard that also restores the
    // discriminated-union narrowing on `group.kind` below.
    const group = groups[i];
    if (group === undefined) throw new Error(`bfc: groups[${i}] missing (unreachable)`);
    if (group.kind === "inline-run") {
      // Synthesize an anonymous ElementBox for this inline-run group and lay it out via IFC.
      const anonKey = anonymousBlockKey(node.key, group.positionalIndex);
      // #432: CSS2 §16.1 — `text-indent` indents the first line of an anonymous
      // block box ONLY when that anon block is its parent's first child (the
      // block's first formatted line). The LEADING inline run is the first group
      // (`i === 0`); a run at `i > 0` is always preceded by a block group
      // (`groupChildren` coalesces consecutive inline children into one group),
      // so it is NOT the first child and must NOT be indented. Suppress the
      // indent on non-leading runs by zeroing `textIndent` on their anon style.
      const anonCs: ComputedStyle =
        i === 0 ? cs : Object.freeze({ ...cs, textIndent: 0 });
      const anonElement: ElementBox = Object.freeze({
        type: "element" as const,
        key: anonKey,
        style: node.style,
        computedStyle: anonCs,
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

      // Coherent float+pagination: the paragraph's first-line CUMULATIVE
      // document-flow offset, carried across page fragments. For a FRESH
      // paragraph it is `blockFlowBase + childBlockOffset` (the cumulative
      // position of where this paragraph begins on this page). For a RESUMED
      // paragraph it is a FIXED property of where the paragraph ORIGINALLY began,
      // carried verbatim from the resume token: directly when the token is an
      // `ifc`, or from the child token when it is a `block` whose
      // `resumeChildToken` is `ifc`. The IFC queries the float env at
      // `paraFlowStart + (lineBlockOffset - blockOffset)` (the line's true
      // cumulative offset), so every fragment of the paragraph re-wraps with the
      // SAME narrowing it got on its start page. Stamped CUMULATIVE here AND in
      // `fit-core`'s IFC producers (lockstep — see the `blockFlowBase` comment),
      // so the measure↔materialize resume tokens agree field-for-field.
      let paraFlowStart = blockFlowBase + childBlockOffset;
      if (ifcResumeFrom !== null) {
        if (ifcResumeFrom.type === "ifc") {
          paraFlowStart = ifcResumeFrom.paraFlowStart;
        } else if (
          ifcResumeFrom.type === "block" &&
          ifcResumeFrom.resumeChildToken !== null &&
          ifcResumeFrom.resumeChildToken.type === "ifc"
        ) {
          paraFlowStart = ifcResumeFrom.resumeChildToken.paraFlowStart;
        }
      }

      const ifcResult = layoutInlineContent(anonElement, paddingInlineStart, childBlockOffset, ifcCtx, shaper, hyphenator, paraFlowStart, ifcFragmentation);
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

      const anonBlockSize = ifcBox.blockSize;

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
    if (childCs.float === "inline-start" || childCs.float === "inline-end") {
      // Coherent float+pagination: a float establishes its OWN BFC with a FRESH
      // float env, so its inner content queries that empty env — its cumulative
      // base is inert for the page's shared env. Thread `blockFlowBase +
      // childBlockOffset` (the float's cumulative origin) so its inner paragraphs'
      // `paraFlowStart` is correct in the float's own frame.
      const requestedCumulativeOffset = blockFlowBase + childBlockOffset;
      const sized = sizeFloat(
        child, childCs, childUsedStyle, ctx, shaper, hyphenator,
        contentInlineSize, requestedCumulativeOffset,
      );

      // #528 cross-page float PUSHING (producer). When fragmenting on the
      // VIRTUALIZED fast-path (`enableFloatPushing` — the legacy `paginateRoot`
      // opts OUT, retaining overflow), decide whether the float fits the
      // remaining page space at its ACTUAL landing offset — `peekPlaceFloat`
      // runs the same push-below loop as `placeFloat` (a same-side float can
      // shove this one lower, past the page bottom), so the fit check must use
      // the peeked landing, not the requested offset.
      if (fragmentation !== undefined && fragmentation.enableFloatPushing === true) {
        const landing = floatEnv.peekPlaceFloat(
          sized.side, requestedCumulativeOffset, sized.floatInlineSize, contentInlineSize,
        );
        const landingPageRel = landing.blockOffset - blockFlowBase;
        // "Page is empty" = nothing in-flow placed yet AND no floats placed
        // (neither seeded active shadows NOR pushed floats landed this page). On
        // an empty page we PLACE anyway (overflow) so a float taller than a whole
        // page lands once and never re-pushes infinitely — the documented bound.
        const pageEmpty = layoutChildren.length === 0 && floatEnv.getPlacedFloats().length === 0;
        if (landingPageRel + sized.floatBlockSize > fragmentation.availableBlockSize && !pageEmpty) {
          // Defer the WHOLE float to the next page: record it (sizes recomputed
          // on the landing page) and KEEP FLOWING in-flow content here. Do NOT
          // place, do NOT advance `childBlockOffset`, do NOT break the loop. The
          // discarded `sized` box is dropped (its inner layout has no in-flow
          // side effects — floats are out of flow; see design Option C).
          floatEnv.pushFloat({ node: child, side: sized.side });
          continue;
        }
      }

      // Coherent float+pagination: place at the float's CUMULATIVE document-flow
      // offset so its exclusion stacks in the same frame the IFC queries; the
      // box geometry is repositioned back to PAGE-RELATIVE inside the helper.
      const positioned = placeAndPositionFloat(
        sized, childCs, floatEnv, paddingInlineStart, contentInlineSize,
        blockFlowBase, requestedCumulativeOffset,
      );
      layoutChildren.push(positioned);
      // Float is out of normal flow — do NOT advance childBlockOffset or update prevMarginBlockEnd.
      continue;
    }

    // ABS-POS BRANCH (POSITIONING slice 3): an absolutely-positioned child is
    // OUT OF FLOW. Mirror the float branch: skip
    // ALL in-flow placement (no `childBlockOffset` advance, no margin collapse, no
    // `prevMarginBlockEnd` update), capture its STATIC position (where the in-flow
    // algorithm WOULD place it — `childInlineStart` on the inline axis,
    // `childBlockOffset` on the block axis, both pre-advance), and register it into
    // the current abc's pending-list for the second pass to drain. The static
    // position is expressed in the abc's coordinate frame by adding
    // `ctx.originFromAbc` (zero for a direct child of the establishing box; the
    // accumulated intervening offsets for a deeper in-flow descendant), so the
    // `auto`-inset fallback lands in the same frame the resolved insets produce.
    // `continue` exactly like the float branch.
    if (childCs.position === "absolute") {
      ctx.absoluteContainingBlock.pending.register({
        node: child,
        computedStyle: childCs,
        usedStyle: childUsedStyle,
        staticInlineOffset: ctx.originFromAbc.inlineOffset + childInlineStart,
        staticBlockOffset:  ctx.originFromAbc.blockOffset  + childBlockOffset,
      });
      continue;
    }

    // CLEAR BRANCH: compute clearance.
    let clearanceApplied = 0;
    if (childCs.clear !== "none") {
      // Coherent float+pagination: query clearance in the CUMULATIVE frame, then
      // translate the cumulative cleared offset back to page-relative before
      // comparing/writing `childBlockOffset`.
      const clearedY = floatEnv.clearance(childCs.clear, blockFlowBase + childBlockOffset) - blockFlowBase;
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
    // the block resumes on the next page — a double marker. Deciding the break
    // first means the marker is emitted only once the block is actually placed on
    // this page. (List numbering itself is computed in the render pass now — the
    // BFC only consumes the baked `markerText`; it no longer counts.)
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

    // Marker generation. The marker is the render-baked `markerText` on the
    // cascaded ComputedStyle (produced by the render-time numbering service +
    // the list-item component — numbering, restart, and the #425 consecutive-run
    // rule all live there now, not in the BFC). It is a GENERATED sibling box,
    // never an offset-bearing inline item, so it adds zero cursor stops. Empty/
    // absent markerText → no marker (a non-list block, or a list-item the
    // numbering pass didn't number).
    let markerText: string | null = null;
    if (childCs.markerText !== undefined && childCs.markerText !== "") {
      markerText = childCs.markerText;
    }
    // #431: a list-item whose content STRADDLES a page break must emit its
    // marker only on the page where it STARTS — NOT on both the origin-page tail
    // and the resume-page head. The resuming fragment is the FIRST child of the
    // resumed BFC (`i === startIndex`) carrying a non-null resume token (a
    // MID-CONTENT continuation; a null token at startIndex means a clean child
    // boundary where the fresh child SHOULD show its marker). Google-Docs parity:
    // a split list-item's continuation has no marker. The baked `markerText` is
    // identical on every fragment (it is position-derived once, at render time),
    // so suppressing the marker BOX on the continuation is all that is needed.
    //
    // #501 — degenerate-resume EXCEPTION: a resume from the very START (the prior
    // page placed ZERO content for this item — `resumeAtLine === 0`, an inner
    // token classified degenerate by `isResumeFromDegenerate`) means THIS page is
    // where the item actually starts, so it MUST show its marker. Only a
    // GENUINELY mid-content continuation (`resumeAtLine > 0`) suppresses it.
    // Without this carve-out, an item that landed at the prior page's bottom with
    // no room for even its first line would have its marker orphaned on the prior
    // page (the deferred-push fix below prevents the orphan) AND suppressed here —
    // leaving the item with no marker at all.
    const isResumeFragment =
      i === startIndex &&
      firstChildResumeToken !== null &&
      !isResumeFromDegenerate(firstChildResumeToken);
    // Auto-widen state (#426). When an `outside` marker is wider than the item's
    // OWN paddingInlineStart (its marker gutter), the item's effective
    // paddingInlineStart is widened so the marker fills the widened gutter
    // instead of hanging LEFT of the item's border edge. Computed in the marker
    // block below and read by the child-layout call so the content shifts right
    // to match. Defaults to the authored padding (no widening) so non-marker /
    // fits-case children are byte-identical.
    let effectivePaddingInlineStart = childUsedStyle.paddingInlineStart;
    // #501 — DEFERRED marker box. Built here (so the auto-widen math runs), but
    // NOT pushed onto `layoutChildren` yet: a marker pushed before the child's
    // content is laid out would (a) make `layoutChildren.length` non-zero, hiding
    // an empty fragment from the C.6 overflow checks (so a first-child list-item
    // that overflows would break instead of being placed), and (b) orphan onto a
    // fragment where the item ends up placing ZERO content. Instead it is pushed
    // FIRST (before the content box) at EVERY site that places the item's content
    // on THIS fragment — and never on a fragment where the content didn't land.
    let markerBox: LayoutBox | null = null;
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
      // #431: still compute the auto-widen above on the resume fragment so the
      // split item's CONTINUATION content keeps the same content edge as the
      // origin fragment (the wrapped tail must align with the head). Only the
      // marker BOX is suppressed — a mid-content continuation emits NO marker
      // (a degenerate-resume / from-the-start fragment IS the item's start, so
      // `isResumeFragment` is false there and the marker is built — #501).
      if (!isResumeFragment) {
        const effectiveContentEdge = childInlineStart + effectivePaddingInlineStart;
        const markerInlineOffset = childCs.listStylePosition === "inside"
          ? effectiveContentEdge
          : effectiveContentEdge - markerInlineSize - markerGap;
        markerBox = createMarkerBox(
          `${child.key}-marker`,
          markerInlineOffset, childBlockOffset,
          markerInlineSize, markerBlockSize,
          cs.writingMode, cs.direction,
          childCs, childUsedStyle,
          markerText,
          /* containingInlineSize */ contentInlineSize,
        );
        // NOT pushed here (#501 deferral) — see every content-push site below.
      }
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
    //
    // POSITIONING slice 3: pass the child's in-flow frame origin
    // `(childInlineStart, childBlockOffset)` as `contentOrigin` so that a NESTED
    // abs-pos descendant of this (non-establishing) child captures its static
    // position in the abc's frame (`makeChildContext` accumulates it onto
    // `originFromAbc`). When THIS child establishes an abc, `makeChildContext`
    // resets the accumulator to `{0, 0}`, so the origin is harmlessly ignored.
    const childCtx = makeChildContext(ctx, layoutChildCs, childContentInlineSize, "indefinite", {
      inlineOffset: childInlineStart,
      blockOffset: childBlockOffset,
    });

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
        ? layoutTable(layoutChild, paddingInlineStart, childBlockOffset, childCtx, shaper, hyphenator, undefined, pageFlowBase)
        : layoutBlock(layoutChild, paddingInlineStart, childBlockOffset, childCtx, shaper, hyphenator, undefined, pageFlowBase);
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
      const tableResult = layoutTable(layoutChild, paddingInlineStart, childBlockOffset, childCtx, shaper, hyphenator, childFragmentation, pageFlowBase);
      if (tableResult.box === null) {
        // Table couldn't fit anything on this fragment.
        // C.6 overflow rule: if fragment is empty, place it anyway (overflow).
        if (fragmentation !== undefined && layoutChildren.length === 0) {
          const overflowBox = applyOverflowRule();
          if (markerBox !== null) layoutChildren.push(markerBox);
          layoutChildren.push(overflowBox);
          childBlockOffset += overflowBox.blockSize;
          prevMarginBlockEnd = childUsedStyle.marginBlockEnd;
          continue;
        }
        // Propagate as a break (#501: marker NOT pushed — the item placed nothing
        // on this fragment, so it must not be orphaned here).
        return buildPartialResult(layoutChildren, {
          type: "block",
          resumeChildIndex: i,
          resumeChildToken: tableResult.breakToken,
        });
      }
      childLayout = positionChildInline(tableResult.box);
      childResultBreakToken = tableResult.breakToken;
    } else {
      // Coherent float+pagination: thread the page-cumulative flow base into the
      // nested block so its `blockFlowBase` (= pageFlowBase + its accumulated
      // origin-from-abc) is cumulative, matching the page-root frame the IFC float
      // query and float placement use.
      const childResult = layoutBlock(layoutChild, paddingInlineStart, childBlockOffset, childCtx, shaper, hyphenator, childFragmentation, pageFlowBase);
      if (childResult.box === null) {
        // Child couldn't fit anything on this fragment.
        // C.6 overflow rule: if fragment is empty, place it anyway (overflow).
        if (fragmentation !== undefined && layoutChildren.length === 0) {
          const overflowBox = applyOverflowRule();
          if (markerBox !== null) layoutChildren.push(markerBox);
          layoutChildren.push(overflowBox);
          childBlockOffset += overflowBox.blockSize;
          prevMarginBlockEnd = childUsedStyle.marginBlockEnd;
          continue;
        }
        // Propagate as a break (#501: marker NOT pushed — the item placed nothing
        // on this fragment. When it resumes on the next fragment from a degenerate
        // (line-0) token, that fragment is its real START and emits the marker).
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
    // Apply an explicit block-size by re-creating the child box at that size — but
    // ONLY for a BlockBox child. Mirrors the float branch: a non-block child (a
    // `display:table` → TableBox) is used AS-IS, never re-wrapped in a BlockBox.
    // Re-wrapping a TableBox would (a) drop its rows/cells (the `createBlockBox`
    // children arg only knows how to read a BlockBox's `.children`) and (b) collide
    // keys (the wrapper + the table would share `child.key`). Honoring an explicit
    // height ON a display:table is CSS table height-distribution — a separate feature
    // the float path also does not implement; here we only guarantee the table (and
    // its rows) survive. `childLayout` is already inline-positioned via
    // `positionChildInline`, so the as-is path needs no further repositioning.
    const placedChild = explicitBlockSize > 0 && childLayout.type === "block"
      ? createBlockBox(child.key, childInlineStart, childBlockOffset, childContentInlineSize, explicitBlockSize, cs.writingMode, cs.direction, childCs, childUsedStyle,
          // Preserve the block's laid-out CONTENT children across the re-creation (do
          // NOT drop to []). A `display:block` child with text + an explicit height
          // must keep its rendered lines so they paint and remain hit-testable —
          // mirrors the float path's `floatBlock.children` preservation.
          childLayout.children,
          /* containingInlineSize */ contentInlineSize,
          child.metadata,
          /* containingBlockSize */ undefined,
          // Preserve the child's `position: relative` paint-time offset across the
          // explicit-block-size box re-creation (it would otherwise be dropped).
          childLayout.relativeOffset,
          // Preserve the child's abs-pos descendants across the explicit-block-size
          // box re-creation (slice 3): a child that established an abc resolves them
          // in its OWN frame, independent of this re-creation, so they carry through
          // verbatim — a dropped clone here would silently lose the abs subtree.
          childLayout.absoluteChildren,
        )
      : childLayout;

    // Whole-block fit check: does the placed child fit in remaining space?
    // This check uses the final placed size (after explicit block-size override).
    if (fragmentation !== undefined) {
      const remaining = fragmentation.availableBlockSize - childBlockOffset;
      if (placedChild.blockSize > remaining) {
        // C.6 overflow rule: if fragment is empty, place it anyway (overflow).
        if (layoutChildren.length === 0) {
          if (markerBox !== null) layoutChildren.push(markerBox);
          layoutChildren.push(placedChild);
          childBlockOffset += placedChild.blockSize;
          prevMarginBlockEnd = childUsedStyle.marginBlockEnd;
          continue;
        }
        // #501: marker NOT pushed — the whole block doesn't fit and is pushed to
        // the next fragment (which becomes its start and emits the marker).
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
            if (markerBox !== null) layoutChildren.push(markerBox);
            layoutChildren.push(overflowBox);
            childBlockOffset += overflowBox.blockSize;
            prevMarginBlockEnd = childUsedStyle.marginBlockEnd;
            continue;
          }
          // #501: break-inside:avoid pushes the whole child to the next fragment;
          // marker NOT pushed here (it emits on the fragment that actually starts
          // the child).
          return buildPartialResult(layoutChildren, {
            type: "block",
            resumeChildIndex: i,
            resumeChildToken: null,
          });
        }
      }
      // Partial-content break: the child placed ≥1 line on THIS fragment, so the
      // marker DID land here — push it before the partial content box (#501).
      if (markerBox !== null) layoutChildren.push(markerBox);
      layoutChildren.push(placedChild);
      childBlockOffset += placedChild.blockSize;
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
                 && childLayout.blockSize === 0;

    // #501: this is the NORMAL (non-break) placement — the child's content lands
    // on THIS fragment, so its deferred marker is pushed FIRST (matching the
    // marker-before-content order the old inline push produced). Both the
    // empty-block and the non-empty branch place the content here, so the marker
    // precedes whichever runs.
    if (markerBox !== null) layoutChildren.push(markerBox);

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
          /* containingBlockSize */ undefined,
          // Preserve the child's `position: relative` paint-time offset across the
          // empty-block re-creation.
          placedChild.relativeOffset,
          // Preserve the child's abs-pos descendants across the empty-block
          // re-creation (slice 3): resolved in the child's OWN frame, independent of
          // this re-creation, so they carry through verbatim — a dropped clone here
          // would silently lose the abs subtree.
          placedChild.absoluteChildren,
        ),
      );
    } else {
      layoutChildren.push(placedChild);
      childBlockOffset += placedChild.blockSize;
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
    // Coherent float+pagination: `lowestFloatBlockEdge()` is now a CUMULATIVE
    // edge; the box-enclosure height is PAGE-RELATIVE, so subtract `blockFlowBase`.
    const floatBlockEnd = floatEnv.lowestFloatBlockEdge();
    totalBlockSize = Math.max(inFlowBlockSize, (floatBlockEnd - blockFlowBase) + paddingBlockEnd);
  } else {
    totalBlockSize = inFlowBlockSize;
  }

  // ABS-POS SECOND PASS (POSITIONING slice 3): if THIS box owns its absolute
  // containing block (it established a fresh pending-list — the root always, or
  // an `establishesAbsoluteContainingBlock(cs)` box), drain the pending list and
  // lay out each abs-pos child against the now-resolved abc frame. Mirrors the
  // float second pass (`floatEnv.lowestFloatBlockEdge()` above): the in-flow walk
  // is done, the box's size is known, so the deferred out-of-flow children are
  // resolved here. The abc frame is built from THIS box's RESOLVED locals — the
  // authoritative content origin/sizes — not the placeholder carried in context.
  // A non-fragmented full layout only (paginated abs-pos splitting is a v1 edge —
  // see the `buildPartialResult` note: a partial/fragmented return never reaches
  // this second pass, so abs children registered before a fragmentation break are
  // left undrained in the pending list); the pending list is empty for the
  // overwhelmingly common un-positioned document, so this whole block is a cheap
  // no-op there.
  let absoluteChildren: readonly LayoutBox[] | undefined;
  if (ctx.ownsAbsoluteContainingBlock) {
    const pendingAbs = ctx.absoluteContainingBlock.pending.drain();
    if (pendingAbs.length > 0) {
      const contentBlockResolved = Math.max(0, totalBlockSize - paddingBlockStart - paddingBlockEnd);
      // The percent-resolution base for block-axis insets: CSS §10.5 — a
      // percentage resolves against the abc's block size only when that size is
      // DEFINITE (an explicit `block-size`); against an auto-height abc the
      // percentage computes to `auto`. `resolveExplicitBlockSizeOrNull` returns
      // null for `auto`/intrinsic → "indefinite".
      const explicitBlock = resolveExplicitBlockSizeOrNull(cs.blockSize, availableInlineSize);
      const abcBlockPercentBase: number | "indefinite" =
        explicitBlock !== null && explicitBlock > 0 ? contentBlockResolved : "indefinite";
      const abc: ResolvedAbc = {
        originInline: paddingInlineStart,
        originBlock:  paddingBlockStart,
        inlineSize:   contentInlineSize,
        contentBlockResolved,
        blockPercentBase: abcBlockPercentBase,
      };
      absoluteChildren = layoutAbsoluteChildren(pendingAbs, abc, ctx, shaper, hyphenator);
    }
  }

  return { box: createBlockBox(
    node.key, inlineOffset, blockOffset, finalInlineSize, totalBlockSize, writingMode, direction, cs, usedStyle, layoutChildren,
    /* containingInlineSize */ availableInlineSize,
    node.metadata,
    /* containingBlockSize */ undefined,
    relativeOffset,
    absoluteChildren,
    // Carry the in-flow-consumed scalar ON THE BOX so the layout-box cache reads
    // it back EXACTLY (a box enclosing a taller float has blockSize > inFlow).
    inFlowBlockSize,
  ), breakToken: null, inFlowConsumed: inFlowBlockSize };
  } finally {
    markEnd("bfc.layoutBlock", t);
  }
}

/**
 * The intermediate result of laying out a float's inner content + computing its
 * margin-box sizes, BEFORE it is placed in the float env. Shared by the BFC
 * float branch and the #528 landing-page pushed-float consumer so both compute
 * the float's geometry identically.
 */
interface SizedFloat {
  readonly floatLayout: BlockBox;
  readonly floatInlineSize: number;
  readonly floatBlockSize: number;
  readonly floatExplicitBlockSize: number;
  readonly side: "inline-start" | "inline-end";
}

/**
 * Lay out a float child's inner content and resolve its margin-box inline/block
 * sizes, WITHOUT placing it (no float-env mutation). This is the first half of
 * the float sequence in `layoutBlock`'s float branch (`bfc.ts` ~669-698),
 * extracted so the #528 landing-page pushed-float consumer
 * (`placeIncomingPushedFloats`) reproduces it byte-identically. `child` must be
 * a cascaded float element (`childCs.float !== "none"`).
 *
 * `requestedCumulativeOffset` is the float's cumulative document-flow origin
 * (`blockFlowBase + childBlockOffset` in the source branch; the landing page's
 * `pageFlowBase` for a pushed float) — threaded into the inner `layoutBlock` so
 * the float's own paragraphs' `paraFlowStart` is correct in its own frame.
 */
function sizeFloat(
  child: ElementBox,
  childCs: ComputedStyle,
  childUsedStyle: ReturnType<typeof computeUsedStyle>,
  ctx: LayoutContext,
  shaper: TextShaper,
  hyphenator: Hyphenator | undefined,
  contentInlineSize: number,
  requestedCumulativeOffset: number,
): SizedFloat {
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
  const floatResult = layoutBlock(child, 0, 0, floatCtxChild, shaper, hyphenator, undefined, requestedCumulativeOffset);
  if (floatResult.box === null) {
    throw new Error("layoutBlock without fragmentation returned null box; should be unreachable (no FragmentationContext passed)");
  }
  const floatLayout = floatResult.box;
  const floatExplicitBlockSize = resolveExplicitBlockSize(childCs.blockSize, contentInlineSize);
  const floatInlineSize = floatLayout.inlineSize;
  const floatBlockSize = floatExplicitBlockSize > 0 ? floatExplicitBlockSize : floatLayout.blockSize;
  const side = childCs.float === "inline-start" ? "inline-start" : "inline-end";
  return { floatLayout, floatInlineSize, floatBlockSize, floatExplicitBlockSize, side };
}

/**
 * Place a sized float into the env at its requested cumulative offset and
 * reposition its already-laid-out box to the resulting PAGE-RELATIVE offset.
 * Second half of the float sequence (`bfc.ts` ~704-777), extracted so the #528
 * landing-page consumer reuses the IDENTICAL place+reposition arithmetic.
 *
 * `floatEnv.placeFloat` returns a CUMULATIVE block-offset (it may push the float
 * below same-side floats); `blockFlowBase` converts it back to the page-relative
 * frame the box geometry uses. `childCs`/`paddingInlineStart`/`contentInlineSize`
 * supply the writing-mode/RTL-mirror inputs exactly as the source branch.
 */
function placeAndPositionFloat(
  sized: SizedFloat,
  childCs: ComputedStyle,
  floatEnv: FloatEnvironment,
  paddingInlineStart: number,
  contentInlineSize: number,
  blockFlowBase: number,
  requestedCumulativeOffset: number,
): LayoutBox {
  const { floatLayout, floatInlineSize, floatBlockSize, floatExplicitBlockSize, side } = sized;
  const result = floatEnv.placeFloat(
    side,
    requestedCumulativeOffset,
    floatInlineSize,
    floatBlockSize,
    contentInlineSize,
  );
  const placedInlineOffset = result.inlineOffset;
  const placedBlockOffset = result.blockOffset - blockFlowBase;
  const repositionedInlineOffset = paddingInlineStart + placedInlineOffset;
  let positioned: LayoutBox;
  if (
    floatExplicitBlockSize > 0 &&
    floatExplicitBlockSize !== floatLayout.blockSize &&
    floatLayout.type === "block"
  ) {
    const floatBlock: BlockBox = floatLayout;
    positioned = createBlockBox(
      floatBlock.key,
      repositionedInlineOffset,
      placedBlockOffset,
      floatBlock.inlineSize,
      floatExplicitBlockSize,
      childCs.writingMode,
      childCs.direction,
      floatBlock.computedStyle,
      floatBlock.usedStyle,
      floatBlock.children,
      contentInlineSize,
      floatBlock.metadata,
      /* containingBlockSize */ undefined,
      floatBlock.relativeOffset,
      floatBlock.absoluteChildren,
    );
  } else {
    positioned = withOffsets(
      floatLayout,
      repositionedInlineOffset,
      placedBlockOffset,
      contentInlineSize,
    );
  }
  assertLayoutBoxConsistent(positioned, contentInlineSize);
  return positioned;
}

/**
 * #528 cross-page float pushing — the LANDING-PAGE consumer. For each pushed
 * float (in source order), re-lay-out its inner content at the landing page's
 * content top and place it into `pageEnv`, returning the positioned float boxes.
 *
 * Call this AFTER the active-shadow `seedPlaced` loop and BEFORE the page's main
 * `layoutBlock`, so the body content flows around the landed floats (narrowing).
 * Both passes (`virtual-producer.ts` measure closure, `virtual-layout-tree.ts`
 * materialize) call it for identical env occupancy; the measure pass DISCARDS the
 * returned boxes (it only needs the env), materialize KEEPS them (appended to the
 * page output like a normally-placed float). It ALWAYS places (never re-pushes):
 * a pushed float taller than a whole page overflows its landing page — the
 * documented v1 bound — it does not loop.
 *
 * The float child layout-context is derived from `pageCtx` exactly as the BFC
 * float branch derives `floatCtxChild` (a fresh BFC env per float, via
 * `makeChildContext` inside `sizeFloat`). `requestedCumulativeOffset =
 * pageFlowBase` (the page-top cumulative origin); `blockFlowBase = pageFlowBase`
 * converts the placed offset back to page-relative.
 *
 * `bodyRoot` is the page's cascaded body root — its padding + content inline-size
 * are derived EXACTLY as `layoutBlock` derives them for that root (so the float's
 * box inline offset + exclusion width match the body's own float placement). The
 * returned boxes are body-content-frame-relative (same frame the body's own
 * `layoutChildren` floats use), so a caller appends them to the body box's
 * children.
 */
export function placeIncomingPushedFloats(
  pushed: readonly PushedFloat[],
  pageEnv: FloatEnvironment,
  pageCtx: LayoutContext,
  bodyRoot: ElementBox,
  shaper: TextShaper,
  hyphenator: Hyphenator | undefined,
  pageFlowBase: number,
): LayoutBox[] {
  if (pushed.length === 0) return [];
  const rootCs = bodyRoot.computedStyle;
  if (!rootCs) throw new Error("placeIncomingPushedFloats: body root is not cascaded");
  // Derive the body root's padding + content inline-size EXACTLY as `layoutBlock`
  // does (its `usedStyle` / `finalInlineSize` / `contentInlineSize`), so a pushed
  // float lands in the identical frame the body's own floats use.
  const rootUsedStyle = computeUsedStyle(rootCs, pageCtx.containingInlineSize, "indefinite");
  const paddingInlineStart = rootUsedStyle.paddingInlineStart;
  const finalInlineSize = resolveBoxInlineSize(rootCs, pageCtx.containingInlineSize, false, bodyRoot, shaper, pageCtx);
  const contentInlineSize = finalInlineSize - paddingInlineStart - rootUsedStyle.paddingInlineEnd;

  const positionedFloats: LayoutBox[] = [];
  for (const pf of pushed) {
    const node = pf.node;
    if (node.type !== "element") {
      throw new Error("placeIncomingPushedFloats: pushed float node is not an element");
    }
    const childCs = node.computedStyle;
    if (!childCs) throw new Error("placeIncomingPushedFloats: pushed float node is not cascaded");
    const childUsedStyle = computeUsedStyle(childCs, contentInlineSize, "indefinite");
    const sized = sizeFloat(
      node, childCs, childUsedStyle, pageCtx, shaper, hyphenator, contentInlineSize, pageFlowBase,
    );
    const positioned = placeAndPositionFloat(
      sized, childCs, pageEnv, paddingInlineStart, contentInlineSize, pageFlowBase, pageFlowBase,
    );
    positionedFloats.push(positioned);
  }
  return positionedFloats;
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

/**
 * POSITIONING slice 3 — the RESOLVED absolute containing block frame, built by
 * the establishing box's second pass from its own resolved locals. All values are
 * in the establishing box's OWN coordinate frame (the frame `absoluteChildren`
 * are pushed into), so an abs child's resolved offsets are parent-relative there.
 */
interface ResolvedAbc {
  /** The abc content-box inline-start, in the establishing box's frame (= paddingInlineStart). */
  readonly originInline: number;
  /** The abc content-box block-start, in the establishing box's frame (= paddingBlockStart). */
  readonly originBlock: number;
  /** The abc content-area inline-size (definite). */
  readonly inlineSize: number;
  /** The abc content-area block-size, resolved at drain time (definite). Used for px end-anchoring / fill. */
  readonly contentBlockResolved: number;
  /**
   * The base a block-axis PERCENT inset resolves against: a definite number when
   * the abc has an explicit block-size, else `"indefinite"` (CSS §10.5 — a percent
   * against an auto-height abc computes to `auto`).
   */
  readonly blockPercentBase: number | "indefinite";
}

/**
 * POSITIONING slice 3 — lay out the abs-pos children whose abc is the box that
 * just finished its in-flow layout. For each pending child:
 *   1. resolve inline + block insets against the abc (inline-axis against
 *      `abc.inlineSize`; block-axis against `abc.blockPercentBase` for percents,
 *      `abc.contentBlockResolved` for px end-anchoring/fill);
 *   2. resolve the used inline/block size (`auto` → fill-from-both-insets, else
 *      shrink-to-content via the BFC's intrinsic sizing);
 *   3. resolve the position (inset-start wins; else inset-end anchors the
 *      end-edge; else the captured static position);
 *   4. recursively lay the child out as its own BFC root at the resolved position
 *      and push the result.
 * Returns the laid-out abs children (document order), or `undefined` if none.
 */
function layoutAbsoluteChildren(
  pending: readonly PendingAbsChild[],
  abc: ResolvedAbc,
  ctx: LayoutContext,
  shaper: TextShaper,
  hyphenator: Hyphenator | undefined,
): readonly LayoutBox[] | undefined {
  const out: LayoutBox[] = [];
  for (const p of pending) {
    const childCs = p.computedStyle;

    // ── Inline axis ──────────────────────────────────────────────────────────
    // Insets resolve against the abc inline-size (concrete). Logical inset-inline-*
    // are mapped to the abc frame: start anchors the inline-start edge, end anchors
    // the inline-end edge.
    const insetInlineStart = childCs.insetInlineStart === "auto"
      ? null : resolveInset(childCs.insetInlineStart, abc.inlineSize);
    const insetInlineEnd = childCs.insetInlineEnd === "auto"
      ? null : resolveInset(childCs.insetInlineEnd, abc.inlineSize);

    // Used inline-size. `auto` with BOTH inline insets set → fill the gap
    // (abc.inlineSize − start − end). Otherwise shrink-to-fit via the existing BFC
    // intrinsic-size resolution (same path floats/inline-blocks use).
    let usedInlineSize: number;
    if (childCs.inlineSize === "auto" && insetInlineStart !== null && insetInlineEnd !== null) {
      usedInlineSize = Math.max(0, abc.inlineSize - insetInlineStart - insetInlineEnd);
    } else {
      usedInlineSize = resolveBoxInlineSize(childCs, abc.inlineSize, /* isShrinkToFit */ true, p.node, shaper, ctx);
    }

    // Inline position (in the abc content frame): inset-inline-start wins; else
    // inset-inline-end anchors the inline-end edge (start = size − end − used);
    // else the captured static inline offset (already abc-frame-relative).
    let inlineOffsetInAbcContent: number;
    if (insetInlineStart !== null) {
      inlineOffsetInAbcContent = insetInlineStart;
    } else if (insetInlineEnd !== null) {
      inlineOffsetInAbcContent = abc.inlineSize - insetInlineEnd - usedInlineSize;
    } else {
      // Static fallback: the captured static is in the establishing box's FRAME;
      // subtract the abc content origin to express it in the abc CONTENT frame
      // (the layout below re-adds the origin).
      inlineOffsetInAbcContent = p.staticInlineOffset - abc.originInline;
    }

    // ── Block axis ───────────────────────────────────────────────────────────
    // Percent block insets resolve against `abc.blockPercentBase` — `"indefinite"`
    // collapses them to `auto` (resolveInset returns 0 for an indefinite percent).
    const insetBlockStart = resolveBlockInset(childCs.insetBlockStart, abc.blockPercentBase);
    const insetBlockEnd = resolveBlockInset(childCs.insetBlockEnd, abc.blockPercentBase);

    // ── Lay the child out as its own BFC root at a provisional (0,0). The child
    // establishes a new BFC (position:absolute → establishesNewBFC), so its
    // context is fresh; pass the resolved inline-size as its containing inline
    // size. We lay out first to learn its auto block-size, then resolve the block
    // position, then reposition. ──────────────────────────────────────────────
    const childCtx = makeChildContext(ctx, childCs, usedInlineSize, "indefinite");
    const provisional = layoutBlock(p.node, 0, 0, childCtx, shaper, hyphenator);
    if (provisional.box === null) {
      throw new Error("layoutAbsoluteChildren: abs child layout returned null (no fragmentation passed)");
    }
    const provisionalBox = provisional.box;

    // Used block-size. `auto` with BOTH block insets definite → fill
    // (contentBlockResolved − start − end). Else use the content-measured block
    // size from the provisional layout (or an explicit block-size if set).
    const explicitChildBlock = resolveExplicitBlockSizeOrNull(childCs.blockSize, abc.inlineSize);
    let usedBlockSize: number;
    if (childCs.blockSize === "auto" && insetBlockStart !== null && insetBlockEnd !== null) {
      usedBlockSize = Math.max(0, abc.contentBlockResolved - insetBlockStart - insetBlockEnd);
    } else if (explicitChildBlock !== null && explicitChildBlock > 0) {
      usedBlockSize = explicitChildBlock;
    } else {
      usedBlockSize = provisionalBox.blockSize;
    }

    // Block position (in the abc content frame): inset-block-start wins; else
    // inset-block-end anchors the block-end edge; else the captured static block
    // offset (abc-frame → abc-content-frame).
    let blockOffsetInAbcContent: number;
    if (insetBlockStart !== null) {
      blockOffsetInAbcContent = insetBlockStart;
    } else if (insetBlockEnd !== null) {
      blockOffsetInAbcContent = abc.contentBlockResolved - insetBlockEnd - usedBlockSize;
    } else {
      blockOffsetInAbcContent = p.staticBlockOffset - abc.originBlock;
    }

    // Translate the abc-content-frame offsets into the establishing box's frame
    // by adding the abc content origin, then lay the child out FINALLY at that
    // position (re-running so the box's own offsets/physical coords bake in).
    const finalInlineOffset = abc.originInline + inlineOffsetInAbcContent;
    const finalBlockOffset = abc.originBlock + blockOffsetInAbcContent;
    const finalCtx = makeChildContext(ctx, childCs, usedInlineSize, "indefinite");
    const finalResult = layoutBlock(p.node, finalInlineOffset, finalBlockOffset, finalCtx, shaper, hyphenator);
    if (finalResult.box === null) {
      throw new Error("layoutAbsoluteChildren: abs child final layout returned null");
    }
    out.push(finalResult.box);
  }
  return out.length > 0 ? out : undefined;
}

/**
 * POSITIONING slice 3 — resolve a block-axis inset against the abc's block
 * percent-base. Mirrors `resolveInset` but returns `null` for `auto` (so the
 * caller can distinguish "no inset" from "inset 0") and collapses a PERCENT
 * against an `"indefinite"` base to `null` (= `auto`, CSS §10.5). A px inset
 * always applies.
 */
function resolveBlockInset(
  value: ComputedStyle["insetBlockStart"],
  percentBase: number | "indefinite",
): number | null {
  if (value === "auto") return null;
  if (typeof value === "number") return value;
  // percent
  if (percentBase === "indefinite") return null;
  return resolveUsedLength(value, percentBase, 0);
}

