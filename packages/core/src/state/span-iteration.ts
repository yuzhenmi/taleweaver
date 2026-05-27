import type { State } from "./state";
import { resolveBlock, blockCount } from "./state";
import type { Span } from "./block-position";
import { createSpan } from "./block-position";
import { comparePositions, selectionContextOf } from "./block-compare";
import type { Block } from "./block";
import { inlineContentLength } from "./inline-content";
import { nextBlockInDocOrder } from "./block-traversal";

/**
 * Normalize a span so anchor comes before focus in document order.
 * If already normalized, returns the same Span object reference.
 *
 * Precondition: anchor and focus must be in the same selection context.
 * comparePositions throws via compareBlocksInDocOrder if they have no
 * common ancestor (different roots).
 */
export function normalizeSpan(state: State, span: Span): Span {
  if (comparePositions(state, span.anchor, span.focus) <= 0) return span;
  return createSpan(span.focus, span.anchor);
}

/**
 * Per-leaf-block range yielded by iterateSpan.
 */
export interface BlockRange {
  block: Block;
  rangeStart: number;
  rangeEnd: number;
}

/**
 * Yield per-leaf-block ranges for a span in document order.
 *
 * Same-block span: yields once with the offset range.
 * Cross-block span: yields anchor block from anchor.offset to end-of-block,
 *   then each intervening leaf block fully (range 0..length), then focus
 *   block from 0 to focus.offset.
 *
 * Container blocks (no inlineContent) encountered between anchor and focus
 * are skipped — only leaves contribute ranges.
 *
 * The span is normalized first (anchor before focus in document order).
 *
 * Preconditions (each throws on violation):
 *   - Both endpoints reference existing blocks.
 *   - Both endpoints reference leaf blocks (with inlineContent). A span
 *     endpoint on a container is nonsensical (offsets don't apply to
 *     containers) and would silently produce a backwards or empty range.
 *   - Both endpoints are in the same selection context (same root via
 *     parentId chain). Cross-context spans are not supported in the data
 *     model; the action-handler layer is responsible for rejecting or
 *     collapsing them, but this function defends against bad input.
 */
export function* iterateSpan(state: State, span: Span): Iterable<BlockRange> {
  // Pre-normalize precondition checks (validate raw endpoints before
  // normalizeSpan does cross-block compare, which itself requires same-context).
  const anchorBlockRaw = resolveBlock(state, span.anchor.blockId)?.block ?? null;
  const focusBlockRaw = resolveBlock(state, span.focus.blockId)?.block ?? null;
  if (anchorBlockRaw === null) throw new Error(`iterateSpan: anchor block "${span.anchor.blockId}" not found`);
  if (focusBlockRaw === null) throw new Error(`iterateSpan: focus block "${span.focus.blockId}" not found`);
  if (!anchorBlockRaw.inlineContent) {
    throw new Error(`iterateSpan: anchor block "${span.anchor.blockId}" is a container, not a leaf`);
  }
  if (!focusBlockRaw.inlineContent) {
    throw new Error(`iterateSpan: focus block "${span.focus.blockId}" is a container, not a leaf`);
  }
  const anchorCtx = selectionContextOf(state, span.anchor.blockId);
  const focusCtx = selectionContextOf(state, span.focus.blockId);
  if (anchorCtx !== focusCtx) {
    throw new Error(
      `iterateSpan: anchor and focus are in different selection contexts ` +
      `("${anchorCtx}" vs "${focusCtx}")`,
    );
  }

  const normalized = normalizeSpan(state, span);

  if (normalized.anchor.blockId === normalized.focus.blockId) {
    const block = resolveBlock(state, normalized.anchor.blockId)?.block ?? null;
    if (block === null) throw new Error(`iterateSpan: block "${normalized.anchor.blockId}" not found`);
    yield { block, rangeStart: normalized.anchor.offset, rangeEnd: normalized.focus.offset };
    return;
  }

  const anchorBlock = resolveBlock(state, normalized.anchor.blockId)?.block ?? null;
  const focusBlock = resolveBlock(state, normalized.focus.blockId)?.block ?? null;
  if (anchorBlock === null) throw new Error(`iterateSpan: block "${normalized.anchor.blockId}" not found`);
  if (focusBlock === null) throw new Error(`iterateSpan: block "${normalized.focus.blockId}" not found`);

  // Anchor block: from anchor.offset to end-of-block.
  yield {
    block: anchorBlock,
    rangeStart: normalized.anchor.offset,
    rangeEnd: anchorBlock.inlineContent ? inlineContentLength(anchorBlock.inlineContent) : 0,
  };

  // Walk intervening blocks via nextBlockInDocOrder, yielding leaves fully.
  //
  // Outer cycle/step guard: while nextBlockInDocOrder has its own per-call
  // cycle bound (catches a parent-chain cycle inside a single call), it
  // cannot see a sibling-level cycle that spans multiple calls (e.g.,
  // p1.nextSiblingId === p2 and p2.nextSiblingId === p1). The outer
  // counter here catches that cross-call case and surfaces a contextual
  // error that names the anchor + focus block IDs — useful for debugging
  // corrupt block trees. Bound source: blockCount(), same as the inner
  // guards in block-traversal.ts (map-agnostic since C.2c T7a).
  const maxSteps = blockCount(state) + 1;
  let steps = 0;
  let currentId = nextBlockInDocOrder(state, normalized.anchor.blockId);
  while (currentId && currentId !== normalized.focus.blockId) {
    if (++steps > maxSteps) {
      throw new Error(
        `iterateSpan: step bound exceeded walking from anchor "${normalized.anchor.blockId}" to focus "${normalized.focus.blockId}" — block tree may be corrupt`,
      );
    }
    const current = resolveBlock(state, currentId)?.block ?? null;
    if (current !== null && current.inlineContent) {
      yield {
        block: current,
        rangeStart: 0,
        rangeEnd: inlineContentLength(current.inlineContent),
      };
    }
    currentId = nextBlockInDocOrder(state, currentId);
  }

  if (currentId !== normalized.focus.blockId) {
    throw new Error(
      `iterateSpan: walked to end of context without reaching focus block "${normalized.focus.blockId}" ` +
      `(malformed state or stale span)`,
    );
  }

  // Focus block: from 0 to focus.offset.
  yield { block: focusBlock, rangeStart: 0, rangeEnd: normalized.focus.offset };
}

/**
 * Yield each block (leaf or container) overlapped by the span, in
 * document order. Used by block-level operations that need to see
 * containers (e.g., set page-break-before, wrap in section).
 *
 * Difference from iterateSpan: yields containers, no per-block range
 * (the consumer touches whole blocks). Endpoints MAY be containers —
 * unlike iterateSpan, container-block endpoints are valid here.
 *
 * Precondition: anchor and focus must be in the same selection context.
 * Throws otherwise. (Cross-context spans would walk to end-of-document
 * without ever reaching focus, silently producing the wrong block list.)
 *
 * The span is normalized first.
 */
export function* iterateBlocksInSpan(state: State, span: Span): Iterable<Block> {
  // Pre-normalize precondition checks (must validate before normalizeSpan
  // runs cross-block compare, which itself requires same-context).
  if (resolveBlock(state, span.anchor.blockId) === null) {
    throw new Error(`iterateBlocksInSpan: anchor block "${span.anchor.blockId}" not found`);
  }
  if (resolveBlock(state, span.focus.blockId) === null) {
    throw new Error(`iterateBlocksInSpan: focus block "${span.focus.blockId}" not found`);
  }
  const anchorCtx = selectionContextOf(state, span.anchor.blockId);
  const focusCtx = selectionContextOf(state, span.focus.blockId);
  if (anchorCtx !== focusCtx) {
    throw new Error(
      `iterateBlocksInSpan: anchor and focus are in different selection contexts ` +
      `("${anchorCtx}" vs "${focusCtx}")`,
    );
  }

  const normalized = normalizeSpan(state, span);

  const anchorBlock = resolveBlock(state, normalized.anchor.blockId)?.block ?? null;
  if (anchorBlock === null) throw new Error(`iterateBlocksInSpan: block "${normalized.anchor.blockId}" not found`);
  yield anchorBlock;

  if (normalized.anchor.blockId === normalized.focus.blockId) return;

  // Outer cycle/step guard: see iterateSpan above for rationale.
  // Catches sibling-level cycles that span multiple nextBlockInDocOrder
  // calls (which the per-call inner guard cannot see).
  const maxSteps = blockCount(state) + 1;
  let steps = 0;
  let currentId = nextBlockInDocOrder(state, normalized.anchor.blockId);
  while (currentId) {
    if (++steps > maxSteps) {
      throw new Error(
        `iterateBlocksInSpan: step bound exceeded walking from anchor "${normalized.anchor.blockId}" to focus "${normalized.focus.blockId}" — block tree may be corrupt`,
      );
    }
    const current = resolveBlock(state, currentId)?.block ?? null;
    if (current !== null) yield current;
    if (currentId === normalized.focus.blockId) return;
    currentId = nextBlockInDocOrder(state, currentId);
  }

  throw new Error(
    `iterateBlocksInSpan: walked to end of context without reaching focus block "${normalized.focus.blockId}" ` +
    `(malformed state or stale span)`,
  );
}
