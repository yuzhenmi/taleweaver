import type { State, OperationResult } from "./state";
import { applyOperation, getBlock } from "./state";
import type { BlockId } from "./block-id";
import type { Span } from "./block-position";
import {
  inlineContentLength,
  mergeAdjacentTextItems,
  splitInlineContentAtOffset,
} from "./inline-content";
import { getBlocksMap, getYBlock } from "./yjs-doc";
import { buildYInlineContent } from "./y-block";
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
 * Y representation changed (captured by the Y.Doc transaction).
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
 *
 * Y.Doc note: the anchor block's `inlineContent` Y.Array is fully replaced
 * via `buildYInlineContent` (legacy parity preserves the merged-content
 * semantics over Y.Text identity for the touched block — same trade-off as
 * insertText's full-replace fallback).
 */
export function deleteRange(state: State, span: Span): OperationResult {
  // Empty-span no-op (collapsed-ness is normalization-invariant).
  if (
    span.anchor.blockId === span.focus.blockId &&
    span.anchor.offset === span.focus.offset
  ) {
    return { state, dirtyIds: new Set<BlockId>() };
  }

  // Pre-normalize existence + leaf guards. These run before normalizeSpan
  // so the operation's stated error contract ("anchor/focus block ... not
  // found", "... is a container") wins over compareBlocksInDocOrder's
  // generic "block ... not found" message that would otherwise leak through
  // the normalizeSpan → comparePositions path. Same architectural pattern
  // as Phase 4c-1's applyAttrsToRange fix.
  const sameBlock = span.anchor.blockId === span.focus.blockId;

  const rawAnchor = getBlock(state, span.anchor.blockId);
  if (!rawAnchor) {
    throw new Error(
      sameBlock
        ? `deleteRange: block "${span.anchor.blockId}" not found`
        : `deleteRange: anchor block "${span.anchor.blockId}" not found`,
    );
  }
  if (!rawAnchor.inlineContent || rawAnchor.firstChildId !== null) {
    throw new Error(
      sameBlock
        ? `deleteRange: block "${span.anchor.blockId}" is a container, not a leaf`
        : `deleteRange: anchor block "${span.anchor.blockId}" is a container, not a leaf`,
    );
  }

  if (!sameBlock) {
    const rawFocus = getBlock(state, span.focus.blockId);
    if (!rawFocus) {
      throw new Error(`deleteRange: focus block "${span.focus.blockId}" not found`);
    }
    if (!rawFocus.inlineContent || rawFocus.firstChildId !== null) {
      throw new Error(
        `deleteRange: focus block "${span.focus.blockId}" is a container, not a leaf`,
      );
    }
  }

  // Now normalize. comparePositions can only throw on cross-context (no
  // common ancestor) since both endpoints have been verified to exist.
  const normalized = normalizeSpan(state, span);

  // SAME-BLOCK case
  if (normalized.anchor.blockId === normalized.focus.blockId) {
    const block = getBlock(state, normalized.anchor.blockId);
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

    return applyOperation(state, () => {
      const yBlock = getYBlock(state.doc, block.id, "deleteRange");
      yBlock.set("inlineContent", buildYInlineContent({ items: merged }));
    });
  }

  // CROSS-BLOCK case
  const anchorBlock = getBlock(state, normalized.anchor.blockId);
  if (!anchorBlock) {
    throw new Error(`deleteRange: anchor block "${normalized.anchor.blockId}" not found`);
  }
  const focusBlock = getBlock(state, normalized.focus.blockId);
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
  // can't span the root since the root has no siblings). Hoist into a const
  // so the non-null narrowing survives into the transaction closure (avoids
  // a non-null assertion when calling getYBlock(parentId)).
  const parentId = anchorBlock.parentId;
  if (parentId === null) {
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
    const node = getBlock(state, cur);
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

  // Validate the focus's old nextSibling rewire-target now (outside the
  // transaction) so the legacy "focus block's next sibling not found" error
  // contract is preserved. Symmetric: validate the parent for the
  // last-child rewire branch.
  const focusNextId = focusBlock.nextSiblingId;
  if (focusNextId !== null) {
    if (getBlock(state, focusNextId) === null) {
      throw new Error(
        `deleteRange: focus block's next sibling "${focusNextId}" not found`,
      );
    }
  } else {
    if (getBlock(state, parentId) === null) {
      throw new Error(
        `deleteRange: parent "${parentId}" of anchor block not found`,
      );
    }
  }

  // Build merged anchor inline content (pure JS — Y materialization happens
  // inside the transaction via buildYInlineContent).
  const [anchorPrefix] = splitInlineContentAtOffset(anchorBlock.inlineContent, normalized.anchor.offset);
  const [, focusSuffix] = splitInlineContentAtOffset(focusBlock.inlineContent, normalized.focus.offset);
  const mergedItems = mergeAdjacentTextItems([...anchorPrefix, ...focusSuffix]);

  return applyOperation(state, () => {
    const yBlocks = getBlocksMap(state.doc);
    const yAnchor = getYBlock(state.doc, anchorBlock.id, "deleteRange");

    // Update anchor: new content + nextSiblingId rewired to focus's old next.
    yAnchor.set("inlineContent", buildYInlineContent({ items: mergedItems }));
    yAnchor.set("nextSiblingId", focusNextId);

    // Rewire focus's old nextSibling, if any. Else update the parent's
    // lastChildId to anchor (focus was the parent's last child).
    if (focusNextId !== null) {
      getYBlock(state.doc, focusNextId, "deleteRange").set(
        "prevSiblingId",
        anchorBlock.id,
      );
    } else {
      getYBlock(state.doc, parentId, "deleteRange").set(
        "lastChildId",
        anchorBlock.id,
      );
    }

    // Delete focus + all intervening leaves last (after reads of yAnchor /
    // sibling updates are done).
    yBlocks.delete(focusBlock.id);
    for (const id of interveningIds) {
      yBlocks.delete(id);
    }
  });
}
