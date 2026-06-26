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
  planInsertItemsSplitInPlace,
  insertItemsInTx,
} from "./insert-items";
import { clonePastedSubtree } from "../clone-pasted-subtree";
import type { ClonedSubtree } from "../clone-pasted-subtree";
import { isCrossContextSelection } from "../../editor/actions/selection-guards";
import { spanStart } from "../block-compare";
import { isCollapsed } from "../../cursor/selection";
import { getListDefsForState } from "../list-defs";
import { writeListDefInTx } from "../list-defs";
import { newListId } from "../block-id";
import { getBlocksMap, getEmbedContentsMap, getYBlock } from "../yjs-doc";
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
 * **Boundary semantics (T5a + T5b):**
 * - Cross-context selection → identity no-op.
 * - Non-collapsed selection → `deleteRange` first; caret = range start.
 * - Empty fragment (no top-level blocks) → identity no-op.
 * - 1 top-level leaf → inline-merge into caret block via `planInsertItemsSplitInPlace`.
 * - N > 1 top-level items (leaves and/or containers) → split caret block; first leaf (if any)
 *   merges into prefix; last leaf (if any) prepends to suffix; middle items (containers and/or
 *   leaves) become standalone siblings; container subtrees are materialized into
 *   `getBlocksMap` + relinked inline in the transaction body.
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

  /** A single top-level item collected from the fragment walk. */
  type TopLevelItem =
    | {
        readonly kind: "leaf";
        readonly type: string;
        readonly attrs: Record<string, unknown>;
        readonly items: ReadonlyArray<InlineItem>;
      }
    | {
        readonly kind: "container";
        readonly cloned: ClonedSubtree;
      };

  const topLevelItems: TopLevelItem[] = [];
  // Accumulate every cloned embed-content block (footnote bodies + their
  // subtrees) from all top-level children — materialized into the destination's
  // embedContents map inside the transaction.
  const clonedEmbedContents = new Map<BlockId, Block>();

  let cur: BlockId | null = fragRoot.firstChildId;
  while (cur !== null) {
    const fragBlock = getBlock(fragment, cur);
    if (fragBlock === null) break;

    // Clone the subtree into the destination namespace. For a leaf, `blocks`
    // holds exactly one entry; for a container, `blocks` holds the whole
    // subtree (table + rows + cells + leaf paragraphs). `embedContents` holds
    // any footnote bodies reachable from inline content at any depth.
    const cloned = clonePastedSubtree(fragment, fragBlock.id, allocator, state);
    const clonedRoot = cloned.blocks.get(cloned.rootId);
    if (clonedRoot === null || clonedRoot === undefined) {
      throw new Error(
        `insertFragment: cloned root "${cloned.rootId}" missing from clone result`,
      );
    }

    // Collect this child's cloned embed-content bodies for materialization.
    for (const [id, block] of cloned.embedContents) {
      clonedEmbedContents.set(id, block);
    }

    if (clonedRoot.inlineContent !== null && clonedRoot.firstChildId === null) {
      // Leaf block: record as a leaf item.
      topLevelItems.push({
        kind: "leaf",
        type: clonedRoot.type,
        attrs: { ...(clonedRoot.attrs as Record<string, unknown>) },
        items: clonedRoot.inlineContent.items,
      });
    } else {
      // Container block (table, section, etc.): record the full cloned subtree.
      topLevelItems.push({ kind: "container", cloned });
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
  if (topLevelItems.length === 0) {
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

  // Remap listIds in leaf attrs.
  function remapLeafAttrs(attrs: Record<string, unknown>): Record<string, unknown> {
    const listId = attrs["listId"];
    if (typeof listId === "string" && listIdRemap.has(listId)) {
      return { ...attrs, listId: listIdRemap.get(listId) };
    }
    return attrs;
  }

  // Apply listId remap to all leaf items.
  const remappedItems: TopLevelItem[] = topLevelItems.map((item) => {
    if (item.kind === "leaf") {
      return { ...item, attrs: remapLeafAttrs(item.attrs) };
    }
    return item;
  });

  let endPosition: Position;

  // ── Single leaf: inline-merge items at caret offset ──────────────────────
  if (remappedItems.length === 1 && remappedItems[0]?.kind === "leaf") {
    const leaf = remappedItems[0];
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
    // ── Multi-item (containers and/or multiple leaves): split-merge ──────────
    //
    // General algorithm:
    //   - Split caret block at caretOffset → prefix (caretBlockId) + suffix (suffixBlockId).
    //   - If first item is a leaf: merge its items into the end of prefix.
    //   - If last item is a leaf: prepend its items to the start of suffix.
    //   - Everything in between (containers and/or middle leaves) → insert as
    //     standalone siblings between prefix and suffix. All materialized in one
    //     transaction via getBlocksMap + boundary relink.

    const splitPlan = planSplitBlockAtPosition(currentState, caretPos, allocator);
    const suffixBlockId = splitPlan.newBlockId;

    const caretParentId = caretBlock.parentId;
    if (caretParentId === null) {
      throw new Error("insertFragment: caret block has no parent (root)");
    }

    // Identify first and last leaf for prefix/suffix merge.
    const firstItem = remappedItems[0];
    const lastItem = remappedItems[remappedItems.length - 1];

    const firstLeaf = firstItem?.kind === "leaf" ? firstItem : null;
    const lastLeaf = lastItem?.kind === "leaf" ? lastItem : null;

    // Middle items = everything between the first and last item (exclusive).
    // If first or last is a leaf, it's consumed by prefix/suffix merge and excluded from middle.
    const middleStart = firstLeaf !== null ? 1 : 0;
    const middleEnd = lastLeaf !== null ? remappedItems.length - 1 : remappedItems.length;
    const middleItems = remappedItems.slice(middleStart, middleEnd);

    // Plan prefix merge: append firstLeaf.items to end of prefix block.
    const [prefixItems, suffixItems] = splitInlineContentAtOffset(caretBlock.inlineContent, caretOffset);
    const prefixLength = prefixItems.reduce(
      (s, it) => s + (it.kind === "text" ? it.text.length : 1),
      0,
    );
    const prefixMergePlan =
      firstLeaf !== null
        ? planInsertItemsSplitInPlace(caretBlockId, "block", prefixItems, prefixLength, firstLeaf.items)
        : null;

    // Plan suffix prepend: prepend lastLeaf.items at offset 0 of suffix block.
    const suffixPrependPlan =
      lastLeaf !== null
        ? planInsertItemsSplitInPlace(suffixBlockId, "block", suffixItems, 0, lastLeaf.items)
        : null;

    // Build the ordered list of "middle" items in document order: containers and
    // leaves interleaved, allocating a fresh id for each leaf as it is encountered
    // (the allocator is bumped once per leaf, in order — `map` is in-order). We
    // splice them all between prefix and suffix in one transaction below.
    type MiddleEntry =
      | { readonly kind: "container"; readonly cloned: ClonedSubtree }
      | { readonly kind: "leaf"; readonly id: BlockId; readonly type: string; readonly attrs: Record<string, unknown>; readonly items: ReadonlyArray<InlineItem> };

    const orderedMiddle: MiddleEntry[] = middleItems.map((item) =>
      item.kind === "container"
        ? { kind: "container", cloned: item.cloned }
        : { kind: "leaf", id: allocator.allocate(), type: item.type, attrs: item.attrs, items: item.items },
    );

    const lastInsertedLength =
      lastLeaf !== null
        ? lastLeaf.items.reduce((s, it) => s + (it.kind === "text" ? it.text.length : 1), 0)
        : 0;

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
      // (a) Split the caret block → prefix + suffix.
      splitBlockAtPositionInTx(doc, splitPlan);
      // (b) Merge firstLeaf into prefix (if first item is a leaf).
      if (prefixMergePlan !== null) {
        insertItemsInTx(doc, prefixMergePlan);
      }
      // (c) Insert middle items (containers + middle leaves) between prefix and suffix.
      // Single contiguous splice: materialize all container subtrees and standalone
      // leaf blocks into blocksMap, then relink the whole run's sibling chain
      // (prefix → [middle roots] → suffix) in one pass.
      if (orderedMiddle.length > 0) {
        // First, materialize all containers' blocks into blocksMap.
        const blocksMap = getBlocksMap(doc);
        for (const entry of orderedMiddle) {
          if (entry.kind === "container") {
            // Materialize the container subtree (all blocks: root + descendants).
            for (const [id, block] of entry.cloned.blocks) {
              blocksMap.set(
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
          } else {
            // Materialize the leaf block.
            blocksMap.set(
              entry.id,
              buildYBlock({
                type: entry.type,
                attrs: entry.attrs,
                parentId: caretParentId, // placeholder; overwritten in relink
                prevSiblingId: null,     // placeholder; overwritten in relink
                nextSiblingId: null,     // placeholder; overwritten in relink
                firstChildId: null,
                lastChildId: null,
                inlineContent: { items: [...entry.items] },
              }),
            );
          }
        }
        // Collect the root ids of all middle entries in order.
        const middleRoots: BlockId[] = orderedMiddle.map((e) =>
          e.kind === "container" ? e.cloned.rootId : e.id,
        );
        // Relink the run: afterBlock → middleRoots[0] → ... → middleRoots[n-1] → suffixBlock
        const firstRoot = middleRoots[0];
        const lastRoot = middleRoots[middleRoots.length - 1];
        if (firstRoot === undefined || lastRoot === undefined) {
          throw new Error("insertFragment: orderedMiddle produced no roots");
        }
        // afterBlock (prefix = caretBlockId) → first middle root.
        getYBlock(doc, caretBlockId, "insertFragment").set("nextSiblingId", firstRoot);
        // Set parentId, prevSiblingId, nextSiblingId for each root.
        for (let i = 0; i < middleRoots.length; i++) {
          const rootId = middleRoots[i];
          if (rootId === undefined) continue;
          const prevId = i === 0 ? caretBlockId : (middleRoots[i - 1] ?? null);
          const nextId = i === middleRoots.length - 1 ? suffixBlockId : (middleRoots[i + 1] ?? null);
          const yRoot = getYBlock(doc, rootId, "insertFragment");
          yRoot.set("parentId", caretParentId);
          yRoot.set("prevSiblingId", prevId);
          yRoot.set("nextSiblingId", nextId);
        }
        // suffixBlock.prevSiblingId → last middle root.
        getYBlock(doc, suffixBlockId, "insertFragment").set("prevSiblingId", lastRoot);
      }
      // (d) Prepend lastLeaf to suffix (if last item is a leaf).
      if (suffixPrependPlan !== null) {
        insertItemsInTx(doc, suffixPrependPlan);
      }
    });

    currentState = result.state;
    for (const id of result.dirtyIds) accumulatedDirtyIds.add(id);

    // endPosition: if last item was a leaf, offset = lastInsertedLength (into suffix).
    // If last item was a container, offset = 0 (suffix is unchanged, caret at start).
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
