import type * as Y from "yjs";
import type { State, OperationResult } from "../state";
import { applyOperation, getBlock } from "../state";
import type { BlockId, IdAllocator } from "../block-id";
import type { Position } from "../block-position";
import {
  getBlocksMap,
  getYBlock,
  requireInTransaction,
  allTreeBlockCount,
} from "../yjs-doc";
import { buildYBlock } from "../y-block";
import {
  computeReparentWrites,
  reparentChildrenInTx,
  type ReparentPlan,
  type BlockFieldWrite,
} from "./reparent-children";
import { ancestorChain, firstLeafBlock } from "../block-traversal";
import { STATE_INTERNAL } from "../state-internal";

/**
 * Result of `applySectionBreak`. Extends `OperationResult` with the cursor
 * target after the break: the first leaf of the boundary block's subtree.
 * Equals `cursor.blockId` on the no-op path (Decision 5).
 */
export interface SectionBreakResult extends OperationResult {
  readonly newCursorBlockId: BlockId;
}

/**
 * Pre-computed, fully-resolved mutation plan for `applySectionBreakInTx`.
 * Built (with all validation + snapshot reads + id allocation) by
 * `buildSectionBreakPlan` BEFORE any transaction opens, so the applier reads
 * nothing from `state` or the live Y.Doc.
 *
 * Both kinds share the SAME three applier ingredients, so a single applier
 * handles them without branching:
 *   - `sectionIds` — the fresh `section` Y.Maps to create (parented at
 *     `rootId`, attrs `{}`, all chain pointers null — the explicit pointer
 *     writes below set the real links). Implicit: `[A, B]`. Explicit: `[S']`.
 *   - `reparentPlans` — `ReparentPlan`s (resolved against the pre-mutation
 *     snapshot via `computeReparentWrites`) moving block runs into the fresh
 *     sections. Implicit: `before→A`, `atAfter→B`. Explicit: `atAfter→S'`
 *     (the leading run stays in the source section — the reparent's
 *     source-parent detach already cuts the source's tail).
 *   - `pointerWrites` — the sibling/parent relink writes that thread the new
 *     section(s) into the doc-root chain (root first/last pointers + the
 *     section sibling links). Reuses `reparent-children`'s `BlockFieldWrite`
 *     shape so the applier loops one write-list type.
 *
 * `kind` is carried for callers/tests that assert which case fired; the
 * applier does not branch on it. `boundary` is the boundary block id — its
 * id + subtree are unchanged by the break (only its parent moves), so the
 * public op resolves the post-op cursor from it.
 *
 * TREE SCOPE: operates on the MAIN `blocks` tree only — sections are flat
 * doc-root children (Decision 6). The plan carries no `kind`-tree field.
 */
export interface SectionBreakPlan {
  readonly kind: "implicit" | "explicit";
  readonly boundary: BlockId;
  readonly rootId: BlockId;
  readonly sectionIds: readonly BlockId[];
  readonly reparentPlans: readonly ReparentPlan[];
  readonly pointerWrites: readonly BlockFieldWrite[];
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
 * other valid break mutates. `buildSectionBreakPlan` returns `null` for it.
 *
 * Atomicity: all section creation + body reparenting + section-chain relink
 * happen inside a single `applyOperation` (one transaction, one `dirtyIds`
 * set), mirroring `replaceRange`. Validation + id allocation happen in
 * `buildSectionBreakPlan` (pre-transaction); `applySectionBreakInTx` is the
 * single pure applier.
 */
export function applySectionBreak(
  state: State,
  cursor: Position,
  allocator: IdAllocator,
): SectionBreakResult {
  const plan = buildSectionBreakPlan(state, cursor, allocator);

  // No-op (Decision 5): boundary is the container's first child. Return the
  // SAME state ref WITHOUT opening a transaction (T7 identity).
  if (plan === null) {
    return {
      state,
      dirtyIds: new Set<BlockId>(),
      newCursorBlockId: cursor.blockId,
    };
  }

  const result = applyOperation(state, (doc) => {
    applySectionBreakInTx(doc, plan);
  });

  // The boundary block keeps its id + subtree (only its parent moved), so
  // `firstLeafBlock` resolves; `?? boundary` is a defensive fallback for an
  // empty subtree.
  const newCursorBlockId =
    firstLeafBlock(result.state, plan.boundary) ?? plan.boundary;
  return {
    state: result.state,
    dirtyIds: result.dirtyIds,
    newCursorBlockId,
  };
}

/**
 * Validate `cursor` against the pre-mutation `state` snapshot and produce a
 * fully-resolved `SectionBreakPlan` (all reads + id allocation done here,
 * before any transaction). Returns `null` for the Decision-5 no-op (boundary
 * is the container's first child → the public op maps that to the T7 identity
 * return without opening a transaction, mirroring `planInsertBlocksAfter`).
 *
 * Throws if the cursor block is not under the document root, or if a captured
 * pointer is corrupt (the same error contract the inline op had).
 *
 * Allocates the fresh section id(s) via `allocator` (once each, outside any
 * tx) so the allocator is bumped exactly once even if the transaction body
 * re-runs.
 */
export function buildSectionBreakPlan(
  state: State,
  cursor: Position,
  allocator: IdAllocator,
): SectionBreakPlan | null {
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
    return null;
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

  // --- Step D: build the discriminated plan (no mutation) ---
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

    // Section sibling chain + root pointers, as resolved writes.
    const pointerWrites: BlockFieldWrite[] = [
      { blockId: state.rootId, field: "firstChildId", value: aId },
      { blockId: state.rootId, field: "lastChildId", value: bId },
      { blockId: aId, field: "prevSiblingId", value: null },
      { blockId: aId, field: "nextSiblingId", value: bId },
      { blockId: bId, field: "prevSiblingId", value: aId },
      { blockId: bId, field: "nextSiblingId", value: null },
    ];

    return {
      kind: "implicit",
      boundary,
      rootId: state.rootId,
      sectionIds: [aId, bId],
      reparentPlans: [beforePlan, atAfterPlan],
      pointerWrites,
    };
  }

  // Explicit: create S'; `before` stays in S; move `atAfter → S'`; thread S'
  // as a flat doc-root sibling immediately after S.
  const sPrimeId = allocator.allocate();

  // Capture S's pre-tx nextSibling now (needed to relink S').
  const sBlock = getBlock(state, containerId);
  if (sBlock === null) {
    throw new Error(`applySectionBreak: enclosing section "${containerId}" not found`);
  }
  const sOldNext = sBlock.nextSiblingId;

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

  // `before` stays in S. Cutting S's tail to before[last] is ALREADY done by
  // atAfterPlan: computeReparentWrites's source-parent detach sets
  // S.lastChildId = movedPrevSiblingId (= beforeLast) and
  // beforeLast.nextSiblingId = movedNextSiblingId (= null). No explicit cut
  // needed here.
  //
  // Thread S' immediately after S in the doc-root sibling chain.
  const pointerWrites: BlockFieldWrite[] = [
    { blockId: sPrimeId, field: "prevSiblingId", value: containerId },
    { blockId: sPrimeId, field: "nextSiblingId", value: sOldNext },
    { blockId: containerId, field: "nextSiblingId", value: sPrimeId },
  ];
  if (sOldNext !== null) {
    pointerWrites.push({ blockId: sOldNext, field: "prevSiblingId", value: sPrimeId });
  } else {
    pointerWrites.push({ blockId: state.rootId, field: "lastChildId", value: sPrimeId });
  }

  return {
    kind: "explicit",
    boundary,
    rootId: state.rootId,
    sectionIds: [sPrimeId],
    reparentPlans: [atAfterPlan],
    pointerWrites,
  };
}

/**
 * Pure Y.Doc-mutation primitive: applies a pre-computed `SectionBreakPlan`
 * to `doc`. Caller is responsible for all validation and for opening the
 * surrounding `applyOperation` / `runTransaction` (this function MUST run
 * inside an already-open transaction; it does NOT open one itself).
 *
 * Handles BOTH plan kinds with ONE branch-free body: create the fresh
 * section(s), apply every reparent plan, then apply every section-chain
 * pointer write. The implicit/explicit difference is fully encoded in the
 * plan's `sectionIds` / `reparentPlans` / `pointerWrites` data.
 *
 * Used by `applySectionBreak` (the thin public wrapper that validates + plans
 * + wraps in `applyOperation`).
 */
export function applySectionBreakInTx(doc: Y.Doc, plan: SectionBreakPlan): void {
  requireInTransaction(doc, "applySectionBreak");

  const yBlocks = getBlocksMap(doc);
  // C.2: a section's `attrs` are always `{}` in C.1b (Decision 2). No source-
  // section attrs are copied (implicit root has none; explicit S carries none).
  for (const sectionId of plan.sectionIds) {
    yBlocks.set(sectionId, buildSectionYBlock(plan.rootId));
  }

  for (const reparentPlan of plan.reparentPlans) {
    reparentChildrenInTx(doc, reparentPlan);
  }

  for (const w of plan.pointerWrites) {
    getYBlock(doc, w.blockId, "applySectionBreak").set(w.field, w.value);
  }
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
