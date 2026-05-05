import type { State, OperationResult } from "./state";
import type { BlockId } from "./block-id";
import type { Span } from "./block-position";
import {
  createInlineContent,
  inlineContentLength,
  mergeAdjacentTextItems,
  splitInlineContentAtOffset,
} from "./inline-content";
import { updateBlock } from "./block";
import { normalizeSpan } from "./span-iteration";

/**
 * Delete the inline content within a Span.
 *
 * Same-block case: the block's inlineContent becomes
 *   items[0..anchor.offset) ⊕ items[focus.offset..)
 * with a run-merging post-pass.
 *
 * Cross-block case (same parent only): the anchor block keeps its identity
 * (id, type, attrs, parentId, prevSiblingId) and absorbs:
 *   anchor.items[0..anchor.offset) ⊕ focus.items[focus.offset..)
 * with a run-merging post-pass. The focus block and any leaf blocks
 * between anchor and focus in the parent's child list are removed.
 * Anchor's nextSiblingId rewires to focus's old nextSiblingId.
 *
 * Empty-span (collapsed) is a no-op.
 *
 * Returns OperationResult with dirtyIds containing every block id whose
 * entry in state.blocks differs from the previous state.
 *
 * Throws if:
 *   - either endpoint references a missing block,
 *   - either endpoint is a container (firstChildId !== null OR
 *     inlineContent === null),
 *   - the span crosses parents (cross-parent deleteRange not supported
 *     in this phase — action handlers compose primitives for that),
 *   - cross-context (inherited via normalizeSpan's comparePositions
 *     call which throws on no-common-ancestor),
 *   - any offset is outside [0, inlineContentLength].
 */
export function deleteRange(state: State, span: Span): OperationResult {
  // Empty-span no-op (collapsed-ness is normalization-invariant).
  if (
    span.anchor.blockId === span.focus.blockId &&
    span.anchor.offset === span.focus.offset
  ) {
    return { state, dirtyIds: new Set<BlockId>() };
  }

  // Normalize. Throws via comparePositions if cross-context.
  const normalized = normalizeSpan(state, span);

  // SAME-BLOCK case
  if (normalized.anchor.blockId === normalized.focus.blockId) {
    const block = state.blocks.get(normalized.anchor.blockId);
    if (!block) {
      throw new Error(`deleteRange: block "${normalized.anchor.blockId}" not found`);
    }
    if (!block.inlineContent || block.firstChildId !== null) {
      throw new Error(
        `deleteRange: block "${normalized.anchor.blockId}" is a container, not a leaf`,
      );
    }

    const totalLen = inlineContentLength(block.inlineContent);
    if (normalized.anchor.offset < 0 || normalized.anchor.offset > totalLen) {
      throw new Error(
        `deleteRange: anchor offset ${normalized.anchor.offset} out of range [0, ${totalLen}] for block "${normalized.anchor.blockId}"`,
      );
    }
    if (normalized.focus.offset < 0 || normalized.focus.offset > totalLen) {
      throw new Error(
        `deleteRange: focus offset ${normalized.focus.offset} out of range [0, ${totalLen}] for block "${normalized.anchor.blockId}"`,
      );
    }

    // After collapsed-span no-op above, normalized may still be collapsed
    // if the input had reverse-order positions in the same block at the
    // same offset. The normalized form would be identical to either input.
    // Re-check here for completeness.
    if (normalized.anchor.offset === normalized.focus.offset) {
      return { state, dirtyIds: new Set<BlockId>() };
    }

    const [prefix] = splitInlineContentAtOffset(block.inlineContent, normalized.anchor.offset);
    const [, suffix] = splitInlineContentAtOffset(block.inlineContent, normalized.focus.offset);
    const merged = mergeAdjacentTextItems([...prefix, ...suffix]);

    const updated = updateBlock(block, {
      inlineContent: createInlineContent(merged),
    });

    return {
      state: { ...state, blocks: state.blocks.set(block.id, updated) },
      dirtyIds: new Set<BlockId>([block.id]),
    };
  }

  // CROSS-BLOCK case
  const anchorBlock = state.blocks.get(normalized.anchor.blockId);
  if (!anchorBlock) {
    throw new Error(`deleteRange: anchor block "${normalized.anchor.blockId}" not found`);
  }
  const focusBlock = state.blocks.get(normalized.focus.blockId);
  if (!focusBlock) {
    throw new Error(`deleteRange: focus block "${normalized.focus.blockId}" not found`);
  }

  if (!anchorBlock.inlineContent || anchorBlock.firstChildId !== null) {
    throw new Error(
      `deleteRange: anchor block "${normalized.anchor.blockId}" is a container, not a leaf`,
    );
  }
  if (!focusBlock.inlineContent || focusBlock.firstChildId !== null) {
    throw new Error(
      `deleteRange: focus block "${normalized.focus.blockId}" is a container, not a leaf`,
    );
  }

  if (anchorBlock.parentId !== focusBlock.parentId) {
    throw new Error(
      `deleteRange: cross-parent spans are not supported in this phase ` +
      `(anchor parent="${anchorBlock.parentId}", focus parent="${focusBlock.parentId}"). ` +
      `Action handlers should decompose into per-parent operations.`,
    );
  }

  // Defensive: same-parent + cross-block implies non-null parent (siblings
  // can't span the root since the root has no siblings).
  if (anchorBlock.parentId === null) {
    throw new Error(
      `deleteRange: blocks "${normalized.anchor.blockId}" and "${normalized.focus.blockId}" have null parent (state corruption)`,
    );
  }

  const anchorLen = inlineContentLength(anchorBlock.inlineContent);
  if (normalized.anchor.offset < 0 || normalized.anchor.offset > anchorLen) {
    throw new Error(
      `deleteRange: anchor offset ${normalized.anchor.offset} out of range [0, ${anchorLen}] for block "${normalized.anchor.blockId}"`,
    );
  }
  const focusLen = inlineContentLength(focusBlock.inlineContent);
  if (normalized.focus.offset < 0 || normalized.focus.offset > focusLen) {
    throw new Error(
      `deleteRange: focus offset ${normalized.focus.offset} out of range [0, ${focusLen}] for block "${normalized.focus.blockId}"`,
    );
  }

  // Walk the parent's child sibling chain from anchor to focus, collecting
  // intervening leaves. Throws if focus is not reachable (which would mean
  // anchor doesn't precede focus in the chain — impossible after normalization
  // unless state is corrupt).
  const interveningIds: BlockId[] = [];
  let cur: BlockId | null = anchorBlock.nextSiblingId;
  while (cur !== null && cur !== focusBlock.id) {
    interveningIds.push(cur);
    const node = state.blocks.get(cur);
    if (!node) {
      throw new Error(`deleteRange: intervening sibling "${cur}" not found`);
    }
    cur = node.nextSiblingId;
  }
  if (cur !== focusBlock.id) {
    throw new Error(
      `deleteRange: focus block "${focusBlock.id}" is not reachable from anchor "${anchorBlock.id}" in the parent's sibling chain`,
    );
  }

  // Build merged anchor inline content.
  const [anchorPrefix] = splitInlineContentAtOffset(anchorBlock.inlineContent, normalized.anchor.offset);
  const [, focusSuffix] = splitInlineContentAtOffset(focusBlock.inlineContent, normalized.focus.offset);
  const mergedItems = mergeAdjacentTextItems([...anchorPrefix, ...focusSuffix]);

  // Update anchor: new content + nextSiblingId rewired to focus's old next.
  let blocks = state.blocks.set(anchorBlock.id, updateBlock(anchorBlock, {
    inlineContent: createInlineContent(mergedItems),
    nextSiblingId: focusBlock.nextSiblingId,
  }));
  const dirtyIds = new Set<BlockId>([anchorBlock.id, focusBlock.id]);

  // Delete focus.
  blocks = blocks.delete(focusBlock.id);

  // Delete intervening leaves.
  for (const id of interveningIds) {
    blocks = blocks.delete(id);
    dirtyIds.add(id);
  }

  // Rewire focus's old nextSibling, if any.
  if (focusBlock.nextSiblingId) {
    const oldFocusNext = state.blocks.get(focusBlock.nextSiblingId);
    if (!oldFocusNext) {
      throw new Error(
        `deleteRange: focus block's next sibling "${focusBlock.nextSiblingId}" not found`,
      );
    }
    blocks = blocks.set(focusBlock.nextSiblingId, updateBlock(oldFocusNext, { prevSiblingId: anchorBlock.id }));
    dirtyIds.add(focusBlock.nextSiblingId);
  } else {
    // Focus was the parent's last child — parent's lastChildId rewires to anchor.
    const parent = state.blocks.get(anchorBlock.parentId);
    if (!parent) {
      throw new Error(
        `deleteRange: parent "${anchorBlock.parentId}" of anchor block not found`,
      );
    }
    blocks = blocks.set(anchorBlock.parentId, updateBlock(parent, { lastChildId: anchorBlock.id }));
    dirtyIds.add(anchorBlock.parentId);
  }

  return {
    state: { ...state, blocks },
    dirtyIds,
  };
}
