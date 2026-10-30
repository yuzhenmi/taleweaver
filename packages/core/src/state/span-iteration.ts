import type { State } from "./state";
import { resolveBlock, createWalkGuard } from "./state";
import type { Span } from "./block-position";
import { comparePositions, selectionContextOf } from "./block-compare";
import type { Block } from "./block";
import type { BlockId } from "./block-id";
import { inlineContentLength } from "./inline-content";
import { nextBlockInDocOrder, nextBlockAfterSubtree } from "./block-traversal";
import { createPosition, createSpan, type Position } from "./block-position";

/**
 * A block a range covers WHOLE or not at all (Word / Google Docs: an object
 * paragraph): an atomic leaf (no inline content, no children — image, horizontal
 * line, table of contents) or a table. A range endpoint on one sits at
 * `(blockId, 0)` and means "this whole block is in the range" (inclusive, as the
 * start or the end). Every other container (section, row, cell, host container)
 * is never a range endpoint.
 */
export function isObjectBlock(block: Block): boolean {
  return block.inlineContent === null && (block.firstChildId === null || block.type === "table");
}

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
 * are skipped — only leaves contribute ranges (a table's cell paragraphs are
 * yielded fully, as leaves inside the span).
 *
 * An OBJECT endpoint ({@link isObjectBlock}) covers its whole block: it yields no
 * range of its own, but a table endpoint's cell paragraphs are yielded fully (as
 * a table between the endpoints). A collapsed span on an object yields nothing.
 *
 * The span is normalized first (anchor before focus in document order).
 *
 * Preconditions (each throws on violation):
 *   - Both endpoints reference existing blocks.
 *   - Both endpoints reference leaf blocks (with inlineContent) or object
 *     blocks. A span endpoint on any other container (a section, a cell) is
 *     nonsensical (offsets don't apply to containers) and would silently
 *     produce a backwards or empty range.
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
  if (!anchorBlockRaw.inlineContent && !isObjectBlock(anchorBlockRaw)) {
    throw new Error(`iterateSpan: anchor block "${span.anchor.blockId}" is a container, not a leaf`);
  }
  if (!focusBlockRaw.inlineContent && !isObjectBlock(focusBlockRaw)) {
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
    if (block.inlineContent === null) return; // a collapsed span on an object
    yield { block, rangeStart: normalized.anchor.offset, rangeEnd: normalized.focus.offset };
    return;
  }

  const anchorBlock = resolveBlock(state, normalized.anchor.blockId)?.block ?? null;
  const focusBlock = resolveBlock(state, normalized.focus.blockId)?.block ?? null;
  if (anchorBlock === null) throw new Error(`iterateSpan: block "${normalized.anchor.blockId}" not found`);
  if (focusBlock === null) throw new Error(`iterateSpan: block "${normalized.focus.blockId}" not found`);

  // Anchor block: from anchor.offset to end-of-block (an object start has no range;
  // the walk below descends into a table start's cells).
  if (anchorBlock.inlineContent) {
    yield {
      block: anchorBlock,
      rangeStart: normalized.anchor.offset,
      rangeEnd: inlineContentLength(anchorBlock.inlineContent),
    };
  }

  // Walk intervening blocks via nextBlockInDocOrder, yielding leaves fully.
  //
  // Outer cycle/step guard: while nextBlockInDocOrder has its own per-call
  // cycle bound (catches a parent-chain cycle inside a single call), it
  // cannot see a sibling-level cycle that spans multiple calls (e.g.,
  // p1.nextSiblingId === p2 and p2.nextSiblingId === p1). The outer
  // counter here catches that cross-call case and surfaces a contextual
  // error that names the anchor + focus block IDs — useful for debugging
  // corrupt block trees. Bound source: blockCount(), same as the inner
  // guards in block-traversal.ts (map-agnostic).
  const guard = createWalkGuard(state);
  const step = (): void => {
    if (guard.step()) {
      throw new Error(
        `iterateSpan: step bound exceeded walking from anchor "${normalized.anchor.blockId}" to focus "${normalized.focus.blockId}" — block tree may be corrupt`,
      );
    }
  };
  let currentId = nextBlockInDocOrder(state, normalized.anchor.blockId);
  while (currentId && currentId !== normalized.focus.blockId) {
    step();
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

  if (focusBlock.inlineContent) {
    // Focus block: from 0 to focus.offset.
    yield { block: focusBlock, rangeStart: 0, rangeEnd: normalized.focus.offset };
    return;
  }
  // An object end covers its whole block: a table end's cell paragraphs, fully.
  const after = nextBlockAfterSubtree(state, focusBlock.id);
  for (let id = nextBlockInDocOrder(state, focusBlock.id); id !== null && id !== after; id = nextBlockInDocOrder(state, id)) {
    step();
    const inner = resolveBlock(state, id)?.block ?? null;
    if (inner !== null && inner.inlineContent) {
      yield { block: inner, rangeStart: 0, rangeEnd: inlineContentLength(inner.inlineContent) };
    }
  }
}

/**
 * `span` clipped to its TEXT: normalized, then an object endpoint
 * ({@link isObjectBlock}) is moved onto the text the span covers outside every
 * object — the start to `(first such text block, 0)`, the end to `(last such text
 * block, its length)`. A span with text endpoints is returned normalized. When the
 * span covers no text outside objects, it collapses to the start of the first text
 * block after it (where a direct delete of it leaves the caret). A suggested
 * (tracked) edit places its insertion / split / caret by it: structural change
 * tracking is not built, so a covered object stays in place (its strike still
 * covers a table's cell text — `iterateSpan`). O(span).
 */
export function clipSpanToText(state: State, span: Span): Span {
  const n = normalizeSpan(state, span);
  const start = resolveBlock(state, n.anchor.blockId)?.block ?? null;
  const end = resolveBlock(state, n.focus.blockId)?.block ?? null;
  if (start === null || end === null) return n;
  if (start.inlineContent !== null && end.inlineContent !== null) return n;
  let first: Position | null = start.inlineContent !== null ? n.anchor : null;
  let last: Position | null = start.inlineContent !== null ? createPosition(start.id, inlineContentLength(start.inlineContent)) : null;
  const guard = createWalkGuard(state);
  const next = (b: Block): BlockId | null =>
    isObjectBlock(b) ? nextBlockAfterSubtree(state, b.id) : nextBlockInDocOrder(state, b.id);
  for (let id = next(start); id !== null && id !== end.id; ) {
    if (guard.step()) throw new Error(`clipSpanToText: step bound exceeded — block tree may be corrupt`);
    const b = resolveBlock(state, id)?.block ?? null;
    if (b === null) break;
    if (b.inlineContent !== null) {
      first ??= createPosition(b.id, 0);
      last = createPosition(b.id, inlineContentLength(b.inlineContent));
    }
    id = next(b);
  }
  if (end.inlineContent !== null) return createSpan(first ?? createPosition(end.id, 0), n.focus);
  if (first !== null && last !== null) return createSpan(first, last);
  const after = firstTextAfter(state, end.id);
  return after === null ? n : createSpan(after, after);
}

/** The start of the first text block after `blockId`'s subtree (objects skipped), or null. */
export function firstTextAfter(state: State, blockId: BlockId): Position | null {
  const guard = createWalkGuard(state);
  for (let id = nextBlockAfterSubtree(state, blockId); id !== null; ) {
    if (guard.step()) throw new Error(`firstTextAfter: step bound exceeded — block tree may be corrupt`);
    const b = resolveBlock(state, id)?.block ?? null;
    if (b === null) return null;
    if (b.inlineContent !== null) return createPosition(b.id, 0);
    id = isObjectBlock(b) ? nextBlockAfterSubtree(state, b.id) : nextBlockInDocOrder(state, b.id);
  }
  return null;
}

/**
 * Yield each block (leaf or container) overlapped by the span, in
 * document order. Used by block-level operations that need to see
 * containers (e.g., set page-break-before, wrap in section).
 *
 * Difference from iterateSpan: yields containers, no per-block range
 * (the consumer touches whole blocks). Endpoints MAY be containers —
 * unlike iterateSpan, container-block endpoints are valid here. An object end
 * ({@link isObjectBlock}) covers its whole block: a table end's subtree is
 * yielded after it.
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
  const guard = createWalkGuard(state);
  let currentId = nextBlockInDocOrder(state, normalized.anchor.blockId);
  while (currentId) {
    if (guard.step()) {
      throw new Error(
        `iterateBlocksInSpan: step bound exceeded walking from anchor "${normalized.anchor.blockId}" to focus "${normalized.focus.blockId}" — block tree may be corrupt`,
      );
    }
    const current = resolveBlock(state, currentId)?.block ?? null;
    if (current !== null) yield current;
    if (currentId === normalized.focus.blockId) {
      // An object end covers its whole block: a table end's rows / cells / paragraphs too.
      if (current === null || !isObjectBlock(current)) return;
      const after = nextBlockAfterSubtree(state, currentId);
      for (let id = nextBlockInDocOrder(state, currentId); id !== null && id !== after; id = nextBlockInDocOrder(state, id)) {
        if (guard.step()) {
          throw new Error(`iterateBlocksInSpan: step bound exceeded walking object "${currentId}" — block tree may be corrupt`);
        }
        const inner = resolveBlock(state, id)?.block ?? null;
        if (inner !== null) yield inner;
      }
      return;
    }
    currentId = nextBlockInDocOrder(state, currentId);
  }

  throw new Error(
    `iterateBlocksInSpan: walked to end of context without reaching focus block "${normalized.focus.blockId}" ` +
    `(malformed state or stale span)`,
  );
}
