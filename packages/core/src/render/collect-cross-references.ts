import {
  iterateBlocksInDocumentOrder,
  CROSS_REFERENCE_EMBED_TYPE,
  asBlockId,
} from "../state";
import type { Block, BlockId, State } from "../state";

/**
 * Reverse index `targetId → [host blockIds]` over every cross-reference field in
 * the document. A cross-reference is an inline `EmbedItem{embedType:
 * "cross-reference", properties.targetId}` that DISPLAYS a target it does not
 * own; the index lets the incremental render pass answer "which blocks must
 * re-render because this target's value changed?" in O(1) per target.
 *
 * Why a reverse index and not a forward scan: when a target block is edited or
 * deleted, the edit's `dirtyIds` names the TARGET, not the host(s) that
 * reference it. The host's cached RenderNode carries the now-stale resolved
 * string (number or text), so it must be invalidated even though its own
 * content is unchanged — exactly the footnote-renumber / list-renumber problem,
 * here keyed the other way (target→hosts instead of anchor→number).
 *
 * Scope: the MAIN body tree, walked in document order (mirrors
 * `collectFootnoteAnchors`). A host inside an embed/template body is not indexed
 * in v1 — cross-references are inserted into the body, matching the editing
 * action's reach. Targets are likewise main-tree blocks (the S2 resolver uses
 * `getBlock`, not `resolveBlock`).
 */
export function buildCrossReferenceIndex(
  state: State,
): ReadonlyMap<BlockId, ReadonlyArray<BlockId>> {
  const index = new Map<BlockId, BlockId[]>();
  for (const block of iterateBlocksInDocumentOrder(state)) {
    if (block.inlineContent === null) continue;
    for (const item of block.inlineContent.items) {
      if (item.kind !== "embed") continue;
      if (item.embedType !== CROSS_REFERENCE_EMBED_TYPE) continue;
      const targetId = item.properties.targetId;
      if (typeof targetId !== "string") continue;
      const target = asBlockId(targetId);
      const hosts = index.get(target);
      if (hosts === undefined) {
        index.set(target, [block.id]);
      } else if (hosts[hosts.length - 1] !== block.id) {
        // A host with two refs to the SAME target appears once (the inner loop
        // visits its items in order, so a duplicate is always the last entry).
        hosts.push(block.id);
      }
    }
  }
  // The common case (no cross-references in the document) returns the shared
  // empty constant — no per-render allocation, and the incremental reuse gate's
  // reference-equality check stays stable across cycles. Mirrors the
  // EMPTY_FOOTNOTE_ANCHORS / EMPTY_LIST_COUNTERS free-doc fast paths.
  return index.size === 0 ? EMPTY_CROSS_REFERENCE_INDEX : index;
}

/** Shared frozen empty index for the cross-reference-free path. */
export const EMPTY_CROSS_REFERENCE_INDEX: ReadonlyMap<
  BlockId,
  ReadonlyArray<BlockId>
> = new Map();

/**
 * Whether `block` carries at least one cross-reference field in its inline
 * content. Used by the incremental reuse gate: the target→hosts index only
 * changes when a dirty block gained, lost, or retargeted a cross-reference, so
 * a cycle whose dirty blocks all answer `false` (in BOTH new and prev state)
 * can reuse the cached index without the O(N_blocks) rebuild walk. Mirrors
 * `blockHasFootnoteAnchor`.
 */
export function blockHasCrossReference(block: Block | null): boolean {
  if (block === null || block.inlineContent === null) return false;
  for (const item of block.inlineContent.items) {
    if (item.kind === "embed" && item.embedType === CROSS_REFERENCE_EMBED_TYPE) {
      return true;
    }
  }
  return false;
}
