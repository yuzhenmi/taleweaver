import * as Y from "yjs";
import type { State, OperationResult } from "../state";
import { applyOperation, resolveBlock } from "../state";
import { asBlockId, type BlockId } from "../block-id";
import { getTreeMap, getYBlock, requireInTransaction, type BlockTreeKind } from "../yjs-doc";
import { cloneInlineItem, mergeAdjacentSameAttrsTextItemsInPlace } from "../y-utils";
import { type EmbedItem } from "../inline-content";
import { buildYInlineItem } from "../y-block";
import { assertSameTree } from "../assert-same-tree";
import {
  BLOCK_JOIN_SUGGESTION_EMBED_TYPE,
  writeSuggestionRecordInTx,
  type SuggestionMintInput,
} from "../suggestions";
// Type-only import — runtime cycle is broken by `import type` (erased at runtime).
import type { AttrRegistry } from "../../cascade/attr-registry";

// Shared empty dirty-set for identity no-op returns (mirror suggestion-ops.ts's
// NO_DIRTY): a degenerate `markBlockJoinSuggestion` returns the input `state`
// reference + this shared empty set so callers can short-circuit on
// `result.state === state`.
const NO_DIRTY: ReadonlySet<BlockId> = new Set<BlockId>();

/**
 * Pre-computed mutation plan for `mergeAdjacentBlocksInTx`. Captures the
 * fully-resolved write inputs:
 *   - `leftId` / `rightId` — the two blocks being merged. Left wins.
 *   - `kind` — the tree they live in; resolved at plan time from `resolveBlock`
 *     so `inTx` doesn't have to re-resolve. Both blocks share the same tree
 *     (block-tree invariant, dev-asserted via `assertSameTree`).
 *   - `parentId` — the shared parent (guaranteed non-null by the planner;
 *     adjacent siblings can't both be the root).
 *   - `rightNextId` — right's old next sibling. Threaded to `inTx` so the
 *     plan describes the post-mutation linkage (left.nextSiblingId becomes
 *     rightNextId; if non-null, rightNext.prevSiblingId becomes leftId;
 *     if null, parent.lastChildId becomes leftId).
 *
 * The plan is plain data — no Y types, no `State` references, no
 * function-bearing objects. `AttrRegistry` (used by the seam-merge
 * normalizer for custom per-key `equals` semantics) is NOT carried on the
 * plan; it is passed as a separate argument to `mergeAdjacentBlocksInTx`
 * (mirroring how `insertText` threads registry alongside, not inside, its
 * plan).
 */
export interface MergeBlocksPlan {
  readonly leftId: BlockId;
  readonly rightId: BlockId;
  readonly kind: BlockTreeKind;
  readonly parentId: BlockId;
  readonly rightNextId: BlockId | null;
}

/**
 * Merge two adjacent leaf siblings into one block.
 *
 * Left wins: keeps id, type, attrs, parentId, prevSiblingId. Its
 * nextSiblingId is rewired to right.nextSiblingId. Its inlineContent
 * becomes [...left.items, ...right.items] with a run-merging post-pass
 * across the seam.
 *
 * Right is removed from state.blocks. If right had a nextSibling, that
 * sibling's prevSiblingId is rewired to leftId. If right was the parent's
 * lastChildId, the parent's lastChildId is rewired to leftId.
 *
 * Returns OperationResult with dirtyIds containing:
 *   - left's id (content + nextSiblingId changed)
 *   - right's id (removed from state.blocks)
 *   - right's old nextSibling, if non-null (its prevSiblingId was rewired)
 *   - parent's id, if right was the last child (parent's lastChildId rewired)
 *
 * Throws if:
 *   - either block does not exist,
 *   - leftId === rightId,
 *   - either block is a container (firstChildId !== null OR inlineContent === null),
 *   - blocks have different parents,
 *   - blocks are not adjacent siblings (left.nextSiblingId !== rightId
 *     OR right.prevSiblingId !== leftId).
 *
 * Y.Doc identity: right's items are deep-cloned onto left's inlineContent
 * Y.Array (Yjs forbids re-parenting a Y type). Left's existing items retain
 * their Y.Text identity, INCLUDING the left-side seam run when the seam
 * converges (last-of-left and first-of-right have value-equal attrs): the
 * in-place seam-merge appends the right run's chars into the left (receiver)
 * run's `Y.Text` and drops the cloned donor — so the left run keeps identity
 * (only the donor's migrated chars are fresh, which they already were as a
 * clone). Items away from the seam are never touched.
 *
 * `registry` (optional): an `AttrRegistry`; threaded to the seam-merge
 * normalizer (`mergeAdjacentSameAttrsTextItemsInPlace`) so interpreters with a
 * custom per-key `equals` (e.g. a `comment` interpreter that ignores
 * `timestamp`) opt into custom adjacent-item compare semantics across
 * the block seam. Omitted → deep-value compare.
 *
 * Composition: see `mergeAdjacentBlocksInTx` for the in-transaction primitive
 * used to chain a merge with other `*InTx` ops inside a single Y.Doc
 * transaction (one undo entry / one collab event).
 */
export function mergeAdjacentBlocks(
  state: State,
  leftId: BlockId,
  rightId: BlockId,
  registry?: AttrRegistry,
): OperationResult {
  const plan = planMergeAdjacentBlocks(state, leftId, rightId);
  return applyOperation(state, (doc) => {
    mergeAdjacentBlocksInTx(doc, plan, registry);
  });
}

/**
 * Validate the requested merge against the pre-mutation `state` snapshot and
 * produce a `MergeBlocksPlan`. Throws on every condition
 * `mergeAdjacentBlocks`'s docstring lists.
 *
 * All validation reads happen here, BEFORE the surrounding `applyOperation`
 * is opened. The plan captures everything `mergeAdjacentBlocksInTx` needs to
 * run the mutations without further reads from `state`.
 */
export function planMergeAdjacentBlocks(
  state: State,
  leftId: BlockId,
  rightId: BlockId,
): MergeBlocksPlan {
  if (leftId === rightId) {
    throw new Error(`mergeAdjacentBlocks: left and right are the same block "${leftId}"`);
  }

  // Resolve the reference (left) block ONCE to learn its owning tree (`kind`);
  // every kind-routed write in `inTx` targets that tree. `right` and the other
  // neighbors are asserted to live in the same tree below.
  const leftResolved = resolveBlock(state, leftId);
  if (leftResolved === null) {
    throw new Error(`mergeAdjacentBlocks: left block "${leftId}" not found`);
  }
  const { block: left, kind } = leftResolved;
  const right = resolveBlock(state, rightId)?.block ?? null;
  if (right === null) {
    throw new Error(`mergeAdjacentBlocks: right block "${rightId}" not found`);
  }

  if (!left.inlineContent || left.firstChildId !== null) {
    throw new Error(
      `mergeAdjacentBlocks: left block "${leftId}" is a container, not a leaf`,
    );
  }
  if (!right.inlineContent || right.firstChildId !== null) {
    throw new Error(
      `mergeAdjacentBlocks: right block "${rightId}" is a container, not a leaf`,
    );
  }

  if (left.parentId !== right.parentId) {
    throw new Error(
      `mergeAdjacentBlocks: blocks "${leftId}" and "${rightId}" have different parents ` +
      `("${left.parentId}" vs "${right.parentId}")`,
    );
  }

  if (left.nextSiblingId !== rightId || right.prevSiblingId !== leftId) {
    throw new Error(
      `mergeAdjacentBlocks: blocks "${leftId}" and "${rightId}" are not adjacent siblings ` +
      `(left.nextSiblingId="${left.nextSiblingId}", right.prevSiblingId="${right.prevSiblingId}")`,
    );
  }

  // Defensive — same-parent + adjacency implies non-null parent (siblings can't
  // both be the root, since the root is unique and has no siblings).
  const parentId = left.parentId;
  if (parentId === null) {
    throw new Error(
      `mergeAdjacentBlocks: blocks "${leftId}" and "${rightId}" have null parent (state corruption)`,
    );
  }

  // The neighbor ids this op reads + rewires: right (deleted), right's old
  // next sibling (its prevSiblingId flips to left), and the parent (its
  // lastChildId may flip). All must live in the SAME tree as the reference
  // (left) block — a cross-tree pointer would mean the kind-routed writes
  // in `inTx` corrupt state. (Dev-only; production no-op.)
  assertSameTree(
    state,
    kind,
    [rightId, right.nextSiblingId, parentId],
    "mergeAdjacentBlocks",
  );

  return {
    leftId,
    rightId,
    kind,
    parentId,
    rightNextId: right.nextSiblingId,
  };
}

/**
 * Pure Y.Doc-mutation primitive: applies a pre-computed `MergeBlocksPlan`
 * to `doc`. Caller is responsible for all validation and for opening the
 * surrounding `applyOperation` / `runTransaction` (this function MUST run
 * inside an already-open transaction; it does NOT open one itself).
 *
 * Used by:
 *   - `mergeAdjacentBlocks` (thin wrapper that validates + plans + wraps
 *     in `applyOperation`).
 *   - Future composers needing to chain a block merge with another `*InTx`
 *     op inside ONE Y.Doc transaction.
 *
 * Reads from the LIVE Y.Doc (the two blocks' inlineContent Y.Arrays) are
 * unavoidable here — Yjs forbids re-parenting a Y type so right's items
 * must be cloned onto left's array, which requires touching the live
 * arrays. Those reads target the items being mutated, not the snapshot,
 * so they remain composition-safe.
 */
export function mergeAdjacentBlocksInTx(
  doc: Y.Doc,
  plan: MergeBlocksPlan,
  registry?: AttrRegistry,
): void {
  requireInTransaction(doc, "mergeAdjacentBlocks");

  // Route every map access to the reference (left) block's owning tree
  // (`plan.kind`): merging two header/footer-body paragraphs
  // (templateContents) must delete `right` from templateContents, not the
  // main `blocks` map.
  const yTree = getTreeMap(doc, plan.kind);
  const yLeft = getYBlock(doc, plan.leftId, "mergeAdjacentBlocks", plan.kind);
  const yRight = getYBlock(doc, plan.rightId, "mergeAdjacentBlocks", plan.kind);
  const yLeftItems = yLeft.get("inlineContent") as Y.Array<Y.Map<unknown>>;
  const yRightItems = yRight.get("inlineContent") as Y.Array<Y.Map<unknown>>;

  // Append clones of right's items to left. Yjs forbids re-parenting a Y
  // type, so we clone — left keeps its existing items' Y.Text identity;
  // only right's items get freshly materialized on the left side.
  const cloned: Y.Map<unknown>[] = [];
  for (let i = 0; i < yRightItems.length; i++) {
    cloned.push(cloneInlineItem(yRightItems.get(i)));
  }
  if (cloned.length > 0) {
    yLeftItems.push(cloned);
    // Same-attrs merge pass to uphold the normalized inline-content invariant.
    // Only needed when we actually appended items. In-place: the left-side seam
    // run (receiver) keeps its Y.Text identity (the donor was a fresh clone anyway).
    mergeAdjacentSameAttrsTextItemsInPlace(yLeftItems, registry);
  }

  // Rewire siblings around right (right.next becomes left.next).
  yLeft.set("nextSiblingId", plan.rightNextId);
  if (plan.rightNextId !== null) {
    getYBlock(doc, plan.rightNextId, "mergeAdjacentBlocks", plan.kind).set(
      "prevSiblingId",
      plan.leftId,
    );
  } else {
    // Right was the last child — rewire parent.lastChildId to left.
    // Preconditions guarantee parent.lastChildId is rightId (same-parent
    // + adjacent-sibling + right.nextSibling===null). Unconditional
    // rewire matches the documented contract; an upstream invariant
    // violation would surface as a getYBlock throw.
    const yParent = getYBlock(doc, plan.parentId, "mergeAdjacentBlocks", plan.kind);
    yParent.set("lastChildId", plan.leftId);
  }

  // Delete right last (after reads of yRight are done) from the owning tree.
  yTree.delete(plan.rightId);
}

/**
 * Merge `leftId` with its CURRENT next sibling, reading both blocks' sibling ids
 * + content LIVE from `doc` inside the open transaction (NOT a pre-tx plan). Use
 * when chaining multiple merges in one tx where an earlier merge invalidates a
 * later block's pre-computed nextSiblingId (the `resolveAll` break cascade: a run
 * of consecutive owners each merge with their next sibling, REVERSE document
 * order, so by the time `leftId` is processed its next sibling may have absorbed
 * a block that came after it). No-op (returns without merging) when there is no
 * next sibling, or the pair is not a valid same-parent adjacent LEAF pair
 * (defensive — the boundary may have moved). MUST run inside an already-open
 * transaction.
 *
 * Unlike {@link mergeAdjacentBlocksInTx} (which trusts a pre-validated
 * {@link MergeBlocksPlan}), this builds the plan from LIVE Y.Doc reads so it
 * reflects prior merges in the same transaction — `rightId` and `rightNextId`
 * are read off the live blocks, never a stale snapshot.
 */
export function mergeWithNextSiblingLiveInTx(
  doc: Y.Doc,
  leftId: BlockId,
  kind: BlockTreeKind,
  registry?: AttrRegistry,
): void {
  requireInTransaction(doc, "mergeWithNextSiblingLive");

  const yLeft = getYBlock(doc, leftId, "mergeWithNextSiblingLive", kind);
  // No next sibling (last child, or already merged away) — nothing to merge.
  const rightRaw = yLeft.get("nextSiblingId");
  if (typeof rightRaw !== "string") return;
  const rightId = asBlockId(rightRaw);
  const yRight = getYBlock(doc, rightId, "mergeWithNextSiblingLive", kind);

  // Same-parent adjacent LEAF-pair validity, read LIVE. The root has a null
  // parent (can't merge); a cross-parent boundary or a container is not a valid
  // merge. A leaf has a NON-null `inlineContent` Y.Array and a null `firstChildId`
  // (mutually exclusive). Check BOTH — a true superset of what
  // `mergeAdjacentBlocksInTx` requires (which reads both blocks' `inlineContent`
  // arrays unconditionally), matching `planMergeAdjacentBlocks`'s leaf guard so a
  // degenerate block can never reach the unconditional Y.Array read.
  const parentRaw = yLeft.get("parentId");
  if (typeof parentRaw !== "string") return;
  if (yRight.get("parentId") !== parentRaw) return;
  if (yLeft.get("firstChildId") !== null || yRight.get("firstChildId") !== null) return;
  if (yLeft.get("inlineContent") == null || yRight.get("inlineContent") == null) return;

  // Right's old next sibling — threaded into the plan as the post-merge linkage.
  const rightNextRaw = yRight.get("nextSiblingId");
  const rightNextId = typeof rightNextRaw === "string" ? asBlockId(rightNextRaw) : null;

  const plan: MergeBlocksPlan = {
    leftId,
    rightId,
    kind,
    parentId: asBlockId(parentRaw),
    rightNextId,
  };
  mergeAdjacentBlocksInTx(doc, plan, registry);
}

/**
 * The Backspace-at-block-start / Delete-at-block-end JOIN op in Suggesting mode:
 * mark the paragraph break BEFORE `secondBlockId` (the boundary between
 * `secondBlockId` and its previous sibling, block N) as a tracked suggested
 * DELETION — WITHOUT merging the two blocks. The merge is deferred to resolution
 * (a LATER slice): on ACCEPT the blocks merge (the break is removed); on REJECT
 * the embed is removed (the break stays). This op only CREATES the suggestion.
 *
 * Symmetric mirror of {@link splitWithSuggestion} (the suggested-SPLIT create op),
 * but simpler: there is no structural change. A suggested join is modeled as a
 * single zero-width {@link BLOCK_JOIN_SUGGESTION_EMBED_TYPE} embed APPENDED to block
 * N's live `inlineContent` Y.Array (the prev sibling of `secondBlockId`) carrying the
 * owning `suggestionId` in its `properties`, PLUS a `deletion` {@link SuggestionRecord}
 * — both in ONE tracked `applyOperation` transaction (one undo entry / one collab
 * event). Appending — rather than full-replacing N — preserves the per-character CRDT
 * identity of N's surviving text runs (the foundation the Yjs-backed state model
 * exists to protect for collab). The embed occupies exactly ONE `Position` offset
 * (every embed does) and serializes to "" — it is the marker the range scan
 * ({@link buildSuggestionRangeIndex}) reads to surface the suggestion's range.
 *
 * Why NOT merge now: Google Docs shows both paragraphs intact while the deletion
 * is pending — the author can still see and edit the break-to-be-removed. The
 * blocks stay two REAL separate blocks until the suggestion is accepted.
 *
 * Identity no-op (returns the input `state` reference + an empty dirtyIds set,
 * mirroring {@link markDeletion}/{@link mintInsertion}'s degenerate-input returns)
 * when there is no boundary to mark:
 *   - `secondBlockId` does not resolve (block missing).
 *   - `secondBlockId` is a FIRST child (`prevSiblingId === null`): there is no
 *     preceding break before a first child, so there is nothing to suggest-delete.
 *   - the prev sibling (block N) does not resolve, or is a CONTAINER
 *     (`inlineContent === null`): a container can't hold an inline break embed.
 *
 * Unlike the in-place suggestion CREATE ops ({@link mintInsertion} et al.) there is
 * NO coalescing: a paragraph break is a discrete structural change — each removed
 * break is its own suggestion (mirror of {@link splitWithSuggestion} and the
 * undo-coalescing model, where each structural keystroke is its own entry).
 */
export function markBlockJoinSuggestion(
  state: State,
  secondBlockId: BlockId,
  input: SuggestionMintInput,
): OperationResult {
  // Resolve the SECOND block (the one whose preceding break is being marked). A
  // missing block is a no-op — return identity (mirror markDeletion's null guard).
  const second = resolveBlock(state, secondBlockId);
  if (second === null) {
    return { state, dirtyIds: NO_DIRTY };
  }

  // A first child has no preceding boundary to mark — identity no-op.
  const prevId = second.block.prevSiblingId;
  if (prevId === null) {
    return { state, dirtyIds: NO_DIRTY };
  }

  // Block N (the first block / the prev sibling) hosts the break embed. It must
  // be a leaf (non-null inlineContent) — a container can't hold an inline embed.
  const prev = resolveBlock(state, prevId);
  if (prev === null || prev.block.inlineContent === null) {
    return { state, dirtyIds: NO_DIRTY };
  }

  // The zero-width join-break embed (carrying the owning deletion id), built as
  // plain data PRE-transaction. It is a merge BARRIER (never folded into a
  // neighbor), so it stays the LAST item of block N after the append.
  const embed: EmbedItem = Object.freeze({
    kind: "embed",
    embedType: BLOCK_JOIN_SUGGESTION_EMBED_TYPE,
    attrs: Object.freeze({}),
    properties: Object.freeze({ suggestionId: input.id }),
  });

  return applyOperation(state, (doc) => {
    // 1. APPEND the break embed to block N's LIVE inlineContent Y.Array (single block
    //    write — no structural change). Appending preserves N's text-run CRDT identity
    //    (no full-replace); N's existing content is already normalized and the barrier
    //    embed stays last.
    const yN = getYBlock(doc, prevId, "markBlockJoinSuggestion", prev.kind);
    const yItems = yN.get("inlineContent") as Y.Array<Y.Map<unknown>>;
    yItems.push([buildYInlineItem(embed)]);
    // 2. Write the `deletion` record (a suggested join IS a tracked deletion of a
    //    paragraph break).
    writeSuggestionRecordInTx(doc, {
      id: input.id,
      kind: "deletion",
      author: input.author,
      createdAt: input.createdAt,
    });
  });
}
