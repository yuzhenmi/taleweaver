import type { BlockId } from "@taleweaver/core";
import type { VirtualLayoutTree } from "../layout/virtual-layout-tree";
import { type AbsoluteLineBox, getLineIndex } from "./line-flatten";

/**
 * Collect a block's line fragments across the pages it spans, in page order.
 *
 * The returned lines carry PAGE-LOCAL geometry (each from its own `PageBox`
 * frame) — this list is for the OFFSET domain (cross-fragment ordering /
 * find-by-offset for spanning-block navigation), NOT a uniform document-absolute
 * coordinate space. Geometry of a chosen line resolves per-page via
 * `tree.getPage(line.pageIndex)`. See docs/superpowers/specs/2026-06-09-vl-bridge-removal-design.md.
 */
export function collectBlockLinesAcrossPages(
  tree: VirtualLayoutTree,
  blockId: BlockId,
  span: { readonly first: number; readonly last: number },
): AbsoluteLineBox[] {
  const out: AbsoluteLineBox[] = [];
  for (let p = span.first; p <= span.last; p++) {
    const lines = getLineIndex(tree.getPage(p)).byBlock.get(blockId);
    if (lines !== undefined) out.push(...lines);
  }
  return out;
}
