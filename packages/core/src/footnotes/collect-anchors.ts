/**
 * @module footnotes/collect-anchors
 *
 * Walk the MAIN document tree in document order and collect every footnote
 * anchor (`EmbedItem` with `embedType === FOOTNOTE_ANCHOR_EMBED_TYPE` and a
 * string `properties.contentBlockId`) as a `FootnoteAnchorRef`, tagged with its
 * enclosing section. The ordered list is the input to the numbering engine
 * (`numbering.ts`).
 *
 * Reuses the Layer-2 doc-order traversal (`nextBlockInDocOrder`) and ancestor
 * walk (`ancestorChain`) rather than hand-rolling a fragile recursion. Starting
 * the walk at `state.rootId` keeps it within the main `blocks` tree — the
 * footnote BODIES live in `embedContents` (roots with `parentId === null`) and
 * are never reached from the main tree, so this collects anchors only, not body
 * content.
 */
import {
  ancestorChain,
  asBlockId,
  getBlock,
  nextBlockInDocOrder,
  FOOTNOTE_ANCHOR_EMBED_TYPE,
  type BlockId,
  type State,
} from "../state";
import type { FootnoteAnchorRef } from "./types";

/**
 * The block `type` that opens a section (flat, never nested under root).
 *
 * The canonical source of truth for this literal. The render pass imports it
 * (via the footnotes barrel) for its FN-8 anchor-reuse guard, which treats a
 * dirty `section` block as a possible anchor-rescope. Keep this the only
 * declaration.
 */
export const SECTION_BLOCK_TYPE = "section";

/**
 * The shared frozen empty anchor list. Returned by the per-keystroke
 * footnote-free guards (`docHasFootnotes(state) === false`) in render and the
 * editor rebuild path so a document with no footnotes never pays the
 * `collectFootnoteAnchors` O(N_blocks) walk (FN-8). Frozen + shared so the
 * guard allocates nothing.
 */
export const EMPTY_FOOTNOTE_ANCHORS: readonly FootnoteAnchorRef[] = Object.freeze(
  [],
);

/**
 * Collect every footnote anchor in the main document, in document order.
 *
 * For each leaf block (one with `inlineContent`), each `EmbedItem` that is a
 * footnote anchor with a string `contentBlockId` yields one `FootnoteAnchorRef`,
 * in `inlineContent` order. `sectionId` is the nearest enclosing `section`
 * block, or `null` when the anchor's block sits in the implicit root section
 * (no `section` ancestor before the document root).
 */
export function collectFootnoteAnchors(
  state: State,
): readonly FootnoteAnchorRef[] {
  const refs: FootnoteAnchorRef[] = [];

  let currentId: BlockId | null = state.rootId;
  while (currentId !== null) {
    const block = getBlock(state, currentId);
    if (block === null) break;

    if (block.inlineContent !== null) {
      const sectionId = nearestSectionId(state, currentId);
      for (const item of block.inlineContent.items) {
        if (item.kind !== "embed") continue;
        if (item.embedType !== FOOTNOTE_ANCHOR_EMBED_TYPE) continue;
        const contentBlockId = item.properties.contentBlockId;
        if (typeof contentBlockId !== "string") continue;
        refs.push({
          contentBlockId: asBlockId(contentBlockId),
          blockId: currentId,
          sectionId,
        });
      }
    }

    currentId = nextBlockInDocOrder(state, currentId);
  }

  return refs;
}

/**
 * The id of the nearest `section`-type ancestor of `blockId` (inclusive of
 * `blockId` itself, though leaves are never sections), or `null` if none —
 * meaning the block is in the implicit root section. Sections are flat children
 * of the document root, so the nearest section ancestor IS the section.
 */
function nearestSectionId(state: State, blockId: BlockId): BlockId | null {
  for (const ancestorId of ancestorChain(state, blockId)) {
    if (getBlock(state, ancestorId)?.type === SECTION_BLOCK_TYPE) {
      return ancestorId;
    }
  }
  return null;
}
