/**
 * Block-shape classification. Used by:
 *   - setBlockType to enforce shape-consistent type changes (T11).
 *   - editor/actions/insert-node.ts to translate legacy NewNode shape.
 *   - T31's future replacement of NewNode with BlockInit.
 *
 * Three kinds:
 *   - inline-bearing-leaf: has inlineContent items, no children
 *     (paragraph, heading, list-item)
 *   - atomic-leaf: no inlineContent (or empty), no children
 *     (image, horizontal-line)
 *   - container: has children, no inlineContent
 *     (document, list, table, table-row, table-cell, etc.)
 *
 * Note on list-item: classified as an inline-bearing leaf because the
 * data model treats it that way — every fixture across state tests
 * (`merge-blocks`, `delete-range`, `split-block`, `clone-pasted-subtree`)
 * builds list-items with `inlineContent`, never with `firstChildId`; the
 * `Block` JSDoc lists list-item alongside paragraph as leaf-shaped; and
 * the toggle-list / set-block-type editor handlers convert paragraphs to
 * list-items in place (preserving the inlineContent slot). Layout-side,
 * the BFC marker generator keys off `display: list-item` on the rendered
 * ElementBox and does not require a containing `list` block. Nesting list
 * inside list (sub-lists) is achieved by a `list` container wrapping
 * further list-items, not by list-item itself owning children. P10
 * ("Lists with proper markers") wires this up end-to-end with counters;
 * the leaf classification is the underlying data-model shape it lands on.
 */

export type BlockKind = "inline-bearing-leaf" | "atomic-leaf" | "container";

export const INLINE_BEARING_LEAF_TYPES: ReadonlySet<string> = new Set([
  "paragraph",
  "heading",
  "list-item",
]);

export const ATOMIC_LEAF_TYPES: ReadonlySet<string> = new Set([
  "image",
  "horizontal-line",
]);

export function blockKindOf(type: string): BlockKind {
  if (INLINE_BEARING_LEAF_TYPES.has(type)) return "inline-bearing-leaf";
  if (ATOMIC_LEAF_TYPES.has(type)) return "atomic-leaf";
  return "container";
}
