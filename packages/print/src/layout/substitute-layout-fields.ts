import type { ElementBox, RenderNode } from "@taleweaver/core";
import { formatCounter } from "@taleweaver/core";
import { PAGE_FIELD_EMBED_TYPE } from "@taleweaver/core";
import { CROSS_REFERENCE_EMBED_TYPE } from "@taleweaver/core";
import { BROKEN_CROSS_REFERENCE_TEXT } from "@taleweaver/core";
import { isDevMode } from "@taleweaver/core";

/**
 * Spine-clone `body` to each layout-field leaf, replacing its placeholder text with the
 * value for THIS page. Two field families are handled:
 *
 * Page-fields (`embedType === "page-field"`):
 *   - `page-number` → `formatCounter(pageIndex + 1, numberStyle)` (1-based, self-page).
 *   - `page-count` (and other document-global fields) → `globalFieldValues.get(embedKey)`.
 *
 * Cross-ref-page (`embedType === "cross-reference" && refMode === "page"`):
 *   - the target's resolved page number, read from `globalFieldValues.get(embedKey)`
 *     (computed by `resolvePageFields`). A real page number passes through as-is; the
 *     `""` (empty-string) broken-ref sentinel maps to `BROKEN_CROSS_REFERENCE_TEXT`
 *     (the same error text the render-time broken path shows). An ABSENT entry (no map
 *     key — e.g. a no-field run that resolved nothing) leaves the placeholder unchanged.
 *
 * Everything not on a path to a layout-field keeps its ORIGINAL ref (structural-sharing,
 * identity-preserving), so the substituted body is cheap and only the field leaves
 * differ. Returns the SAME `body` ref if it contains no layout-fields (so callers can
 * `===`-check to skip work). Mirrors the FN-6.2b late-binding precedent; NEVER mutates
 * the frozen input.
 *
 * A `page-count` whose global value is ABSENT (e.g. a page-number-only materialize run
 * that built no `globalFieldValues`) is left UNCHANGED — never fabricate a digit. The
 * IFC token identity is preserved because the atom's render key is unchanged and only
 * the inner text box's `text` is replaced (the offset↔box 1:1 invariant, #407, holds).
 */
export function substituteLayoutFields(
  body: ElementBox,
  pageIndex: number,
  globalFieldValues: ReadonlyMap<string, string>,
): ElementBox {
  const next = substNode(body, pageIndex, globalFieldValues);
  // substNode returns the same ElementBox ref when nothing changed.
  return next as ElementBox;
}

function substNode(node: RenderNode, pageIndex: number, globals: ReadonlyMap<string, string>): RenderNode {
  if (node.type !== "element") return node;

  const md = node.metadata;
  if (md?.embedType === PAGE_FIELD_EMBED_TYPE && md.fieldKind !== undefined) {
    const value =
      md.fieldKind === "page-number"
        ? formatCounter(pageIndex + 1, md.numberStyle ?? "decimal")
        : globals.get(node.key);
    if (value === undefined) return node; // page-count with no global value → leave the placeholder
    // A page-field atom has EXACTLY one child — the placeholder text box (the render
    // branch always emits `[createTextBox(...)]`). Replace its text; clone nothing else.
    const childText = node.children[0];
    if (node.children.length !== 1 || childText === undefined || childText.type !== "text") {
      if (isDevMode()) {
        throw new Error(
          `substituteLayoutFields: page-field atom "${node.key}" must have exactly one text child (got ${node.children.length})`,
        );
      }
      return node; // prod: leave unchanged rather than silently mangle a malformed atom
    }
    const newChild = Object.freeze({ ...childText, text: value });
    return Object.freeze({ ...node, children: Object.freeze([newChild]) });
  } else if (md?.embedType === CROSS_REFERENCE_EMBED_TYPE && md.refMode === "page") {
    const value = globals.get(node.key);
    if (value === undefined) return node; // unresolved (e.g. a no-field run) → leave placeholder
    // resolvePageFields stores "" as the broken-ref sentinel; map it to the same error
    // text the render-time broken path shows. A real page number passes through as-is.
    const realText = value === "" ? BROKEN_CROSS_REFERENCE_TEXT : value;
    // A cross-ref-page atom has EXACTLY one child — the placeholder text box.
    const childText = node.children[0];
    if (node.children.length !== 1 || childText === undefined || childText.type !== "text") {
      if (isDevMode()) {
        throw new Error(
          `substituteLayoutFields: cross-ref-page atom "${node.key}" must have exactly one text child (got ${node.children.length})`,
        );
      }
      return node; // prod: leave unchanged rather than mangle a malformed atom
    }
    const newChild = Object.freeze({ ...childText, text: realText });
    return Object.freeze({ ...node, children: Object.freeze([newChild]) });
  }

  // Recurse; clone only if a descendant changed (identity-preserving).
  let changed = false;
  const newChildren = node.children.map((child) => {
    const next = substNode(child, pageIndex, globals);
    if (next !== child) changed = true;
    return next;
  });
  if (!changed) return node;
  return Object.freeze({ ...node, children: Object.freeze(newChildren) });
}
