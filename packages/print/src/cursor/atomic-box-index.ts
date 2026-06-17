import type { LayoutBox } from "../layout/layout-box";
import { resolveBlock, coerceBlockId } from "@taleweaver/core";
import type { State, BlockId, BlockKindResolver } from "@taleweaver/core";

/**
 * Object-selection geometry (#525). An ABSOLUTE physical pixel rect for an
 * atomic-leaf block (image / horizontal-line), plus the page it lives on.
 *
 * PHYSICAL coordinates (NOT the logical inline/block projection
 * `findBlockBaseline` produces): images are horizontal writing-mode, so the
 * box's physical `(x, y, width, height)` IS the rect a point-in-rect hit-test
 * (Task 3) and the selection-handle geometry (Task 4) want. `x`/`y` are
 * document-relative when the page is the walk root (a per-page `getPage(i)`
 * `PageBox` uses the page-content frame as its `(0, 0)` origin — see
 * `findBlockBaseline` / `collectLineBoxes`).
 */
export interface AbsoluteRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly pageIndex: number;
}

/**
 * Per-page map from an atomic-leaf block id to its `AbsoluteRect`. Built by
 * `getAtomicBoxIndex` over ONE positioned `LayoutBox` (a `getPage(i)` `PageBox`)
 * and memoized by that box's identity (mirroring `getLineIndex`). Atomic-leaf
 * blocks render as a `BlockBox` with `key === blockId` and produce NO `LineBox`,
 * so they are absent from the LineBox-canonical `LineIndex`; this index is the
 * geometry source object-selection consumes for them.
 */
export type AtomicBoxIndex = ReadonlyMap<BlockId, AbsoluteRect>;

/**
 * Cache keyed on the per-page `LayoutBox` identity. A new layout cycle produces
 * a new positioned page box, so its old index becomes eligible for GC;
 * subsequent calls within the same cycle (same box) reuse the cached map.
 * Mirrors `getLineIndex`'s `_lineIndexCache` in `line-flatten.ts`.
 */
const _atomicBoxIndexCache: WeakMap<LayoutBox, AtomicBoxIndex> = new WeakMap();

/**
 * Return the `AtomicBoxIndex` for a single positioned `LayoutBox` (a
 * `getPage(i)` `PageBox`), building it on first access and caching by reference.
 */
export function getAtomicBoxIndex(
  layoutTree: LayoutBox,
  resolver: BlockKindResolver,
  state: State,
): AtomicBoxIndex {
  const cached = _atomicBoxIndexCache.get(layoutTree);
  if (cached !== undefined) return cached;
  const out = new Map<BlockId, AbsoluteRect>();
  collect(layoutTree, 0, 0, 0, resolver, state, out);
  _atomicBoxIndexCache.set(layoutTree, out);
  return out;
}

/**
 * Resolve a `BlockBox` key to the atomic-leaf block it names, or `null` if the
 * key names no live block or names a non-atomic-leaf one. The layout `key` is
 * the same underlying string as the block's branded `BlockId`; `coerceBlockId`
 * is the project-standard validated coercion boundary (the unavoidable cast is
 * contained inside it, not here). `resolveBlock` validates existence across ALL
 * three trees (main / embedContents / templateContents) — so an atomic image in
 * a footnote body (embed) or a header/footer body (template) resolves, mirroring
 * the cross-tree lookup `cursor-position.ts` uses.
 */
function atomicLeafBlockFor(
  key: string,
  resolver: BlockKindResolver,
  state: State,
): BlockId | null {
  const id = coerceBlockId(key);
  if (id === undefined) return null;
  const resolved = resolveBlock(state, id);
  if (resolved === null) return null;
  return resolver.getBlockKind(resolved.block.type) === "atomic-leaf"
    ? resolved.block.id
    : null;
}

/**
 * Walk `box`, accumulating physical `(x, y)` from the parent, and record an
 * `AbsoluteRect` for every `BlockBox` whose `key` resolves to an atomic-leaf
 * block. PHYSICAL-coordinate walk: it records the box's physical rect rather
 * than the logical inline/block projection (images are horizontal-mode, so the
 * physical box IS the rect).
 *
 * The page / multicolumn / generic-container / skip-leaf dispatch, the `absX =
 * parentX + box.x` / `absY = parentY + box.y` accumulation, and the
 * page-local-origin descent for the header/footer/footnote SLOTS mirror
 * `findBlockBaseline` (cursor-position.ts). The `absoluteChildren` descent does
 * NOT come from `findBlockBaseline` — that function does NOT descend
 * `absoluteChildren`; instead this branch mirrors
 * `collectLineBoxes`/`collectAbsoluteLineBoxes` (line-flatten.ts), which DO,
 * so an abs-pos atomic leaf (reachable only via `absoluteChildren`, OUT of
 * `children`) is indexed.
 */
function collect(
  box: LayoutBox,
  parentX: number,
  parentY: number,
  pageIndex: number,
  resolver: BlockKindResolver,
  state: State,
  out: Map<BlockId, AbsoluteRect>,
): void {
  if (box.type === "page") {
    // Header/footer/footnote SLOTS are page-local BlockBoxes kept OUT of
    // `children` as named fields; descend them too (an image can live in a
    // header/footer body). Page-content frame origin `(0, 0)`, the page's own
    // `pageIndex`.
    if (box.headerSlot !== null) {
      collect(box.headerSlot, 0, 0, box.pageIndex, resolver, state, out);
    }
    for (const child of box.children) {
      collect(child, 0, 0, box.pageIndex, resolver, state, out);
    }
    if (box.footerSlot !== null) {
      collect(box.footerSlot, 0, 0, box.pageIndex, resolver, state, out);
    }
    if (box.footnoteSlot !== null) {
      collect(box.footnoteSlot, 0, 0, box.pageIndex, resolver, state, out);
    }
    return;
  }
  if (box.type === "text-run" || box.type === "marker") return;

  const absX = parentX + box.x;
  const absY = parentY + box.y;

  if (box.type === "block") {
    const atomicId = atomicLeafBlockFor(box.key, resolver, state);
    if (atomicId !== null) {
      out.set(atomicId, {
        x: absX,
        y: absY,
        width: box.width,
        height: box.height,
        pageIndex,
      });
      // An atomic leaf has no atomic-leaf descendants; nothing to walk into.
      return;
    }
  }

  if (box.type === "multicolumn") {
    for (const col of box.columns) {
      collect(col, absX, absY, pageIndex, resolver, state, out);
    }
  } else if ("children" in box) {
    for (const child of box.children) {
      collect(child, absX, absY, pageIndex, resolver, state, out);
    }
  }

  // Abs-pos descendants are positioned in THIS box's frame (same parent origin
  // as `children`) and are OUT of `children` — descend them so an abs-pos
  // atomic leaf is reachable (mirrors `collectAbsoluteLineBoxes`).
  if (box.absoluteChildren !== undefined) {
    for (const absChild of box.absoluteChildren) {
      collect(absChild, absX, absY, pageIndex, resolver, state, out);
    }
  }
}
