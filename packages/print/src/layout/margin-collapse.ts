import type { ComputedStyle, ElementBox, UsedStyle } from "@taleweaver/core";
import { computeUsedStyle } from "./used-style";
import { establishesNewBFC } from "./bfc-establishment";
import { flattenContents, isInlineChild } from "./group-children";
import { resolveExplicitBlockSizeOrNull } from "./collapse-through";
import { blockEndDecoration, contentBlockStart } from "./box-block-decoration";
import { borderBoxInlineSize, inlineDecoration } from "./box-inline-decoration";

// CSS 2.1 §8.3.1 parent/child margin collapsing, shared by bfc and the measure
// pass (build-fit-metas → fit-core) so both place the same collapsed margins.
// A box's start margin adjoins its first in-flow child's when nothing separates
// them (no start border / padding, not a BFC root, no clearance); its end margin
// adjoins its last in-flow child's when it also has an auto block size. The
// parent then places that child flush and the collapsed margin is applied once,
// outside it, by the grandparent. Collapse is `max` (the engine's sibling rule).

/** Does `cs`'s block-start margin adjoin its first in-flow child's? */
export function startCollapsesThrough(cs: ComputedStyle, us: UsedStyle, isBFCRoot: boolean): boolean {
  return !isBFCRoot && cs.display !== "table" && contentBlockStart(us) === 0;
}

/** Does `cs`'s block-end margin adjoin its last in-flow child's? */
export function endCollapsesThrough(cs: ComputedStyle, us: UsedStyle, isBFCRoot: boolean, containingInlineSize: number): boolean {
  return !isBFCRoot && cs.display !== "table" && blockEndDecoration(us) === 0
    && resolveExplicitBlockSizeOrNull(cs.blockSize, containingInlineSize) === null;
}

/** An in-flow element child: its style, or undefined for a float / abs-pos / non-element. */
function inFlowStyle(node: ElementBox["children"][number]): ComputedStyle | undefined {
  if (node.type !== "element" || node.computedStyle === undefined) return undefined;
  const cs = node.computedStyle;
  return cs.float !== "none" || cs.position === "absolute" ? undefined : cs;
}

// ponytail: percentages resolve against an auto-or-px width only (a percent
// `inline-size` reads as auto); exact for every non-percent-margin document.
function childContainingInlineSize(cs: ComputedStyle, us: UsedStyle, containingInlineSize: number): number {
  const available = containingInlineSize - us.marginInlineStart - us.marginInlineEnd;
  const own = typeof cs.inlineSize === "number" ? borderBoxInlineSize(cs.inlineSize, us) : available;
  return own - inlineDecoration(us);
}

/**
 * A box with no in-flow content and no block decoration or size: it lays out 0
 * tall and its margins collapse through it (bfc's empty-block rule), decided
 * from the tree before layout.
 */
export function hasNoInFlowContent(node: ElementBox, cs: ComputedStyle, us: UsedStyle, containingInlineSize: number): boolean {
  const explicit = resolveExplicitBlockSizeOrNull(cs.blockSize, containingInlineSize);
  if ((explicit !== null && explicit !== 0) || contentBlockStart(us) + blockEndDecoration(us) > 0 || cs.display === "table") return false;
  const encloseFloats = establishesNewBFC(cs);
  const inner = childContainingInlineSize(cs, us, containingInlineSize);
  for (const child of flattenContents(node.children)) {
    if (isInlineChild(child)) return false;
    if (child.type !== "element" || child.computedStyle === undefined) continue;
    const ccs = child.computedStyle;
    if (ccs.position === "absolute") continue;
    if (ccs.float !== "none") {
      if (encloseFloats) return false;
      continue;
    }
    if (!hasNoInFlowContent(child, ccs, computeUsedStyle(ccs, inner, "indefinite"), inner)) return false;
  }
  return true;
}

/**
 * The block-start margin `node` presents to its parent: its own, collapsed with
 * its first in-flow children's (through empty ones) when they adjoin.
 */
export function collapsedMarginBlockStart(node: ElementBox, cs: ComputedStyle, us: UsedStyle, containingInlineSize: number): number {
  let m = us.marginBlockStart;
  if (!startCollapsesThrough(cs, us, establishesNewBFC(cs))) return m;
  const inner = childContainingInlineSize(cs, us, containingInlineSize);
  for (const child of flattenContents(node.children)) {
    if (isInlineChild(child)) return m;
    const ccs = inFlowStyle(child);
    if (ccs === undefined || child.type !== "element") continue;
    // Clearance separates the margins (bfc stops collapsing at a `clear` child).
    if (ccs.clear !== "none") return m;
    const cus = computeUsedStyle(ccs, inner, "indefinite");
    m = Math.max(m, collapsedMarginBlockStart(child, ccs, cus, inner));
    if (!hasNoInFlowContent(child, ccs, cus, inner)) return m;
    m = Math.max(m, collapsedMarginBlockEnd(child, ccs, cus, inner));
  }
  return m;
}

/**
 * The block-end margin `node` presents to its next sibling: its own, collapsed
 * with its last in-flow children's (through empty ones) when they adjoin.
 */
export function collapsedMarginBlockEnd(node: ElementBox, cs: ComputedStyle, us: UsedStyle, containingInlineSize: number): number {
  let m = us.marginBlockEnd;
  if (!endCollapsesThrough(cs, us, establishesNewBFC(cs), containingInlineSize)) return m;
  const inner = childContainingInlineSize(cs, us, containingInlineSize);
  const children = flattenContents(node.children);
  for (let i = children.length - 1; i >= 0; i--) {
    const child = children[i];
    if (child === undefined || isInlineChild(child)) return m;
    const ccs = inFlowStyle(child);
    if (ccs === undefined || child.type !== "element") continue;
    const cus = computeUsedStyle(ccs, inner, "indefinite");
    m = Math.max(m, collapsedMarginBlockEnd(child, ccs, cus, inner));
    if (!hasNoInFlowContent(child, ccs, cus, inner)) return m;
    m = Math.max(m, collapsedMarginBlockStart(child, ccs, cus, inner));
  }
  return m;
}
