import type { BlockId } from "./block-id";
import type { Block } from "./block";
import {
  getBlock,
  resolveBlock,
  getEmbedContentIds,
  getTemplateContentIds,
  blockCount,
  type State,
} from "./state";

/** A block resolver: main-tree-only (`getBlock`) or any-tree (`resolveBlock`). */
type BlockResolver = (state: State, id: BlockId) => Block | null;

/** Resolve from ANY of the three trees (main → embedContents → templateContents). */
const resolveAnyTree: BlockResolver = (state, id) => resolveBlock(state, id)?.block ?? null;

/**
 * Yield every BODY block in document order (depth-first: a block, then its
 * children, then its next sibling), starting from the root. Follows
 * firstChildId / nextSiblingId pointers.
 *
 * Cycle detection runs in two dimensions, because this is a RECURSIVE walk
 * (unlike the iterative traversals in `block-traversal.ts`):
 *   - the `firstChildId` recursion carries an active-path `visited` set —
 *     a `firstChildId` pointing back at an ancestor would otherwise recurse
 *     to a stack overflow before any counter fired. This mirrors the render
 *     pass's active-path guard (`render-core.ts`). The id is removed from the
 *     set once its subtree completes, so a DAG-shaped reuse later in the walk
 *     is still permitted; only a live ancestor cycle throws.
 *   - the `nextSiblingId` sibling loop carries a `blockCount(state) + 1` bound
 *     mirroring the other state traversals — a safe upper limit on the distinct
 *     blocks a doc-order traversal can visit (it sums all three trees; see
 *     `nextBlockInDocOrder`). A sibling chain longer than this can only be a cycle.
 */
export function* iterateBlocksInDocumentOrder(state: State): Iterable<Block> {
  const root = getBlock(state, state.rootId);
  if (root === null) return;
  yield* walk(state, state.rootId, new Set<BlockId>(), getBlock);
}

/**
 * Yield every LEAF BODY block (no `firstChildId`) of the MAIN tree in document
 * order — a cycle-safe replacement for the `firstLeafBlock` + `while (cursor =
 * nextBlockInDocOrder(...))` cursor sweep that several pure queries (`getOutline`,
 * `getWordCount`, `findMatches`, `computeOutlineSignature`) used to run.
 *
 * Those cursor sweeps were UNBOUNDED at the call site: `nextBlockInDocOrder`'s own
 * `blockCount`-bound only guards its single up-walk, not the caller's repeated
 * stepping, so a malformed topology where one block is the `firstChildId` of two
 * parents (its single `parentId` points at only one of them) makes the cursor
 * oscillate forever — a CPU-bound infinite loop that hangs the process (and, since
 * it blocks the event loop, defeats vitest's `--test-timeout`). Routing through
 * {@link iterateBlocksInDocumentOrder} inherits that walk's active-path drain +
 * `blockCount`-bounded sibling loop, so the same malformed input TERMINATES
 * (visiting the shared block twice, no live-ancestor cycle) instead of hanging.
 *
 * Behavior on well-formed documents is identical to the old sweep for every
 * consumer above: each filters by block type (`getOutline` keeps headings,
 * `computeOutlineSignature` keeps `table-of-contents`) or by inline content
 * (`getWordCount` / `findMatches` skip blocks without `inlineContent`), and the
 * blocks they act on are all leaves — so yielding leaves in document order yields
 * exactly the consumed set. (The old sweep additionally surfaced some
 * sibling-reached containers, which every consumer already filtered out.)
 */
export function* iterateLeafBlocksInDocumentOrder(state: State): Iterable<Block> {
  for (const block of iterateBlocksInDocumentOrder(state)) {
    if (block.firstChildId === null) yield block;
  }
}

/**
 * Yield every BODY block across ALL THREE block trees in a stable document order:
 * the main `blocks` tree first (identical to {@link iterateBlocksInDocumentOrder}),
 * then each `embedContents` body subtree (footnote bodies), then each
 * `templateContents` body subtree (header/footer template bodies). Each
 * embed/template ROOT (from {@link getEmbedContentIds}/{@link getTemplateContentIds},
 * which yield roots only — #313) heads a self-contained subtree resolved via
 * `resolveBlock` (its blocks live in their own Y.Map, not the main one), with the
 * same per-subtree active-path cycle guard + `blockCount`-bounded sibling loop the
 * main walk uses (`blockCount` already sums all three trees).
 *
 * Used by change-tracking's range index + accept/reject resolve scan so a
 * suggestion tagged in a footnote/header/footer body is found and resolved (not
 * left as an un-resolvable zombie). A suggestion id is CONTEXT-LOCAL — every item
 * it tags lives in one tree — so each id's tagged items are visited contiguously,
 * in document order, within that tree's segment of this walk.
 */
export function* iterateAllBlocksInDocumentOrder(state: State): Iterable<Block> {
  yield* iterateBlocksInDocumentOrder(state);
  for (const rootId of getEmbedContentIds(state)) {
    yield* walk(state, rootId, new Set<BlockId>(), resolveAnyTree);
  }
  for (const rootId of getTemplateContentIds(state)) {
    yield* walk(state, rootId, new Set<BlockId>(), resolveAnyTree);
  }
}

/**
 * True iff the document contains at least one `list-item` BODY block.
 *
 * The render pass calls this to short-circuit the O(N_blocks) list-event
 * collection walk (`collectListEvents`) for the common list-free document — the
 * mirror of `docHasFootnotes`'s footnote-free short-circuit. Unlike footnotes
 * (whose bodies live in their own `embedContents` Y.Map, giving an O(1) cached
 * root-id-set check), list membership is a per-paragraph attr with no dedicated
 * index, so this is an early-exit linear scan in document order — returning at
 * the FIRST `list-item`, so a list-bearing doc costs O(1) up to the first item
 * and a list-free doc pays one full walk (the same walk `collectListEvents`
 * would do, but allocation-free).
 */
export function docHasLists(state: State): boolean {
  for (const block of iterateBlocksInDocumentOrder(state)) {
    if (block.type === "list-item") return true;
  }
  return false;
}

function* walk(
  state: State,
  id: BlockId,
  visited: Set<BlockId>,
  resolve: BlockResolver,
): Iterable<Block> {
  if (visited.has(id)) {
    throw new Error(
      `iterateBlocksInDocumentOrder: cycle detected — block "${id}" is its own ancestor`,
    );
  }
  const block = resolve(state, id);
  if (block === null) return;
  visited.add(id);
  try {
    yield block;
    // Sibling-chain cycle bound: see the module docstring + block-traversal.ts.
    const maxSteps = blockCount(state) + 1;
    let childId = block.firstChildId;
    let steps = 0;
    while (childId !== null) {
      if (++steps > maxSteps) {
        throw new Error(
          `iterateBlocksInDocumentOrder: cycle detected in block tree (visited >${maxSteps} children of "${id}")`,
        );
      }
      yield* walk(state, childId, visited, resolve);
      const child = resolve(state, childId);
      childId = child === null ? null : child.nextSiblingId;
    }
  } finally {
    visited.delete(id);
  }
}
