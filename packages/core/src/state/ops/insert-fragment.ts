import type * as Y from "yjs";
import type { State, OperationResult } from "../state";
import { applyOperation, getBlock } from "../state";
import type { Block } from "../block";
import type { BlockId, IdAllocator } from "../block-id";
import type { Position, Span } from "../block-position";
import { createPosition } from "../block-position";
import type { InlineItem } from "../inline-content";
import { splitInlineContentAtOffset } from "../inline-content";
import { deleteRange } from "./delete-range";
import {
  planSplitBlockAtPosition,
  splitBlockAtPositionInTx,
} from "./split-block";
import {
  insertBlocksAfterInTx,
} from "./insert-blocks-after";
import type { SiblingBlockInit } from "./insert-blocks-after";
import {
  planInsertItemsSplitInPlace,
  insertItemsInTx,
} from "./insert-items";
import { clonePastedSubtree } from "../clone-pasted-subtree";
import { isCrossContextSelection } from "../../editor/actions/selection-guards";
import { spanStart } from "../block-compare";
import { isCollapsed } from "../../cursor/selection";
import { getListDefsForState } from "../list-defs";
import { writeListDefInTx } from "../list-defs";
import { newListId } from "../block-id";
import { getEmbedContentsMap } from "../yjs-doc";
import { buildYBlock } from "../y-block";

// ─────────────────────────────────────────────────────────────────────────────
// Public type
// ─────────────────────────────────────────────────────────────────────────────

/** Result of `insertFragment`: standard OperationResult plus the caret landing position. */
export interface InsertFragmentResult extends OperationResult {
  readonly endPosition: Position;
}

// ─────────────────────────────────────────────────────────────────────────────
// T7 seam: suggestion-record transfer (deferred)
// ─────────────────────────────────────────────────────────────────────────────

// T7: transfer suggestion records here
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function transferSuggestionRecords(_fragmentState: State, _destDoc: Y.Doc): void {
  // no-op — will be implemented in T7
}

// ─────────────────────────────────────────────────────────────────────────────
// T5b seam: container subtree splice (deferred)
// ─────────────────────────────────────────────────────────────────────────────

// T5b: container subtree splice — not yet implemented.
function containerSpliceStub(): never {
  throw new Error("insertFragment: container splice not yet implemented (T5b)");
}

// ─────────────────────────────────────────────────────────────────────────────
// Embed-content materialization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Materialize cloned embed-content blocks (footnote bodies + their subtrees)
 * into the destination's `embedContents` Y.Map. The blocks are FROZEN `Block`
 * SNAPSHOTS from `clonePastedSubtree` with fresh ids and re-keyed contentBlockId
 * references — `buildYBlock` turns each into a live Y.Map (mirrors
 * `insert-footnote.ts`'s body-materialization pattern). MUST run inside an
 * already-open transaction.
 */
function materializeEmbedContentsInTx(
  doc: Y.Doc,
  clonedEmbedContents: ReadonlyMap<BlockId, Block>,
): void {
  if (clonedEmbedContents.size === 0) return;
  const embedTree = getEmbedContentsMap(doc);
  for (const [id, block] of clonedEmbedContents) {
    embedTree.set(
      id,
      buildYBlock({
        type: block.type,
        attrs: block.attrs,
        parentId: block.parentId,
        prevSiblingId: block.prevSiblingId,
        nextSiblingId: block.nextSiblingId,
        firstChildId: block.firstChildId,
        lastChildId: block.lastChildId,
        inlineContent: block.inlineContent,
      }),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main operation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Insert a fragment `State` (produced by `extractFragment` / `decodeHtml` / `decodeFragmentClip`)
 * into `state` at `selection`, in DIRECT (non-suggesting) mode.
 *
 * **Leaf-only boundary semantics (T5a):**
 * - Cross-context selection → identity no-op.
 * - Non-collapsed selection → `deleteRange` first; caret = range start.
 * - Empty fragment (no top-level blocks) → identity no-op.
 * - Top-level container blocks → throws `"insertFragment: container splice not yet implemented (T5b)"`.
 * - 1 top-level leaf → inline-merge into caret block via `planInsertItemsSplitInPlace` + `insertItemsInTx`.
 * - N > 1 top-level leaves → split caret block; merge first leaf into prefix; insert middles via
 *   `insertBlocksAfter`; prepend last leaf to suffix.
 *
 * Fragment `listDefs` are cloned under fresh ids so pasted list numbering is
 * independent of the destination's lists. Suggestion-record copy is deferred to T7.
 */
export function insertFragment(
  state: State,
  selection: Span,
  fragment: State,
  allocator: IdAllocator,
): InsertFragmentResult {
  // Step 1: cross-context guard → identity no-op.
  if (isCrossContextSelection(state, selection)) {
    return { state, dirtyIds: new Set<BlockId>(), endPosition: selection.focus };
  }

  const accumulatedDirtyIds = new Set<BlockId>();

  // Step 2: non-collapsed selection → deleteRange; accumulate dirtyIds; caret = range start.
  let currentState: State = state;
  let caretPos: Position = isCollapsed(selection)
    ? selection.focus
    : spanStart(state, selection);

  if (!isCollapsed(selection)) {
    const deleteResult = deleteRange(currentState, selection);
    currentState = deleteResult.state;
    for (const id of deleteResult.dirtyIds) accumulatedDirtyIds.add(id);
    caretPos = spanStart(state, selection);
  }

  // Step 3: collect cloned top-level blocks from the fragment.
  const fragRoot = getBlock(fragment, fragment.rootId);
  if (fragRoot === null) {
    // Malformed fragment — identity no-op.
    return { state, dirtyIds: new Set<BlockId>(), endPosition: caretPos };
  }

  // Walk fragment's top-level children and clone EACH into the destination
  // namespace via `clonePastedSubtree` (spec §5 step 3). Cloning is REQUIRED
  // even for leaf paragraphs: a leaf routinely carries footnote-anchor /
  // comment-range embeds whose `contentBlockId` references a body in the
  // fragment's `embedContents`. `clonePastedSubtree` allocates fresh block ids,
  // RE-KEYS those embed contentBlockId references, and returns the footnote
  // bodies in `cloned.embedContents` — all of which must land in the
  // destination, or the pasted anchor's contentBlockId dangles (silent
  // corruption). We use the CLONED root's re-keyed inline items in every splice
  // arm (NOT the raw fragment items), and materialize every cloned
  // embed-content block into the destination tree inside the transaction.
  interface ClonedLeaf {
    readonly type: string;
    readonly attrs: Record<string, unknown>;
    readonly items: ReadonlyArray<InlineItem>;
  }

  const clonedLeaves: ClonedLeaf[] = [];
  // Accumulate every cloned embed-content block (footnote bodies + their
  // subtrees) from all top-level children — materialized into the destination's
  // embedContents map inside the transaction.
  const clonedEmbedContents = new Map<BlockId, Block>();

  let cur: BlockId | null = fragRoot.firstChildId;
  while (cur !== null) {
    const fragBlock = getBlock(fragment, cur);
    if (fragBlock === null) break;

    // T5b stub: containers are not yet supported.
    if (fragBlock.firstChildId !== null || fragBlock.inlineContent === null) {
      containerSpliceStub();
    }

    // Clone the leaf subtree into the destination namespace. For a leaf the
    // `blocks` map holds exactly one entry (the cloned root) whose inline items
    // carry RE-KEYED embed references; `embedContents` holds any footnote bodies
    // the leaf's embeds point at (recursively).
    const cloned = clonePastedSubtree(fragment, fragBlock.id, allocator, state);
    const clonedRoot = cloned.blocks.get(cloned.rootId);
    if (clonedRoot === null || clonedRoot === undefined) {
      throw new Error(
        `insertFragment: cloned root "${cloned.rootId}" missing from clone result`,
      );
    }
    if (clonedRoot.inlineContent === null) {
      // Defensive — the container guard above already rejects null-inlineContent
      // blocks, and cloning preserves the inlineContent slot.
      throw new Error(
        `insertFragment: cloned leaf "${cloned.rootId}" has no inlineContent`,
      );
    }
    clonedLeaves.push({
      type: clonedRoot.type,
      attrs: { ...(clonedRoot.attrs as Record<string, unknown>) },
      items: clonedRoot.inlineContent.items,
    });
    // Collect this child's cloned embed-content bodies for materialization.
    for (const [id, block] of cloned.embedContents) {
      clonedEmbedContents.set(id, block);
    }

    cur = fragBlock.nextSiblingId;
  }

  // Step 3 continued: merge fragment listDefs under fresh ids.
  // Build a listId remap: old fragment listId → new destination listId.
  const fragListDefs = getListDefsForState(fragment);
  const listIdRemap = new Map<string, string>();
  for (const [oldListId] of fragListDefs) {
    listIdRemap.set(oldListId, newListId());
  }

  // Step 4: splice.
  // Step 4a: 0 top-level blocks → identity no-op.
  if (clonedLeaves.length === 0) {
    return { state, dirtyIds: new Set<BlockId>(), endPosition: caretPos };
  }

  const caretBlockId = caretPos.blockId;
  const caretOffset = caretPos.offset;
  const caretBlock = getBlock(currentState, caretBlockId);
  if (caretBlock === null) {
    throw new Error(`insertFragment: caret block "${caretBlockId}" not found`);
  }
  if (caretBlock.inlineContent === null) {
    throw new Error(`insertFragment: caret block "${caretBlockId}" has no inlineContent (container?)`);
  }

  // Remap listIds in cloned leaves' attrs.
  function remapLeafAttrs(attrs: Record<string, unknown>): Record<string, unknown> {
    const listId = attrs["listId"];
    if (typeof listId === "string" && listIdRemap.has(listId)) {
      return { ...attrs, listId: listIdRemap.get(listId) };
    }
    return attrs;
  }

  // Remap all leaves' attrs.
  const remappedLeaves = clonedLeaves.map((leaf) => ({
    ...leaf,
    attrs: remapLeafAttrs(leaf.attrs),
  }));

  let endPosition: Position;

  if (remappedLeaves.length === 1) {
    // ── Single leaf: inline-merge items at caret offset ──────────────────────
    const leaf = remappedLeaves[0];
    if (leaf === undefined) throw new Error("insertFragment: invariant violation — leaf[0] undefined");
    const leafItems = leaf.items;
    const liveItems = caretBlock.inlineContent.items;

    const insertPlan = planInsertItemsSplitInPlace(
      caretBlockId,
      "block",
      liveItems,
      caretOffset,
      leafItems,
    );

    const insertedLength = leafItems.reduce(
      (sum, it) => sum + (it.kind === "text" ? it.text.length : 1),
      0,
    );

    const result = applyOperation(currentState, (doc) => {
      // Materialize cloned footnote bodies into the destination embedContents tree.
      materializeEmbedContentsInTx(doc, clonedEmbedContents);
      // Write fragment listDefs under fresh ids.
      for (const [oldId, def] of fragListDefs) {
        const newId = listIdRemap.get(oldId);
        if (newId !== undefined) writeListDefInTx(doc, newId, def);
      }
      // T7: transfer suggestion records here
      transferSuggestionRecords(fragment, doc);
      insertItemsInTx(doc, insertPlan);
    });

    currentState = result.state;
    for (const id of result.dirtyIds) accumulatedDirtyIds.add(id);
    endPosition = createPosition(caretBlockId, caretOffset + insertedLength);
  } else {
    // ── Multi-leaf: split-merge ───────────────────────────────────────────────
    // (a) Split caret block at caretOffset → prefix (caretBlockId) + suffix (new block).
    const splitPlan = planSplitBlockAtPosition(currentState, caretPos, allocator);
    const suffixBlockId = splitPlan.newBlockId;

    // (b) Compute the inline items for the prefix merge (first frag leaf items)
    //     and the suffix prepend (last frag leaf items).
    const firstLeaf = remappedLeaves[0];
    const lastLeaf = remappedLeaves[remappedLeaves.length - 1];
    if (firstLeaf === undefined || lastLeaf === undefined) {
      throw new Error("insertFragment: invariant violation — leaves undefined");
    }

    // After the split the prefix block has inline content = original [0..caretOffset).
    // We need to merge firstLeaf.items AT THE END of the prefix (i.e., at offset = caretOffset).
    // The suffix starts with original [caretOffset..end) items; we prepend lastLeaf.items at offset 0.
    // splitInlineContentAtOffset returns [headItems, tailItems] (a tuple).
    const [prefixItems, suffixItems] = splitInlineContentAtOffset(caretBlock.inlineContent, caretOffset);

    // Plan: insert firstLeaf.items at end of prefix (at offset = sum of prefixItems lengths).
    const prefixLength = prefixItems.reduce(
      (s, it) => s + (it.kind === "text" ? it.text.length : 1),
      0,
    );
    const prefixMergePlan = planInsertItemsSplitInPlace(
      caretBlockId,
      "block",
      prefixItems,
      prefixLength,
      firstLeaf.items,
    );

    // Plan: prepend lastLeaf.items at offset 0 of suffix.
    // The suffix block (post-split) has content = original [caretOffset..end).
    const suffixPrependPlan = planInsertItemsSplitInPlace(
      suffixBlockId,
      "block",
      suffixItems,
      0,
      lastLeaf.items,
    );

    // Middle leaves become SiblingBlockInit array, inserted after prefix (caretBlockId).
    const middleLeaves = remappedLeaves.slice(1, -1);
    const middleInits: SiblingBlockInit[] = middleLeaves.map((leaf) => ({
      type: leaf.type,
      attrs: leaf.attrs,
      inlineContent: { items: leaf.items },
    }));

    // Plan middle inserts (after prefix = caretBlockId).
    // IMPORTANT: planInsertBlocksAfter reads afterBlock.nextSiblingId from the pre-split state.
    // But after the split, prefix.nextSiblingId = suffixBlockId. So we compute the plan with
    // the correct post-split oldNextId by allocating IDs manually and constructing the plan directly.
    // We need the parentId of the caret block (which the split preserves — prefix keeps parentId).
    const caretParentId = caretBlock.parentId;
    if (caretParentId === null) {
      throw new Error("insertFragment: caret block has no parent (root)");
    }
    const middlePlan =
      middleLeaves.length > 0
        ? {
            parentId: caretParentId,
            afterBlockId: caretBlockId,
            // After the split, prefix.nextSiblingId = suffixBlockId.
            // Middle siblings are inserted between prefix and suffix.
            oldNextId: suffixBlockId,
            entries: middleInits.map((init) => ({
              id: allocator.allocate(),
              type: init.type,
              attrs: init.attrs ?? {},
              inlineContent: init.inlineContent ?? null,
            })),
          }
        : null;

    const lastInsertedLength = lastLeaf.items.reduce(
      (s, it) => s + (it.kind === "text" ? it.text.length : 1),
      0,
    );

    const result = applyOperation(currentState, (doc) => {
      // Materialize cloned footnote bodies into the destination embedContents tree.
      materializeEmbedContentsInTx(doc, clonedEmbedContents);
      // Write fragment listDefs under fresh ids.
      for (const [oldId, def] of fragListDefs) {
        const newId = listIdRemap.get(oldId);
        if (newId !== undefined) writeListDefInTx(doc, newId, def);
      }
      // T7: transfer suggestion records here
      transferSuggestionRecords(fragment, doc);
      // (a) Split the caret block.
      splitBlockAtPositionInTx(doc, splitPlan);
      // (b) Merge first frag leaf into prefix (append at end of prefix).
      insertItemsInTx(doc, prefixMergePlan);
      // (c) Insert middle siblings after prefix (if any).
      if (middlePlan !== null) {
        insertBlocksAfterInTx(doc, middlePlan);
      }
      // (d) Prepend last frag leaf to suffix.
      insertItemsInTx(doc, suffixPrependPlan);
    });

    currentState = result.state;
    for (const id of result.dirtyIds) accumulatedDirtyIds.add(id);

    // endPosition: end of lastLeaf.items prepended to suffix → offset = lastInsertedLength.
    endPosition = createPosition(suffixBlockId, lastInsertedLength);
  }

  // Step 5: identity check (handles the case where all operations were no-ops — unlikely but correct).
  if (currentState === state) {
    return { state, dirtyIds: new Set<BlockId>(), endPosition: caretPos };
  }

  return {
    state: currentState,
    dirtyIds: accumulatedDirtyIds,
    endPosition,
  };
}
