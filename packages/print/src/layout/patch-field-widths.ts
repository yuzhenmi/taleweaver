import type { ElementBox, RenderNode } from "@taleweaver/core";
import { PAGE_FIELD_EMBED_TYPE, CROSS_REFERENCE_EMBED_TYPE, type BlockId } from "@taleweaver/core";

/**
 * F-3 §4.4 growth mechanism. Produce a PATCHED copy of the cascaded template bodies
 * in which every layout-field atom (page-field or cross-ref-page) whose render key is
 * in `grownWidths` has its `computedStyle.inlineSize` overridden to the grown
 * (worst-case value) width — an explicit width the IFC honors over `auto` (ifc.ts uses
 * `cs.inlineSize` when set). The convergence loop passes the patched map to
 * `computeSlotInsets` so the header/footer slot height accounts for the widest
 * plausible field value.
 *
 * Spine-clones ONLY the path to each grown atom (structural-sharing; identity-
 * preserving elsewhere). Returns the SAME map ref when `grownWidths` is empty (the
 * common pass-1 case), and the SAME body ref for any body containing no grown field —
 * so within a single `computeSlotInsets` call its body-ref-keyed height memo still
 * coalesces a body that appears in multiple section boundaries (the memo is per-call,
 * not cross-iteration). NEVER mutates the frozen input. Mirrors the
 * `substituteLayoutFields` spine-clone primitive, overriding width instead of text.
 */
export function patchFieldWidths(
  templates: ReadonlyMap<BlockId, ElementBox>,
  grownWidths: ReadonlyMap<string, number>,
): ReadonlyMap<BlockId, ElementBox> {
  if (grownWidths.size === 0) return templates;
  const out = new Map<BlockId, ElementBox>();
  for (const [id, body] of templates) {
    const patched = patchNode(body, grownWidths);
    // patchNode preserves node type (an element clones to an element); narrow without a cast.
    out.set(id, patched.type === "element" ? patched : body);
  }
  return out;
}

/**
 * The main-body analogue of {@link patchFieldWidths}: patch a single cascaded root
 * `ElementBox` (not a template map) so each layout-field atom whose render key is in
 * `grownWidths` gets the grown `computedStyle.inlineSize`. Used by the §4.4 convergence
 * loop when the MAIN body hosts a layout-dependent field (a page-mode cross-reference),
 * so the IFC line-wraps the host block against the grown inline-block width. Spine-clones
 * only the path to each grown atom (identity-preserving); returns the SAME `root` ref when
 * `grownWidths` is empty (the common case). NEVER mutates the frozen input.
 */
export function patchRootFieldWidths(
  root: ElementBox,
  grownWidths: ReadonlyMap<string, number>,
): ElementBox {
  if (grownWidths.size === 0) return root;
  const patched = patchNode(root, grownWidths);
  // patchNode preserves node type (an element clones to an element); narrow without a cast.
  return patched.type === "element" ? patched : root;
}

function patchNode(node: RenderNode, grownWidths: ReadonlyMap<string, number>): RenderNode {
  if (node.type !== "element") return node;

  const grown = grownWidths.get(node.key);
  // Gate on the layout-field embed type (symmetric with `substituteLayoutFields`): grow
  // ONLY a page-field atom or a page-mode cross-reference placeholder, never some other
  // node that happens to share the key — a non-layout-field match would be silently
  // mis-sized AND skip recursion into its descendants. `grownWidths` is only ever keyed
  // by layout-field embed keys, so this guard is defence-in-depth against a future/test
  // caller, not a live path.
  const isLayoutField =
    node.metadata?.embedType === PAGE_FIELD_EMBED_TYPE ||
    (node.metadata?.embedType === CROSS_REFERENCE_EMBED_TYPE && node.metadata?.refMode === "page");
  if (grown !== undefined && node.computedStyle !== undefined && isLayoutField) {
    // Override this atom's inlineSize; keep children (the placeholder text) as-is.
    // A layout-field atom (page-field or cross-ref-page) has no nested layout-fields,
    // so there is nothing deeper to patch.
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
