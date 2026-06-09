import type { BlockBox, LayoutBox } from "./layout-box";
import { rebuildBoxWithOffsets } from "./layout-box";

/**
 * P3.1 — the vertical-rl post-layout physicalize pass (C-1 option B).
 *
 * For `writing-mode: vertical-rl`, a box's physical block-axis coordinate is the
 * right-to-left mirror `x = containerBlockSize − blockOffset − blockSize`. But
 * `containerBlockSize` is `"indefinite"` at box-factory time — an auto-size
 * block's block extent is the OUTPUT of laying out its children, not an input —
 * so the factory stores the un-mirrored PENDING x (`x = blockOffset`). This pass
 * runs AFTER `layoutBlock` returns its frozen tree (every container's `blockSize`
 * is now resolved on its box) and bakes the mirror in, producing a fully-physical
 * tree where `box.x`/`box.y` are authoritative for every consumer.
 *
 * Recursion: each box is mirrored against ITS OWN container's resolved
 * `blockSize`; its children are then physicalized against THIS box's `blockSize`
 * (this box is their container). Because the rebuild is PARENT-RELATIVE, the
 * existing consumer accumulation (`absoluteX += parent.x`) composes the correct
 * absolute x at any nesting depth (verified 2 levels in the design: page P,
 * container (b1,s1), grandchild (b2,s2) → grandchild abs x = P−b1−b2−s2).
 *
 * No-op for the common case: `horizontal-tb` and `vertical-lr` are fully
 * factory-derivable (no block-axis mirror), so this returns the input box
 * UNCHANGED (same reference) — zero cost, byte-identical for all existing content.
 *
 * @param box the frozen layout box to physicalize.
 * @param containerBlockSize the box's containing-block block-size — the size the
 *   box's block-axis x is mirrored against. For a top-level page-content box this
 *   is the page CONTENT block-size.
 * @returns a fully-physical box: the SAME reference for non-vertical-rl, or a NEW
 *   frozen tree with the mirror baked in for vertical-rl.
 */
export function physicalizeVertical(
  box: LayoutBox,
  containerBlockSize: number,
): LayoutBox {
  // Fast top-level early-return: horizontal-tb AND vertical-lr are already
  // correct from the factory (no block-axis mirror needed). Returning the input
  // unchanged keeps non-vertical-rl trees zero-cost + byte-identical.
  if (box.writingMode !== "vertical-rl") return box;
  return physicalizeVrl(box, containerBlockSize);
}

/**
 * Physicalize a PageBox named slot (`headerSlot` / `footerSlot` / `footnoteSlot`,
 * always a `BlockBox` or null). Mirrors the slot's v-rl content against the page
 * content block-size. The slot is itself a `BlockBox`, and `physicalizeVertical`
 * preserves box type (it rebuilds via the matching factory), so the result stays
 * a `BlockBox`.
 */
function physicalizeSlot(
  slot: BlockBox | null,
  containerBlockSize: number,
): BlockBox | null {
  if (slot === null) return null;
  const phys = physicalizeVertical(slot, containerBlockSize);
  if (phys.type !== "block") {
    throw new Error(
      `physicalizeVertical: a PageBox slot changed type to ${phys.type} (expected block)`,
    );
  }
  return phys;
}

/**
 * Physicalize a known `vertical-rl` box: mirror its block-axis x against
 * `containerBlockSize`, then recurse into its children (and, for a PageBox, its
 * named header/footer/footnote slots) with this box as their container.
 *
 * The PageBox FRAME (its own page placement) is NOT writing-mode-mirrored — only
 * the page CONTENT is. So a PageBox keeps its frame coords and we recurse into
 * its content/slots against the supplied page-content block-size; a non-page box
 * gets its block-axis x mirrored.
 */
function physicalizeVrl(box: LayoutBox, containerBlockSize: number): LayoutBox {
  if (box.type === "page") {
    // Page frame stays as pagination placed it; only content/slots are mirrored,
    // against the page CONTENT block-size (the value handed to this pass).
    const newChildren = box.children.map((c) =>
      physicalizeVertical(c, containerBlockSize),
    );
    // A PageBox FRAME never establishes an abc (positioning establishment happens
    // on the body block boxes inside it), so `absoluteChildren` is always absent
    // here — but physicalize them for union coherence if ever present, against the
    // SAME page-content block-size the page's in-flow `children` use as container.
    const newAbsoluteChildren = box.absoluteChildren?.map((c) =>
      physicalizeVertical(c, containerBlockSize),
    );
    return Object.freeze({
      ...box,
      children: Object.freeze(newChildren),
      ...(newAbsoluteChildren !== undefined
        ? { absoluteChildren: Object.freeze(newAbsoluteChildren) }
        : {}),
      headerSlot: physicalizeSlot(box.headerSlot, containerBlockSize),
      footerSlot: physicalizeSlot(box.footerSlot, containerBlockSize),
      footnoteSlot: physicalizeSlot(box.footnoteSlot, containerBlockSize),
    });
  }

  if (box.type === "multicolumn") {
    // A MultiColumnBox is a CONTAINER whose `columns` (BlockBoxes) live in its own
    // frame. Mirror the container's block-axis x, then recurse each column against
    // THIS box's resolved block-size — the generic `"children" in box` path below
    // would skip `columns` (no `children` field) and leave the columns un-mirrored.
    // NOTE: vertical-mode multicol is OUT v1 (the design declares columns a
    // horizontal-mode feature), so no producer reaches here today; this arm keeps
    // the pass type-complete should vertical multicol ever be added.
    const cisMc = box.y + box.inlineOffset + box.inlineSize;
    const mirroredMc = rebuildBoxWithOffsets(
      box, box.inlineOffset, box.blockOffset, cisMc, containerBlockSize,
    );
    if (mirroredMc.type !== "multicolumn") {
      throw new Error(
        `physicalizeVertical: a MultiColumnBox changed type to ${mirroredMc.type} on rebuild`,
      );
    }
    const newColumns = mirroredMc.columns.map((col) => {
      const phys = physicalizeVertical(col, mirroredMc.blockSize);
      if (phys.type !== "block") {
        throw new Error(
          `physicalizeVertical: a MultiColumnBox column changed type to ${phys.type} (expected block)`,
        );
      }
      return phys;
    });
    // Abs-pos descendants anchored to the MultiColumnBox itself live in its own
    // frame — physicalize them against THIS box's resolved block-size, exactly as
    // the generic path does for `children`'s peers. Omitting this would leave a
    // vertical-mode multicol's abs-pos child on un-mirrored logical coords.
    const newAbsoluteChildrenMc = mirroredMc.absoluteChildren?.map((c) =>
      physicalizeVertical(c, mirroredMc.blockSize),
    );
    return Object.freeze({
      ...mirroredMc,
      columns: Object.freeze(newColumns),
      ...(newAbsoluteChildrenMc !== undefined
        ? { absoluteChildren: Object.freeze(newAbsoluteChildrenMc) }
        : {}),
    });
  }

  // Mirror THIS box's block-axis x against its container's resolved block-size.
  // The rebuild re-runs the factory with the resolved containingBlockSize so the
  // physical fields (mirrored x; unchanged inline-axis y/width/height) stay
  // consistent with the logical fields per the LayoutBox invariant.
  //
  // The inline-axis y depends on the box's containingInlineSize: under RTL it is
  // `containingInlineSize − inlineOffset − inlineSize`. Recover the SAME value
  // the original factory used so y is preserved exactly:
  //   RTL: y = CIS − inlineOffset − inlineSize ⇒ CIS = y + inlineOffset + inlineSize.
  //   LTR: y = inlineOffset (CIS irrelevant) ⇒ the recovered value is harmless.
  const containingInlineSize = box.y + box.inlineOffset + box.inlineSize;
  const mirrored = rebuildBoxWithOffsets(
    box,
    box.inlineOffset,
    box.blockOffset,
    containingInlineSize,
    containerBlockSize,
  );

  // Recurse abs-pos descendants (if any) against THIS box's resolved blockSize.
  // They are positioned in THIS box's OWN frame — the same frame its in-flow
  // `children` live in — so they take the SAME container block-size the children
  // recursion uses (`mirrored.blockSize`), NOT the outer `containerBlockSize`. An
  // abs-establishing box can carry `absoluteChildren` even with empty `children`,
  // so this must be handled independently of the children early-return below.
  const newAbsoluteChildren = mirrored.absoluteChildren?.map((c) =>
    physicalizeVertical(c, mirrored.blockSize),
  );

  // Recurse into children with THIS box as their container (its resolved
  // blockSize is the child's containing block-size). Only container box types
  // carry children; leaves (text-run / marker) have none.
  const hasChildren = "children" in mirrored && mirrored.children.length > 0;
  if (!hasChildren && newAbsoluteChildren === undefined) {
    return mirrored;
  }
  const newChildren = hasChildren
    ? mirrored.children.map((c) => physicalizeVertical(c, mirrored.blockSize))
    : undefined;
  return Object.freeze({
    ...mirrored,
    ...(newChildren !== undefined ? { children: Object.freeze(newChildren) } : {}),
    ...(newAbsoluteChildren !== undefined
      ? { absoluteChildren: Object.freeze(newAbsoluteChildren) }
      : {}),
  });
}
