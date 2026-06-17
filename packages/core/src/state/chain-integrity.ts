import type { State, ResolvedBlockKind } from "./state";
import {
  getBlock,
  getEmbedContent,
  getTemplateContent,
  resolveBlock,
  blockCount,
} from "./state";
import { STATE_INTERNAL } from "./state-internal";
import { getTreeMaps } from "./yjs-doc";
import type { BlockId } from "./block-id";
import type { Block } from "./block";

/**
 * Dev-mode invariant assertion (paired with `isDevMode()` at the call site):
 * the block-tree's structural linked list is internally consistent.
 *
 * The tree model wires every block to its neighbours by id —
 * `parentId`, `prevSiblingId`/`nextSiblingId`, `firstChildId`/`lastChildId`.
 * The structural ops (split / merge / remove / reparent / section-break)
 * rewire these pointers by hand; a single mis-set pointer corrupts the tree
 * SILENTLY — the render walk follows the broken chain and drops or duplicates
 * blocks with no error. `assertSameTree` only checks that neighbours live in
 * the same tree; it does NOT check that the back-links agree. This assertion
 * closes that gap. It is the structural counterpart to the embed-reference
 * invariants (`assertNoOrphanedEmbedContent` / `assertNoSharedEmbedContent`).
 *
 * For every checked block B it asserts:
 *   1. **Child-pointer coherence** — `firstChildId` and `lastChildId` are both
 *      null or both non-null (a one-sided pair is corruption).
 *   2. **Child chain** — walking `firstChildId` via `nextSiblingId` reaches a
 *      run of blocks that (a) all resolve in B's tree, (b) each report
 *      `parentId === B.id`, (c) form a reciprocal prev/next chain, and (d)
 *      terminate exactly at `lastChildId`. Cycle-bounded by the tree's block
 *      count.
 *   3. **Sibling reciprocity** — if B has a next/prev sibling, that sibling
 *      resolves and points back at B.
 *   4. **Parent linkage** — if `parentId` is set, the parent resolves; and
 *      because the first child is the unique block with `prevSiblingId === null`
 *      (last child symmetrically with `nextSiblingId === null`), B being a
 *      boundary child must match the parent's `firstChildId` / `lastChildId`.
 *
 * Since back-links are reciprocal, checking every edge incident to each
 * changed block is sufficient: by induction the pre-state was consistent, so
 * only an edge touching a dirty block can have broken, and every such edge is
 * checked from at least one of its (dirty) endpoints.
 *
 * Scan strategy (inductive), mirroring `assertNoOrphanedEmbedContent`:
 *   - When `dirtyIds` is provided and every dirty id still resolves, only the
 *     dirty blocks' incident edges need checking.
 *   - If any dirty id no longer resolves (a deletion), fall back to the full
 *     three-tree scan: a deleted block's former neighbour might not have been
 *     relinked, and that neighbour is not itself dirty.
 *   - When `dirtyIds` is omitted (direct callers, tests), always full-scan.
 *
 * Cost is dev-mode only (guarded by `isDevMode()` at the single production
 * call site inside `applyOperation`), so PROD pays nothing. Dev-mode cost is
 * O(sum of dirty blocks' child counts) in the common no-deletion case, and
 * O(N_blocks) on ops that delete a block.
 */
export function assertChainIntegrity(
  state: State,
  opName: string,
  dirtyIds?: ReadonlySet<BlockId>,
): void {
  // +1 so a fully-linear chain of every block is not mistaken for a cycle.
  const bound = blockCount(state) + 1;
  if (dirtyIds !== undefined) {
    let needsFullScan = false;
    for (const blockId of dirtyIds) {
      const resolved = resolveBlock(state, blockId);
      if (resolved === null) {
        // Dirty id is gone — a deletion. Its former neighbour may be unlinked
        // and is not itself dirty, so only a full scan is sound.
        needsFullScan = true;
        continue;
      }
      assertBlockChain(state, resolved.kind, resolved.block, opName, bound);
    }
    if (!needsFullScan) return;
  }
  fullScanForChainIntegrity(state, opName, bound);
}

/** The snapshot accessor for the tree a resolved block came from. */
function accessorFor(
  kind: ResolvedBlockKind,
): (state: State, id: BlockId) => Block | null {
  switch (kind) {
    case "block":
      return getBlock;
    case "embedContent":
      return getEmbedContent;
    case "templateContent":
      return getTemplateContent;
  }
}

function fail(opName: string, message: string): never {
  throw new Error(`assertChainIntegrity (op: "${opName}"): ${message}`);
}

/**
 * Assert the four structural invariants for a single block `b` known to live
 * in tree `kind`. Neighbour lookups use that tree's accessor — parent, child,
 * and siblings are always same-tree.
 */
function assertBlockChain(
  state: State,
  kind: ResolvedBlockKind,
  b: Block,
  opName: string,
  bound: number,
): void {
  const access = accessorFor(kind);
  const id = b.id;

  // 1. Child-pointer coherence.
  if ((b.firstChildId === null) !== (b.lastChildId === null)) {
    fail(
      opName,
      `block "${id}" has one-sided child pointers ` +
        `(firstChildId="${b.firstChildId}", lastChildId="${b.lastChildId}")`,
    );
  }

  // 2. Child chain.
  if (b.firstChildId !== null) {
    let childId: BlockId | null = b.firstChildId;
    let expectedPrev: BlockId | null = null;
    let lastSeen: BlockId | null = null;
    let steps = 0;
    while (childId !== null) {
      if (++steps > bound) {
        fail(opName, `block "${id}" child chain exceeds block count (cycle?)`);
      }
      const child = access(state, childId);
      if (child === null) {
        fail(
          opName,
          `block "${id}" child chain references missing block "${childId}"`,
        );
      }
      if (child.parentId !== id) {
        fail(
          opName,
          `child "${childId}" of "${id}" has parentId "${child.parentId}"`,
        );
      }
      if (child.prevSiblingId !== expectedPrev) {
        fail(
          opName,
          `child "${childId}" of "${id}" has prevSiblingId ` +
            `"${child.prevSiblingId}", expected "${expectedPrev}"`,
        );
      }
      lastSeen = childId;
      expectedPrev = childId;
      childId = child.nextSiblingId;
    }
    if (lastSeen !== b.lastChildId) {
      fail(
        opName,
        `block "${id}" lastChildId "${b.lastChildId}" does not match ` +
          `child-chain end "${lastSeen}"`,
      );
    }
  }

  // 3. Sibling reciprocity.
  if (b.nextSiblingId !== null) {
    const next = access(state, b.nextSiblingId);
    if (next === null) {
      fail(opName, `block "${id}" nextSiblingId "${b.nextSiblingId}" is missing`);
    }
    if (next.prevSiblingId !== id) {
      fail(
        opName,
        `block "${id}" nextSibling "${b.nextSiblingId}" has prevSiblingId ` +
          `"${next.prevSiblingId}", expected "${id}"`,
      );
    }
  }
  if (b.prevSiblingId !== null) {
    const prev = access(state, b.prevSiblingId);
    if (prev === null) {
      fail(opName, `block "${id}" prevSiblingId "${b.prevSiblingId}" is missing`);
    }
    if (prev.nextSiblingId !== id) {
      fail(
        opName,
        `block "${id}" prevSibling "${b.prevSiblingId}" has nextSiblingId ` +
          `"${prev.nextSiblingId}", expected "${id}"`,
      );
    }
  }

  // 4. Parent linkage + boundary-child agreement.
  if (b.parentId !== null) {
    const parent = access(state, b.parentId);
    if (parent === null) {
      fail(opName, `block "${id}" parentId "${b.parentId}" is missing`);
    }
    if (b.prevSiblingId === null && parent.firstChildId !== id) {
      fail(
        opName,
        `block "${id}" is a first child (prevSibling null) but parent ` +
          `"${b.parentId}" firstChildId is "${parent.firstChildId}"`,
      );
    }
    if (b.nextSiblingId === null && parent.lastChildId !== id) {
      fail(
        opName,
        `block "${id}" is a last child (nextSibling null) but parent ` +
          `"${b.parentId}" lastChildId is "${parent.lastChildId}"`,
      );
    }
  }
}

/**
 * Walk every block in all three top-level Y.Maps and assert each block's
 * chain. Used by the direct entry point (no dirtyIds) and by the
 * deletion-detected fallback path.
 */
function fullScanForChainIntegrity(
  state: State,
  opName: string,
  bound: number,
): void {
  const [mainMap, embedMap, templateMap] = getTreeMaps(state[STATE_INTERNAL].doc);
  if (mainMap === undefined || embedMap === undefined || templateMap === undefined) {
    throw new Error(
      "chain-integrity: getTreeMaps returned fewer than the three doc trees " +
        "(blocks/embedContents/templateContents) — doc not initialized",
    );
  }
  scanMap(state, mainMap, "block", opName, bound);
  scanMap(state, embedMap, "embedContent", opName, bound);
  scanMap(state, templateMap, "templateContent", opName, bound);
}

function scanMap(
  state: State,
  map: { keys(): IterableIterator<string> },
  kind: ResolvedBlockKind,
  opName: string,
  bound: number,
): void {
  const access = accessorFor(kind);
  for (const key of map.keys()) {
    const block = access(state, key as BlockId);
    if (block === null) continue;
    assertBlockChain(state, kind, block, opName, bound);
  }
}
