import type { State, OperationResult } from "./state";
import { applyOperation, getBlock } from "./state";
import type { BlockId, IdAllocator } from "./block-id";
import type { Position } from "./block-position";
import { getBlocksMap, getYBlock, allTreeBlockCount } from "./yjs-doc";
import { buildYBlock } from "./y-block";
import {
  computeReparentWrites,
  reparentChildrenInTx,
  type ReparentPlan,
} from "./reparent-children";
import { ancestorChain, firstLeafBlock } from "./block-traversal";
import { STATE_INTERNAL } from "./state-internal";

/**
 * Result of `applySectionBreak`. Extends `OperationResult` with the cursor
 * target after the break: the first leaf of the boundary block's subtree.
 * Equals `cursor.blockId` on the no-op path (Decision 5).
 */
export interface SectionBreakResult extends OperationResult {
  readonly newCursorBlockId: BlockId;
}

/**
 * Split the document into FLAT (never-nested) `section` blocks at `cursor`,
 * in ONE Y.Doc transaction.
 *
 * The break does NOT split the cursor's paragraph. It operates on the
 * **boundary block** = the document-root child at/under which the cursor sits
 * (resolved via `ancestorChain`). Blocks before the boundary form the leading
 * section; the boundary block + following siblings form the trailing section.
 * The cursor lands at `{ firstLeafBlock(boundary), 0 }`.
 *
 * Two cases:
 *   - **Implicit** (cursor is not already inside an explicit section): the doc
 *     root's children split into two freshly-created sections A and B.
 *   - **Explicit** (cursor is inside an existing doc-root section S): S retains
 *     the blocks before the boundary; a fresh section S' (threaded as a flat
 *     doc-root sibling immediately after S) takes the boundary block onward.
 *
 * No-op (Decision 5): if the boundary is the FIRST child of its container,
 * breaking would create an empty leading section. `applySectionBreak` returns
 * the input `state` reference UNCHANGED (T7 identity), with empty `dirtyIds`
 * and `newCursorBlockId === cursor.blockId`. This is the ONLY no-op path; every
 * other valid break mutates.
 *
 * Atomicity: all section creation + body reparenting + section-chain relink
 * happen inside a single `applyOperation` (one transaction, one `dirtyIds`
 * set), mirroring `replaceRange`.
 */
export function applySectionBreak(
  state: State,
  cursor: Position,
  allocator: IdAllocator,
): SectionBreakResult {
  // --- Step A: resolve container + boundary (pre-tx, one pass) ---
  const chain = ancestorChain(state, cursor.blockId);
  if (!chain.includes(state.rootId)) {
    throw new Error(
      `applySectionBreak: cursor block "${cursor.blockId}" not under document root`,
    );
  }

  // Enclosing flat doc-root section, if any. (At most one — sections are flat
  // doc-root children and never nest, Decision 6.)
  const S =
    chain.find((id) => {
      const b = getBlock(state, id);
      return b !== null && b.type === "section" && b.parentId === state.rootId;
    }) ?? null;
  const containerId = S ?? state.rootId;
  const isExplicit = S !== null;

  // The direct child of `containerId` that contains the cursor. Always exists
  // given the under-root check above.
  const boundary =
    chain.find((id) => {
      const b = getBlock(state, id);
      return b !== null && b.parentId === containerId;
    }) ?? null;
  if (boundary === null) {
    throw new Error(
      `applySectionBreak: could not resolve a boundary child of "${containerId}" for cursor "${cursor.blockId}"`,
    );
  }

  // --- Step B: no-op guard (Decision 5) ---
  const container = getBlock(state, containerId);
  if (container === null) {
    throw new Error(
      `applySectionBreak: container "${containerId}" not found`,
    );
  }
  if (container.firstChildId === boundary) {
    // Break at the container's first child → empty leading section; no-op.
    return {
      state,
      dirtyIds: new Set<BlockId>(),
      newCursorBlockId: cursor.blockId,
    };
  }

  // --- Step C: collect the run + capture pre-tx pointers ---
  // Walk the container's child chain into `before = [first .. boundary)` and
  // `atAfter = [boundary .. last]`. After Step B, `before` is non-empty.
  const before: BlockId[] = [];
  const atAfter: BlockId[] = [];
  {
    let cur: BlockId | null = container.firstChildId;
    let reachedBoundary = false;
    let guard = 0;
    // Cycle bound: total blocks across all three trees (`allTreeBlockCount`),
    // matching every other cycle-guarded traversal. A main-map-sized bound
    // (`getBlocksMap(doc).size`) under-bounds a walk that could legitimately
    // exceed the main map — see yjs-doc.ts `allTreeBlockCount` rationale.
    const maxSteps = allTreeBlockCount(state[STATE_INTERNAL].doc) + 1;
    while (cur !== null) {
      if (++guard > maxSteps) {
        throw new Error(
          "applySectionBreak: cycle detected walking container child chain",
        );
      }
      if (cur === boundary) reachedBoundary = true;
      if (reachedBoundary) atAfter.push(cur);
      else before.push(cur);
      const b = getBlock(state, cur);
      if (b === null) {
        throw new Error(
          `applySectionBreak: child "${cur}" of "${containerId}" not found`,
        );
      }
      cur = b.nextSiblingId;
    }
  }

  // Pre-tx pointer captures, gathered against the immutable snapshot so the
  // ReparentPlans + section-chain links are fully resolved before the
  // transaction opens (`reparentChildrenInTx` reads nothing).
  const containerFirstChildId = container.firstChildId;
  const containerLastChildId = container.lastChildId;

  const beforeFirst = before[0];
  const beforeLast = before[before.length - 1];
  if (beforeFirst === undefined || beforeLast === undefined) {
    // Unreachable: Step B guarantees `before` is non-empty. Narrows for types.
    throw new Error(
      "applySectionBreak: internal — `before` run unexpectedly empty",
    );
  }
  // boundary === atAfter[0] (the run starts at the boundary).
  const atAfterLast = atAfter[atAfter.length - 1];
  if (atAfterLast === undefined) {
    // `atAfter` always starts with `boundary`, so it is non-empty.
    throw new Error(
      "applySectionBreak: internal — `atAfter` run unexpectedly empty",
    );
  }
  // The block immediately before the boundary in the container chain (= the
  // last `before` element); used as `movedPrevSiblingId` for the `atAfter` run.
  const beforeBoundarySibling = beforeLast;

  // Explicit case: capture S's pre-tx nextSibling now (needed to relink S').
  let sOldNext: BlockId | null = null;
  if (S !== null) {
    const sBlock = getBlock(state, S);
    if (sBlock === null) {
      throw new Error(`applySectionBreak: enclosing section "${S}" not found`);
    }
    sOldNext = sBlock.nextSiblingId;
  }

  // --- Step D: mutate (one applyOperation) ---
  if (!isExplicit) {
    // Implicit: create A and B; move `before → A`, `atAfter → B`.
    const aId = allocator.allocate();
    const bId = allocator.allocate();

    // ReparentPlans against the pre-tx snapshot. A and B are fresh-empty, so
    // newParentLastChildId is null (append into empty parent).
    const beforePlan: ReparentPlan = {
      writes: computeReparentWrites({
        moved: before,
        sourceParentId: state.rootId,
        sourceFirstChildId: containerFirstChildId,
        sourceLastChildId: containerLastChildId,
        movedPrevSiblingId: null, // `before` is a prefix → no prior sibling
        movedNextSiblingId: boundary, // sibling after before[last]
        newParentId: aId,
        newParentLastChildId: null,
        beforeSiblingId: null,
        beforeSiblingPrevId: null,
      }),
    };
    const atAfterPlan: ReparentPlan = {
      writes: computeReparentWrites({
        moved: atAfter,
        sourceParentId: state.rootId,
        sourceFirstChildId: containerFirstChildId,
        sourceLastChildId: containerLastChildId,
        movedPrevSiblingId: beforeBoundarySibling, // block before boundary
        movedNextSiblingId: null, // `atAfter` is a suffix → no following sibling
        newParentId: bId,
        newParentLastChildId: null,
        beforeSiblingId: null,
        beforeSiblingPrevId: null,
      }),
    };

    const result = applyOperation(state, () => {
      const doc = state[STATE_INTERNAL].doc;
      const yBlocks = getBlocksMap(doc);
      // C.2: copy source-section attrs here (none in C.1b — implicit root has no section).
      yBlocks.set(aId, buildSectionYBlock(state.rootId));
      yBlocks.set(bId, buildSectionYBlock(state.rootId));

      reparentChildrenInTx(doc, beforePlan);
      reparentChildrenInTx(doc, atAfterPlan);

      // Section sibling chain + root pointers.
      const yRoot = getYBlock(doc, state.rootId, "applySectionBreak");
      yRoot.set("firstChildId", aId);
      yRoot.set("lastChildId", bId);
      const yA = getYBlock(doc, aId, "applySectionBreak");
      yA.set("prevSiblingId", null);
      yA.set("nextSiblingId", bId);
      const yB = getYBlock(doc, bId, "applySectionBreak");
      yB.set("prevSiblingId", aId);
      yB.set("nextSiblingId", null);
    });

    return finalize(result, boundary);
  }

  // Explicit: create S'; `before` stays in S; move `atAfter → S'`; thread S'
  // as a flat doc-root sibling immediately after S.
  const sPrimeId = allocator.allocate();
  const atAfterPlan: ReparentPlan = {
    writes: computeReparentWrites({
      moved: atAfter,
      sourceParentId: containerId, // === S
      sourceFirstChildId: containerFirstChildId,
      sourceLastChildId: containerLastChildId,
      movedPrevSiblingId: beforeBoundarySibling,
      movedNextSiblingId: null,
      newParentId: sPrimeId,
      newParentLastChildId: null,
      beforeSiblingId: null,
      beforeSiblingPrevId: null,
    }),
  };

  const result = applyOperation(state, () => {
    const doc = state[STATE_INTERNAL].doc;
    const yBlocks = getBlocksMap(doc);
    // C.2: copy source-section (S) attrs here (none in C.1b).
    yBlocks.set(sPrimeId, buildSectionYBlock(state.rootId));

    reparentChildrenInTx(doc, atAfterPlan);

    // `before` stays in S. Cutting S's tail to before[last] is ALREADY done by
    // atAfterPlan: computeReparentWrites's source-parent detach sets
    // S.lastChildId = movedPrevSiblingId (= beforeLast) and
    // beforeLast.nextSiblingId = movedNextSiblingId (= null). No explicit cut
    // needed here (a manual rewrite would only fire redundant change events).

    // Thread S' immediately after S in the doc-root sibling chain.
    const yS = getYBlock(doc, containerId, "applySectionBreak");
    const ySPrime = getYBlock(doc, sPrimeId, "applySectionBreak");
    ySPrime.set("prevSiblingId", containerId);
    ySPrime.set("nextSiblingId", sOldNext);
    yS.set("nextSiblingId", sPrimeId);
    if (sOldNext !== null) {
      const ySOldNext = getYBlock(doc, sOldNext, "applySectionBreak");
      ySOldNext.set("prevSiblingId", sPrimeId);
    } else {
      const yRoot = getYBlock(doc, state.rootId, "applySectionBreak");
      yRoot.set("lastChildId", sPrimeId);
    }
  });

  return finalize(result, boundary);
}

/**
 * Build a fresh, detached, empty `section` Y.Map parented at `rootId`.
 * In C.1b a section's `attrs` are always `{}` (Decision 2). The chain
 * pointers are set by the caller after attaching.
 */
function buildSectionYBlock(rootId: BlockId) {
  return buildYBlock({
    type: "section",
    attrs: {},
    parentId: rootId,
    prevSiblingId: null,
    nextSiblingId: null,
    firstChildId: null,
    lastChildId: null,
    inlineContent: null,
  });
}

/**
 * Step F: resolve the cursor target on the post-op state. The boundary block
 * keeps its id + subtree (only its parent moved), so `firstLeafBlock` resolves;
 * `?? boundary` is a defensive fallback for an empty subtree.
 *
 * (Decision 6's "sections never nest" invariant needs no runtime assert here:
 * it is structural — `buildSectionYBlock` hardcodes `parentId: rootId` for every
 * created section, and Step A only ever selects an enclosing section whose
 * `parentId === rootId`. There is no code path that could nest a section, so a
 * dev-assert would be unreachable dead code.)
 */
function finalize(
  result: OperationResult,
  boundary: BlockId,
): SectionBreakResult {
  const newCursorBlockId = firstLeafBlock(result.state, boundary) ?? boundary;
  return {
    state: result.state,
    dirtyIds: result.dirtyIds,
    newCursorBlockId,
  };
}
