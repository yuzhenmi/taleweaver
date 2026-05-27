/**
 * Block-shape taxonomy.
 *
 * Three kinds:
 *   - inline-bearing-leaf: has inlineContent items, no children
 *     (paragraph, heading, list-item)
 *   - atomic-leaf: no inlineContent (or empty), no children
 *     (image, horizontal-line)
 *   - container: has children, no inlineContent
 *     (document, list, table, table-row, table-cell, etc.)
 *
 * The state module does NOT hardcode type-string sets. Taxonomy is owned
 * by component definitions in the component module — leaf components
 * declare `leafShape: "inline-bearing" | "atomic"` and container
 * components carry `kind: "container"`. State ops that need to judge
 * shape (e.g., `setBlockType` for cross-kind refusal, `INSERT_NODE`'s
 * shape validation) accept a `BlockKindResolver` parameter and consult
 * it. The component registry implements `BlockKindResolver`. This keeps
 * the state module free of component-type knowledge — third-party
 * components plug in via the registry without state changes.
 *
 * Note on list-item: declared inline-bearing by its component definition
 * because the data model treats it that way — every fixture across state
 * tests (`merge-blocks`, `delete-range`, `split-block`,
 * `clone-pasted-subtree`) builds list-items with `inlineContent`, never
 * with `firstChildId`; the `Block` JSDoc lists list-item alongside
 * paragraph as leaf-shaped; and the toggle-list / set-block-type editor
 * handlers convert paragraphs to list-items in place (preserving the
 * inlineContent slot). Layout-side, the BFC marker generator keys off
 * `display: list-item` on the rendered ElementBox and does not require a
 * containing `list` block. Nesting list inside list (sub-lists) is
 * achieved by a `list` container wrapping further list-items, not by
 * list-item itself owning children. P10 ("Lists with proper markers")
 * wires this up end-to-end with counters; the leaf classification is the
 * underlying data-model shape it lands on.
 */

export type BlockKind = "inline-bearing-leaf" | "atomic-leaf" | "container";

/**
 * Resolver interface for "what kind is this block type?" The component
 * module's `ComponentRegistry` implements this. State ops that need to
 * judge shape (e.g., `setBlockType`'s cross-kind refusal) accept a
 * resolver rather than hardcoding type-string sets. This keeps the
 * state module free of component-type knowledge.
 */
export interface BlockKindResolver {
  /**
   * Returns the block type's kind, or null for an unregistered type —
   * callers MUST decide how to handle null (typically by throwing a
   * "type 'X' is not registered" error at the action-handler boundary).
   */
  getBlockKind(type: string): BlockKind | null;
}
