import type { State } from "./state";
import { getEmbedContent } from "./state";
import type { BlockId } from "./block-id";
import type { InlineContent } from "./inline-content";

/**
 * Embed-content cascade-delete helpers shared by ops that drop inline
 * content (removeBlock, deleteRange, and any future op that removes
 * an EmbedItem from a leaf's items).
 *
 * Per the spec's "no orphaned blocks" invariant, an EmbedItem whose
 * `properties.contentBlockId` references a block in `state.embedContents`
 * owns that referenced subtree. When the EmbedItem is dropped (because
 * its containing block is removed, or because the inline portion holding
 * it is deleted), the referenced subtree must be cascade-deleted to
 * preserve the invariant.
 *
 * Cycle-defended: every walker uses an `out` Set as a visited marker.
 */

/**
 * Walk an embed-content subtree rooted at `rootId` and add every visited
 * id to `out`. Follows both child links (descendants of the embed-content
 * block in the embedContents map) and nested
 * `EmbedItem.properties.contentBlockId` references in this
 * embed-content's inlineContent (e.g., a footnote whose body contains
 * another footnote anchor). Cycle-defended: a block already in `out`
 * is not re-visited.
 *
 * Gracefully no-ops if `rootId` is not in `state.embedContents` — this
 * handles the case where two anchors reference the same body and one
 * has already been processed in an earlier cascade pass.
 */
export function collectEmbedContentSubtree(
  state: State,
  rootId: BlockId,
  out: Set<BlockId>,
): void {
  if (out.has(rootId)) return;
  const block = getEmbedContent(state, rootId);
  if (block === null) return;
  out.add(rootId);
  // Children of an embed-content block (if any) are themselves embed-content.
  let childId = block.firstChildId;
  while (childId !== null) {
    if (out.has(childId)) break;
    collectEmbedContentSubtree(state, childId, out);
    const child = getEmbedContent(state, childId);
    childId = child?.nextSiblingId ?? null;
  }
  // Nested embed-content references in this embed-content's inlineContent.
  if (block.inlineContent !== null) {
    collectEmbedContentSubtreeFromInlineContent(state, block.inlineContent, out);
  }
}

/**
 * Walk an InlineContent for `EmbedItem.properties.contentBlockId`
 * references and collect each referenced embed-content subtree into
 * `out` via `collectEmbedContentSubtree`.
 *
 * Used by `removeBlock` (every block in the removed subtree's inline
 * content) and `deleteRange` (the DELETED inline portion — anchor
 * suffix + intervening leaves + focus prefix on cross-block; or the
 * `[anchor.offset .. focus.offset)` slice on same-block).
 *
 * Cycle-defended via the shared `out` Set.
 */
export function collectEmbedContentSubtreeFromInlineContent(
  state: State,
  content: InlineContent,
  out: Set<BlockId>,
): void {
  for (const item of content.items) {
    if (item.kind !== "embed") continue;
    const cbId = item.properties.contentBlockId;
    if (typeof cbId !== "string") continue;
    collectEmbedContentSubtree(state, cbId as BlockId, out);
  }
}
