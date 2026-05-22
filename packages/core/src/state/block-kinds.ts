/**
 * Block-shape classification. Used by:
 *   - setBlockType to enforce shape-consistent type changes (T11).
 *   - editor/actions/insert-node.ts to translate legacy NewNode shape.
 *   - T31's future replacement of NewNode with BlockInit.
 *
 * Three kinds:
 *   - inline-bearing-leaf: has inlineContent items, no children
 *     (paragraph, heading)
 *   - atomic-leaf: no inlineContent (or empty), no children
 *     (image, horizontal-line)
 *   - container: has children, no inlineContent
 *     (document, list, list-item, table, table-row, table-cell, etc.)
 */

export type BlockKind = "inline-bearing-leaf" | "atomic-leaf" | "container";

export const INLINE_BEARING_LEAF_TYPES: ReadonlySet<string> = new Set([
  "paragraph",
  "heading",
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
