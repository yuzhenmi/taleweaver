import type { BlockId, Mat2D } from "@taleweaver/core";
import { axisMapFor, invert } from "@taleweaver/core";
import type { BoundaryMarkBox, LayoutBox, MarkerBox } from "../layout/layout-box";
import type { AbsoluteRect } from "./atomic-box-index";
import { transformAt } from "./line-flatten";
import { ROOT_CLIP, UNCLIPPED, childClip, columnClip, intersectClip, pageClip, type Clip, type ClipState, type OuterClip } from "./ancestor-clip";

/**
 * A placed tracked ¶ glyph or section-break label (see `BoundaryMarkPlacement`)
 * with its absolute physical rect. For a ¶ the rect is the VISIBLE extent: the
 * glyph box clipped by its float cap (`maxInlineSize`) and its ancestors' clip
 * regions — a table cell's border box, the column's span up to its neighbouring
 * columns (it hangs freely into the gap), the page box. A ¶ clipped away entirely
 * is not indexed (and not painted). `glyphX` / `glyphY` are the unclipped box
 * origin in the same frame, so a painter can draw the glyph and clip to the rect.
 */
export interface BoundaryMarkRect extends AbsoluteRect {
  readonly box: BoundaryMarkBox;
  readonly glyphX: number;
  readonly glyphY: number;
  /**
   * The inverse of the cumulative ancestor `transform` (as `AbsoluteLineBox`): absent
   * → identity; `"singular"` → a degenerate transform (never hit). The rect stays
   * PRE-transform; a hit-test maps the click through this first.
   */
  readonly inverseTransform?: Mat2D | "singular";
  /**
   * Clip regions of ancestors ABOVE a transform between them and the mark (a cell
   * border box, a column, the page box), each in its own frame: `frame` is the
   * cumulative transform at that ancestor (absent → identity), `inverse` its inverse.
   * The rect above holds only the clips in the mark's own frame; a point / paint is
   * visible iff it is also inside every outer clip mapped through its frame. Empty
   * when no transform lies between the mark and its clipping ancestors.
   */
  readonly outerClips: readonly OuterClip[];
}

/** The marks of a positioned tree: in tree order, grouped by their block, and by box. */
export interface BoundaryMarkIndex {
  readonly all: readonly BoundaryMarkRect[];
  readonly byBlock: ReadonlyMap<BlockId, readonly BoundaryMarkRect[]>;
  readonly byBox: ReadonlyMap<MarkerBox, BoundaryMarkRect>;
}

const _cache: WeakMap<LayoutBox, BoundaryMarkIndex> = new WeakMap();

/**
 * Every tracked ¶ glyph / section-break label box in a positioned tree (a `getPage(i)`
 * `PageBox` or the single-canvas tree), in the same absolute frame as
 * `getLineIndex` (parent-relative physical accumulation, page slots at the page
 * origin, pre-transform rects with the cumulative inverse transform baked;
 * `position: relative` shifts are NOT applied — consumers that paint shift like
 * they do for lines). Memoized by tree identity.
 */
export function getBoundaryMarkIndex(tree: LayoutBox): readonly BoundaryMarkRect[] {
  return boundaryMarkIndexOf(tree).all;
}

/** {@link getBoundaryMarkIndex} grouped by block id (O(1) per block lookup). */
export function getBoundaryMarksByBlock(tree: LayoutBox): ReadonlyMap<BlockId, readonly BoundaryMarkRect[]> {
  return boundaryMarkIndexOf(tree).byBlock;
}

/** The indexed (visible) rect of one mark box of `tree`; undefined when it is clipped away. */
export function boundaryMarkRectOf(tree: LayoutBox, box: MarkerBox): BoundaryMarkRect | undefined {
  return boundaryMarkIndexOf(tree).byBox.get(box);
}

function boundaryMarkIndexOf(tree: LayoutBox): BoundaryMarkIndex {
  const cached = _cache.get(tree);
  if (cached !== undefined) return cached;
  const all: BoundaryMarkRect[] = [];
  collect(tree, 0, 0, 0, undefined, ROOT_CLIP, all);
  const byBlock = new Map<BlockId, BoundaryMarkRect[]>();
  const byBox = new Map<MarkerBox, BoundaryMarkRect>();
  for (const m of all) {
    byBox.set(m.box, m);
    const list = byBlock.get(m.box.boundaryMark.blockId);
    if (list === undefined) byBlock.set(m.box.boundaryMark.blockId, [m]);
    else list.push(m);
  }
  const index = { all, byBlock, byBox };
  _cache.set(tree, index);
  return index;
}

function collect(
  box: LayoutBox,
  parentX: number,
  parentY: number,
  pageIndex: number,
  cumulative: Mat2D | undefined,
  clip: ClipState,
  out: BoundaryMarkRect[],
): void {
  if (box.type === "page") {
    const inPage = pageClip(box);
    for (const slot of [box.headerSlot, ...box.children, box.footerSlot, box.footnoteSlot]) {
      if (slot !== null) collect(slot, 0, 0, box.pageIndex, undefined, inPage, out);
    }
    return;
  }
  if (box.type === "text-run") return;
  const x = parentX + box.x;
  const y = parentY + box.y;
  if (box.type === "marker") {
    if (!isBoundaryMarkBox(box)) return;
    const visible = intersectClip(markClip(box, x, y, clip.clip), { x0: x, y0: y, x1: x + box.width, y1: y + box.height });
    if (visible.x1 <= visible.x0 || visible.y1 <= visible.y0) return;
    const rect = { box, x: visible.x0, y: visible.y0, width: visible.x1 - visible.x0, height: visible.y1 - visible.y0, pageIndex, glyphX: x, glyphY: y, outerClips: clip.outer };
    if (cumulative === undefined) out.push(rect);
    else {
      const inv = invert(cumulative);
      out.push({ ...rect, inverseTransform: inv === null ? "singular" : inv });
    }
    return;
  }
  const child = transformAt(box, x, y, cumulative);
  const inner = childClip(box, x, y, cumulative, child, clip);
  if (box.type === "multicolumn") {
    for (const col of box.columns) collect(col, x, y, pageIndex, child, columnClip(box.columns, col, x, y, inner), out);
  } else {
    for (const c of box.children) collect(c, x, y, pageIndex, child, inner, out);
  }
  if (box.absoluteChildren !== undefined) {
    for (const abs of box.absoluteChildren) collect(abs, x, y, pageIndex, child, inner, out);
  }
}

/**
 * A ¶'s float cap: an inline-end float narrowed its line, so its visible extent
 * ends `maxInlineSize` after its inline-start (the float's margin box edge).
 */
function markClip(box: BoundaryMarkBox, x: number, y: number, clip: Clip): Clip {
  const p = box.boundaryMark;
  if (p.maxInlineSize === undefined) return clip;
  const max = p.maxInlineSize;
  const am = axisMapFor(box.writingMode, box.computedStyle.direction);
  if (am.inline === "x") {
    return am.inlineReversed ? intersectClip(clip, { ...UNCLIPPED, x0: x + box.width - max }) : intersectClip(clip, { ...UNCLIPPED, x1: x + max });
  }
  return am.inlineReversed ? intersectClip(clip, { ...UNCLIPPED, y0: y + box.height - max }) : intersectClip(clip, { ...UNCLIPPED, y1: y + max });
}

export function isBoundaryMarkBox(box: MarkerBox): box is BoundaryMarkBox {
  return box.boundaryMark !== undefined;
}
