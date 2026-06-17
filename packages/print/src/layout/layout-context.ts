import type { ComputedStyle, WritingMode, Direction } from "@taleweaver/core";
import type { IntrinsicSizesCache } from "@taleweaver/core";
import { createIntrinsicSizesCache } from "@taleweaver/core";
import type { FloatEnvironment } from "./float-context";
import { createFloatEnvironment } from "./float-context";
import { establishesNewBFC } from "./bfc-establishment";
import type { IFCStateCache } from "./ifc-state";
import { createIFCStateCache } from "./ifc-state";
import type { LayoutBoxCache } from "./layout-reuse";
import type { AbsPosEnvironment } from "./abs-pos-context";
import { createAbsPosEnvironment } from "./abs-pos-context";

/**
 * POSITIONING slice 3 — the absolute containing block (abc) for the box currently
 * being laid out: the nearest positioned (or transformed) ancestor whose
 * coordinate frame an `position: absolute` descendant resolves its
 * `inset*` against (CSS Positioned Layout 3 §3). The document root's abc is the
 * page/viewport content area.
 *
 * `origin` is the abc CONTENT-box top-left, expressed in the ESTABLISHING box's
 * OWN coordinate frame (the frame `absoluteChildren` are pushed into and the
 * painter recurses them with) — i.e. `(paddingInlineStart, paddingBlockStart)`.
 * The second pass resolves an abs child's position as `origin.inlineOffset +
 * insetStart` etc., yielding offsets in the establishing box's frame.
 *
 * `inlineSize` is always a concrete `number` (inline-size resolves top-down
 * before children lay out). `blockSize` is `number | "indefinite"` — mirroring
 * `LayoutContext.containingBlockSize` — because the abc's block-size is NOT known
 * when `makeChildContext` runs for it (`totalBlockSize` is computed post-loop). An
 * auto-height abc therefore carries `"indefinite"`, and per CSS Positioned Layout
 * §5 a block-axis percent inset against an indefinite abc resolves as `auto`.
 *
 * `pending` is the shared mutable sink (mirror of `FloatEnvironment`): abs-pos
 * descendants register their static position here during the walk; the
 * establishing box drains it in the second pass.
 */
export interface AbsoluteContainingBlock {
  /** The abc content-area inline-size (always definite). */
  readonly inlineSize: number;
  /** The abc content-area block-size, or `"indefinite"` when not yet known. */
  readonly blockSize: number | "indefinite";
  /** The abc content-box top-left in the establishing box's own coordinate frame. */
  readonly origin: {
    readonly inlineOffset: number;
    readonly blockOffset: number;
  };
  /** Shared mutable pending-list of abs-pos descendants drained by the establishing box. */
  readonly pending: AbsPosEnvironment;
}

/**
 * POSITIONING slice 3 — a box establishes an absolute containing block (the
 * coordinate frame for `position: absolute` descendants) when it is positioned
 * (`relative` / `absolute`) OR has a non-empty `transform` (CSS
 * Transforms 1 §6 — a transformed box is a containing block for absolute
 * descendants). `transform` defaults to `[]`, so the transform clause is
 * inert until slice 5.
 */
export function establishesAbsoluteContainingBlock(cs: ComputedStyle): boolean {
  if (cs.position === "relative" || cs.position === "absolute") {
    return true;
  }
  if (cs.transform.length > 0) return true;
  return false;
}

/**
 * Layout context for a node being laid out. Carries the writing-mode,
 * direction, and containing-block sizes inherited from the parent.
 *
 * Each FC reads `ctx.writingMode` / `ctx.direction` for axis interpretation
 * and `ctx.containingInlineSize` for percent / shrink-to-fit resolution.
 *
 * When recursing into a child, build the child's context via
 * `makeChildContext(ctx, parentCs, contentInlineSize, contentBlockSize)`.
 */
export interface LayoutContext {
  readonly writingMode: WritingMode;
  readonly direction:   Direction;
  readonly containingInlineSize: number;
  readonly containingBlockSize:  number | "indefinite";
  /** Shared per-render-node cache for intrinsic sizes, reused across the whole layout pass. */
  readonly intrinsicCache: IntrinsicSizesCache;
  /** Shared per-paragraph cache for IFC wrap state (tokens + lines), reused across the whole layout pass. */
  readonly ifcStateCache: IFCStateCache;
  /**
   * The nearest ancestor BFC's float environment. Floats are registered here
   * and siblings query it to wrap text around them.
   *
   * `makeRootContext` always creates a fresh `FloatEnvironment` (the root is
   * always a BFC root). `makeChildContext` creates a fresh env when the child
   * establishes a new BFC (`establishesNewBFC`), and inherits the parent's env
   * otherwise — so floats rise to the containing BFC.
   */
  readonly floatEnv: FloatEnvironment;
  /**
   * `true` when this context was created for a box that is a BFC root — i.e.
   * the `floatEnv` is owned exclusively by this box (not shared with the
   * parent). BFC roots must enclose their floats in their content height.
   *
   * Set by `makeRootContext` (always true) and by `makeChildContext` when
   * `establishesNewBFC(childCs)` is true.
   */
  readonly isBFCRoot: boolean;
  /**
   * Cache of LayoutBoxes from the previous layout pass, keyed by render-node key.
   * Null when no previous layout is available (cold start).
   *
   * Used by `layoutBlock` to short-circuit re-layout of unchanged subtrees.
   */
  readonly prevLayoutCache: LayoutBoxCache | null;
  /**
   * The float environment from the previous layout pass. Used together with
   * `prevLayoutCache` to check whether float changes affect a cached box.
   * Null when no previous layout is available or when floats haven't changed.
   */
  readonly prevFloatEnv: FloatEnvironment | null;
  /**
   * POSITIONING slice 3 — the absolute containing block for the box being laid
   * out. `makeChildContext` replaces it with the entered box when that box
   * establishes one (`establishesAbsoluteContainingBlock`); otherwise it is
   * inherited so abs-pos descendants rise to the nearest abc-establishing
   * ancestor (mirroring how `floatEnv` is inherited until a new BFC root). The
   * root's abc is the page/viewport content area (`makeRootContext`).
   */
  readonly absoluteContainingBlock: AbsoluteContainingBlock;
  /**
   * POSITIONING slice 3 — `true` when the box laid out under this context OWNS
   * `absoluteContainingBlock` (the pending-list is its own fresh one, not shared
   * with an ancestor). The owner DRAINS the pending-list in its post-loop second
   * pass; non-owners pass abs-pos descendants up to the owning ancestor. Mirrors
   * `isBFCRoot` for the float env. Set by `makeRootContext` (always — the root's
   * abc is the page/viewport) and by `makeChildContext` when the entered box
   * establishes one (`establishesAbsoluteContainingBlock`).
   */
  readonly ownsAbsoluteContainingBlock: boolean;
  /**
   * POSITIONING slice 3 — the offset from the current abc's CONTENT origin to
   * this context's box frame, in the abc's coordinate system. The establishing
   * box's own children carry `{0, 0}`; an in-flow descendant accumulates the
   * intervening child offsets. When an abs-pos child registers its static
   * position, it adds its local in-flow `(childInlineStart, childBlockOffset)` to
   * this accumulator so the captured static position is abc-frame-relative (the
   * `auto`-inset fallback must be in the same frame the resolved insets produce).
   */
  readonly originFromAbc: {
    readonly inlineOffset: number;
    readonly blockOffset: number;
  };
}

/**
 * Build a layout context for a child being laid out within a parent box.
 *
 * @param parent the parent's layout context (the parent box's containing block).
 * @param parentCs the parent's computed style — provides writing-mode + direction
 *   for the child (CSS: writing-mode and direction are inherited).
 * @param contentInlineSize the parent's content area inline-size; the child's
 *   containing block has this as its inline-size.
 * @param contentBlockSize the parent's content area block-size, if known.
 *   Pass `"indefinite"` if the parent has auto block-size.
 * @param contentOrigin the entered (child) box's in-flow position within the
 *   PARENT frame — its `(childInlineStart, childBlockOffset)`. Used ONLY to
 *   accumulate `originFromAbc` for abs-pos static-position capture through
 *   non-establishing in-flow descendants (POSITIONING slice 3). Defaults to
 *   `{0, 0}`; a non-default value matters only when an abs-pos box is nested
 *   inside a non-positioned in-flow box, where the static-position fallback must
 *   stay expressed in the abc's frame. Inert for the common (direct-child or
 *   no-abs-pos) case.
 */
export function makeChildContext(
  parent: LayoutContext,
  parentCs: ComputedStyle,
  contentInlineSize: number,
  contentBlockSize: number | "indefinite",
  contentOrigin: { readonly inlineOffset: number; readonly blockOffset: number } = {
    inlineOffset: 0,
    blockOffset: 0,
  },
): LayoutContext {
  // If the child establishes a new BFC, give it a fresh float environment so
  // that floats inside it don't leak to the parent's BFC. Otherwise, inherit
  // the parent's env so that floats inside non-BFC blocks rise to the nearest
  // ancestor BFC.
  const isBFCRoot = establishesNewBFC(parentCs);
  const floatEnv = isBFCRoot
    ? createFloatEnvironment()
    : parent.floatEnv;

  // POSITIONING slice 3 — when the entered box establishes an absolute
  // containing block, give its descendants a FRESH abc with a fresh pending-list
  // (mirroring the fresh `floatEnv` for a new BFC root). Otherwise inherit the
  // parent's abc so abs-pos descendants rise to the nearest establishing
  // ancestor, and reset `originFromAbc` accumulation accordingly:
  //   - establishing box: its OWN children are at the abc content origin, so
  //     `originFromAbc` resets to `{0, 0}` (the second pass adds the box's
  //     padding as the content origin from its own locals).
  //   - non-establishing in-flow box: accumulate `contentOrigin` (the child's
  //     in-flow `(childInlineStart, childBlockOffset)` within the parent frame)
  //     onto the inherited `originFromAbc`, so a deeper abs-pos descendant's
  //     captured static position stays expressed in the abc's frame.
  // The placeholder `inlineSize`/`blockSize`/`origin` carry the best-known values
  // at establish time; the draining box's second pass uses its own RESOLVED
  // locals (content inline-size, total block-size, padding) as the authoritative
  // abc frame, so an indefinite/placeholder here never mis-positions.
  const establishesAbc = establishesAbsoluteContainingBlock(parentCs);
  const absoluteContainingBlock: AbsoluteContainingBlock = establishesAbc
    ? {
        inlineSize: contentInlineSize,
        blockSize:  contentBlockSize,
        origin: { inlineOffset: 0, blockOffset: 0 },
        pending: createAbsPosEnvironment(),
      }
    : parent.absoluteContainingBlock;
  const originFromAbc = establishesAbc
    ? { inlineOffset: 0, blockOffset: 0 }
    : {
        inlineOffset: parent.originFromAbc.inlineOffset + contentOrigin.inlineOffset,
        blockOffset:  parent.originFromAbc.blockOffset + contentOrigin.blockOffset,
      };

  return {
    writingMode: parentCs.writingMode,
    direction:   parentCs.direction,
    containingInlineSize: contentInlineSize,
    containingBlockSize:  contentBlockSize,
    intrinsicCache: parent.intrinsicCache,
    ifcStateCache: parent.ifcStateCache,
    floatEnv,
    isBFCRoot,
    prevLayoutCache: parent.prevLayoutCache,
    prevFloatEnv: parent.prevFloatEnv,
    absoluteContainingBlock,
    ownsAbsoluteContainingBlock: establishesAbc,
    originFromAbc,
  };
}

/**
 * Build a layout context for the document root from its computed style.
 * The root has no parent, so `containingInlineSize` is the viewport / page
 * inline-size and `containingBlockSize` is `"indefinite"`.
 */
export function makeRootContext(
  rootCs: ComputedStyle,
  containerInlineSize: number,
): LayoutContext {
  return {
    writingMode: rootCs.writingMode,
    direction:   rootCs.direction,
    containingInlineSize: containerInlineSize,
    containingBlockSize:  "indefinite",
    intrinsicCache: createIntrinsicSizesCache(),
    ifcStateCache: createIFCStateCache(),
    // The document root is always a BFC root; it always gets a fresh float env.
    floatEnv: createFloatEnvironment(),
    isBFCRoot: true,
    prevLayoutCache: null,
    prevFloatEnv: null,
    // POSITIONING slice 3 — the root's abc is the page/viewport content area; an
    // abs-pos box with no positioned ancestor resolves its insets against it. The
    // root frame origin is `{0, 0}`; block-size is `"indefinite"` (the document
    // height is content-derived), so block-axis percent insets against the root
    // abc resolve as `auto` (CSS Positioned Layout §5).
    absoluteContainingBlock: {
      inlineSize: containerInlineSize,
      blockSize: "indefinite",
      origin: { inlineOffset: 0, blockOffset: 0 },
      pending: createAbsPosEnvironment(),
    },
    ownsAbsoluteContainingBlock: true,
    originFromAbc: { inlineOffset: 0, blockOffset: 0 },
  };
}
