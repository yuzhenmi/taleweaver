import type { ElementBox, RenderNode } from "../render/render-node";
import { PAGE_FIELD_EMBED_TYPE, type BlockId } from "../state";

/**
 * F-3 §4.4 growth mechanism. Produce a PATCHED copy of the cascaded template bodies
 * in which every page-field atom whose render key is in `grownWidths` has its
 * `computedStyle.inlineSize` overridden to the grown (worst-case value) width — an
 * explicit width the IFC honors over `auto` (ifc.ts uses `cs.inlineSize` when set).
 * The convergence loop passes the patched map to `computeSlotInsets` so the header/
 * footer slot height accounts for the widest plausible field value.
 *
 * Spine-clones ONLY the path to each grown atom (structural-sharing; identity-
 * preserving elsewhere). Returns the SAME map ref when `grownWidths` is empty (the
 * common pass-1 case), and the SAME body ref for any body containing no grown field —
 * so within a single `computeSlotInsets` call its body-ref-keyed height memo still
 * coalesces a body that appears in multiple section boundaries (the memo is per-call,
 * not cross-iteration). NEVER mutates the frozen input. Mirrors the
 * `substitutePageFields` spine-clone primitive, overriding width instead of text.
 */
export function patchFieldWidths(
  templates: ReadonlyMap<BlockId, ElementBox>,
  grownWidths: ReadonlyMap<string, number>,
): ReadonlyMap<BlockId, ElementBox> {
  if (grownWidths.size === 0) return templates;
  const out = new Map<BlockId, ElementBox>();
  for (const [id, body] of templates) {
    out.set(id, patchNode(body, grownWidths) as ElementBox);
  }
  return out;
}

function patchNode(node: RenderNode, grownWidths: ReadonlyMap<string, number>): RenderNode {
  if (node.type !== "element") return node;

  const grown = grownWidths.get(node.key);
  // Gate on the page-field embed type (symmetric with `substitutePageFields`): grow
  // ONLY a page-field atom, never some other node that happens to share the key — a
  // non-page-field match would be silently mis-sized AND skip recursion into its
  // descendants. `grownWidths` is only ever keyed by page-field embed keys, so this
  // guard is defence-in-depth against a future/test caller, not a live path.
  if (
    grown !== undefined &&
    node.computedStyle !== undefined &&
    node.metadata?.embedType === PAGE_FIELD_EMBED_TYPE
  ) {
    // Override this atom's inlineSize; keep children (the placeholder text) as-is.
    // A page-field atom has no nested page-fields, so there is nothing deeper to patch.
    return Object.freeze({
      ...node,
      computedStyle: Object.freeze({ ...node.computedStyle, inlineSize: grown }),
    });
  }

  // Recurse; clone only if a descendant changed (identity-preserving).
  let changed = false;
  const newChildren = node.children.map((child) => {
    const next = patchNode(child, grownWidths);
    if (next !== child) changed = true;
    return next;
  });
  if (!changed) return node;
  return Object.freeze({ ...node, children: Object.freeze(newChildren) });
}
