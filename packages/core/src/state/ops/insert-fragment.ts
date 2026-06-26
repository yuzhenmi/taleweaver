import type * as Y from "yjs";
import type { State, OperationResult } from "../state";
import { applyOperation, getBlock, resolveBlock } from "../state";
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
import { getBlocksMap, getEmbedContentsMap, getYBlock, type BlockTreeKind } from "../yjs-doc";
import { buildYBlock, buildYAttrs } from "../y-block";
import { ancestorChain } from "../block-traversal";
import { FOOTNOTE_ANCHOR_EMBED_TYPE } from "./insert-footnote";

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
function transferSuggestionRecords(_fragmentState: State, _destDoc: Y.Doc): void {
  // no-op — will be implemented in T7
}

// ─────────────────────────────────────────────────────────────────────────────
// T6 edge-case helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * T6/E1: Check if `blockId` lives inside a table-cell by walking the
 * ancestor chain. Returns true when any ancestor has type "table-cell".
 */
function isInsideTableCell(state: State, blockId: BlockId): boolean {
  const chain = ancestorChain(state, blockId);
  return chain.some((id) => {
    const b = resolveBlock(state, id)?.block;
    return b !== undefined && b.type === "table-cell";
  });
}

/**
 * T6/E1: Walk a cloned table subtree and collect all LEAF blocks (paragraphs
 * and other inline-content blocks) from every cell as TopLevelItem leaves.
 * Used to flatten a pasted table when the destination caret is inside a cell.
 */
function flattenClonedTableToLeaves(
  cloned: ClonedSubtree,
): Array<{ kind: "leaf"; type: string; attrs: Record<string, unknown>; items: ReadonlyArray<InlineItem> }> {
  const result: Array<{ kind: "leaf"; type: string; attrs: Record<string, unknown>; items: ReadonlyArray<InlineItem> }> = [];
  // Walk: table → rows → cells → leaf-children (paragraphs etc.)
  const tableRoot = cloned.blocks.get(cloned.rootId);
  if (tableRoot === undefined) return result;

  function visitChildren(parentId: BlockId): void {
    let childId: BlockId | null | undefined = undefined;
    // Find first child by scanning blocks for blocks whose parentId = parentId
    // Since cloned.blocks is flat, we need to walk via firstChildId chain.
    const parent = cloned.blocks.get(parentId);
    if (parent === undefined) return;
    childId = parent.firstChildId;
    while (childId !== null && childId !== undefined) {
      const block = cloned.blocks.get(childId);
      if (block === undefined) break;
      if (block.inlineContent !== null && block.firstChildId === null) {
        // Leaf block
        result.push({
          kind: "leaf",
          type: block.type,
          attrs: { ...block.attrs },
          items: block.inlineContent.items,
        });
      } else if (block.firstChildId !== null) {
        // Container: recurse
        visitChildren(childId);
      }
      childId = block.nextSiblingId;
    }
  }
  visitChildren(cloned.rootId);
  return result;
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
  // Use resolveBlock so embedContent caret positions (e.g. footnote body) work.
  const caretResolvedForSplice = resolveBlock(currentState, caretBlockId);
  if (caretResolvedForSplice === null) {
    throw new Error(`insertFragment: caret block "${caretBlockId}" not found`);
  }
  const caretBlock = caretResolvedForSplice.block;
  // The tree kind for this caret block — determines which Y.Map to write to.
  const caretBlockKind: BlockTreeKind = caretResolvedForSplice.kind;
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
  let remappedItems: TopLevelItem[] = topLevelItems.map((item) => {
    if (item.kind === "leaf") {
      return { ...item, attrs: remapLeafAttrs(item.attrs) };
    }
    return item;
  });

  // ── T6 edge-case transforms (applied in order before splice) ──────────────

  // E1: table-into-cell flatten.
  // If the caret is inside a table-cell, replace any cloned table containers with
  // their cell leaf paragraphs (no nested tables).
  if (isInsideTableCell(currentState, caretPos.blockId)) {
    const flattenedItems: TopLevelItem[] = [];
    for (const item of remappedItems) {
      if (item.kind === "container" && (() => {
        const rootBlock = item.cloned.blocks.get(item.cloned.rootId);
        return rootBlock !== undefined && rootBlock.type === "table";
      })()) {
        // Flatten the table: extract all leaf blocks from its cells.
        const leaves = flattenClonedTableToLeaves(item.cloned);
        flattenedItems.push(...leaves);
      } else {
        flattenedItems.push(item);
      }
    }
    remappedItems = flattenedItems;
  }

  // E2: list-level rebasing.
  // Find the minimum listLevel across all leaf list-items in the fragment.
  // Subtract minLevel from each, then add the target block's listLevel (if in a list).
  {
    const caretBlockForRebase = resolveBlock(currentState, caretPos.blockId)?.block ?? null;
    const targetLevel: number =
      caretBlockForRebase?.type === "list-item"
        ? (typeof caretBlockForRebase.attrs["listLevel"] === "number"
          ? caretBlockForRebase.attrs["listLevel"]
          : 0)
        : 0;

    // Collect all list-item leaf levels to find min.
    let minLevel: number | null = null;
    for (const item of remappedItems) {
      if (item.kind === "leaf" && item.type === "list-item") {
        const level = typeof item.attrs["listLevel"] === "number" ? item.attrs["listLevel"] : 0;
        if (minLevel === null || level < minLevel) minLevel = level;
      }
    }

    if (minLevel !== null) {
      const shift = targetLevel - minLevel;
      if (shift !== 0) {
        remappedItems = remappedItems.map((item) => {
          if (item.kind === "leaf" && item.type === "list-item") {
            const oldLevel = typeof item.attrs["listLevel"] === "number" ? item.attrs["listLevel"] : 0;
            return { ...item, attrs: { ...item.attrs, listLevel: oldLevel + shift } };
          }
          return item;
        });
      }
    }
  }

  // E3: trim leading/trailing empty leaf blocks.
  // If there are >1 items, drop an empty-inlineContent leaf at the start and/or end.
  if (remappedItems.length > 1) {
    const firstItem = remappedItems[0];
    if (firstItem?.kind === "leaf" && firstItem.items.length === 0) {
      remappedItems = remappedItems.slice(1);
    }
  }
  if (remappedItems.length > 1) {
    const lastItem = remappedItems[remappedItems.length - 1];
    if (lastItem?.kind === "leaf" && lastItem.items.length === 0) {
      remappedItems = remappedItems.slice(0, -1);
    }
  }

  // E6: footnote-in-footnote stripping.
  // If the caret is inside an embed-content (e.g. a footnote body), strip
  // footnote-anchor embeds from any leaf items' inline content.
  const caretResolvedBlock = resolveBlock(currentState, caretPos.blockId);
  if (caretResolvedBlock?.kind === "embedContent") {
    remappedItems = remappedItems.map((item) => {
      if (item.kind !== "leaf") return item;
      const filteredItems = item.items.filter(
        (it) => !(it.kind === "embed" && it.embedType === FOOTNOTE_ANCHOR_EMBED_TYPE),
      );
      if (filteredItems.length === item.items.length) return item;
      return { ...item, items: filteredItems };
    });
  }

  let endPosition: Position;

  // E4: empty target adopt — if the caret block is empty at offset 0 AND the first
  // top-level item is a leaf, adopt the leaf's type and attrs for the caret block.
  // This is done before the splice arms so both single-leaf and multi-item benefit.
  const caretContentIsEmpty = caretBlock.inlineContent.items.length === 0;
  const firstRemappedItem = remappedItems[0];
  const shouldAdoptType =
    caretContentIsEmpty &&
    caretOffset === 0 &&
    firstRemappedItem?.kind === "leaf";

  // ── Single leaf: inline-merge items at caret offset ──────────────────────
  if (remappedItems.length === 1 && remappedItems[0]?.kind === "leaf") {
    const leaf = remappedItems[0];
    const leafItems = leaf.items;
    const liveItems = caretBlock.inlineContent.items;

    const insertPlan = planInsertItemsSplitInPlace(
      caretBlockId,
      caretBlockKind,
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
      // E4: adopt type+attrs of the single leaf if caret block was empty at 0.
      if (shouldAdoptType) {
        const yCaretBlock = getYBlock(doc, caretBlockId, "insertFragment:adoptType", caretBlockKind);
        yCaretBlock.set("type", leaf.type);
        yCaretBlock.set("attrs", buildYAttrs(leaf.attrs));
      }
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
    //
    // E5: skip-split optimization — when offset=0 with no firstLeaf, the split
    // would produce an empty prefix block. Avoid by treating caretBlock as the suffix
    // and inserting middle items before it. Symmetric for offset=len with no lastLeaf.

    const caretParentId = caretBlock.parentId;
    if (caretParentId === null) {
      throw new Error("insertFragment: caret block has no parent (root)");
    }

    // Identify first and last leaf for prefix/suffix merge.
    const firstItem = remappedItems[0];
    const lastItem = remappedItems[remappedItems.length - 1];

    const firstLeaf = firstItem?.kind === "leaf" ? firstItem : null;
    const lastLeaf = lastItem?.kind === "leaf" ? lastItem : null;

    // E5: detect skip-split conditions.
    const totalContentLen = caretBlock.inlineContent.items.reduce(
      (s, it) => s + (it.kind === "text" ? it.text.length : 1),
      0,
    );
    // Skip split at start when caret is at offset 0 AND no firstLeaf would fill the empty prefix.
    const skipSplitAtStart = caretOffset === 0 && firstLeaf === null;
    // Skip split at end when caret is at end AND no lastLeaf would fill the empty suffix.
    const skipSplitAtEnd = caretOffset === totalContentLen && lastLeaf === null;
    const skipSplit = skipSplitAtStart || skipSplitAtEnd;

    // Middle items = everything between the first and last item (exclusive).
    // If first or last is a leaf, it's consumed by prefix/suffix merge and excluded from middle.
    const middleStart = firstLeaf !== null ? 1 : 0;
    const middleEnd = lastLeaf !== null ? remappedItems.length - 1 : remappedItems.length;
    const middleItems = remappedItems.slice(middleStart, middleEnd);

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

    // ── Split-based path (normal case) ───────────────────────────────────────
    if (!skipSplit) {
      const splitPlan = planSplitBlockAtPosition(currentState, caretPos, allocator);
      const suffixBlockId = splitPlan.newBlockId;

      // Plan prefix merge: append firstLeaf.items to end of prefix block.
      const [prefixItems, suffixItems] = splitInlineContentAtOffset(caretBlock.inlineContent, caretOffset);
      const prefixLength = prefixItems.reduce(
        (s, it) => s + (it.kind === "text" ? it.text.length : 1),
        0,
      );
      const prefixMergePlan =
        firstLeaf !== null
          ? planInsertItemsSplitInPlace(caretBlockId, caretBlockKind, prefixItems, prefixLength, firstLeaf.items)
          : null;

      // Plan suffix prepend: prepend lastLeaf.items at offset 0 of suffix block.
      // The suffix block was just created by splitBlockAtPositionInTx in the same
      // tree as the caret block, so it uses the same kind.
      const suffixPrependPlan =
        lastLeaf !== null
          ? planInsertItemsSplitInPlace(suffixBlockId, caretBlockKind, suffixItems, 0, lastLeaf.items)
          : null;

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
    } else {
      // ── Skip-split path (E5): offset at boundary with no leaf to fill empty side ──
      //
      // skipSplitAtStart: caretBlock becomes the "suffix" — items are inserted before it.
      //   Any lastLeaf is prepended to caretBlock at offset 0.
      // skipSplitAtEnd: caretBlock is the "prefix" — items are inserted after it.
      //   Any firstLeaf is appended to caretBlock at its current end.
      //
      // In both cases the caretBlock stays in place; we just splice middle items
      // on the appropriate side and optionally merge the one boundary leaf.

      // For skipSplitAtStart: the "before anchor" is caretBlock.prevSiblingId.
      // For skipSplitAtEnd: the "before anchor" is caretBlock itself.
      const anchorBlockId: BlockId | null = skipSplitAtStart ? caretBlock.prevSiblingId : caretBlockId;
      // The block that immediately follows the inserted run:
      const afterRunBlockId: BlockId | null = skipSplitAtStart ? caretBlockId : caretBlock.nextSiblingId;

      // Plan leaf merge if needed.
      // skipSplitAtStart: lastLeaf prepends to caretBlock at offset 0 (caretBlock = suffix).
      // skipSplitAtEnd: firstLeaf appends to caretBlock at end (caretBlock = prefix).
      const [prefixItems] = splitInlineContentAtOffset(caretBlock.inlineContent, caretOffset);
      const prefixLength = prefixItems.reduce(
        (s, it) => s + (it.kind === "text" ? it.text.length : 1),
        0,
      );
      const leafMergePlan = skipSplitAtStart && lastLeaf !== null
        ? planInsertItemsSplitInPlace(caretBlockId, caretBlockKind, caretBlock.inlineContent.items, 0, lastLeaf.items)
        : skipSplitAtEnd && firstLeaf !== null
          ? planInsertItemsSplitInPlace(caretBlockId, caretBlockKind, caretBlock.inlineContent.items, prefixLength, firstLeaf.items)
          : null;

      const lastInsertedLength =
        skipSplitAtStart && lastLeaf !== null
          ? lastLeaf.items.reduce((s, it) => s + (it.kind === "text" ? it.text.length : 1), 0)
          : skipSplitAtEnd && firstLeaf !== null
            ? firstLeaf.items.reduce((s, it) => s + (it.kind === "text" ? it.text.length : 1), 0)
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

        // Insert middle items.
        if (orderedMiddle.length > 0) {
          const blocksMap = getBlocksMap(doc);
          for (const entry of orderedMiddle) {
            if (entry.kind === "container") {
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
              blocksMap.set(
                entry.id,
                buildYBlock({
                  type: entry.type,
                  attrs: entry.attrs,
                  parentId: caretParentId,
                  prevSiblingId: null,
                  nextSiblingId: null,
                  firstChildId: null,
                  lastChildId: null,
                  inlineContent: { items: [...entry.items] },
                }),
              );
            }
          }
          const middleRoots: BlockId[] = orderedMiddle.map((e) =>
            e.kind === "container" ? e.cloned.rootId : e.id,
          );
          const firstRoot = middleRoots[0];
          const lastRoot = middleRoots[middleRoots.length - 1];
          if (firstRoot === undefined || lastRoot === undefined) {
            throw new Error("insertFragment(skip-split): orderedMiddle produced no roots");
          }
          // Wire: anchorBlock ↔ firstRoot ↔ … ↔ lastRoot ↔ afterRunBlock
          if (anchorBlockId !== null) {
            getYBlock(doc, anchorBlockId, "insertFragment").set("nextSiblingId", firstRoot);
          } else {
            // Middle items start at beginning of parent's children — update parent.firstChildId.
            getYBlock(doc, caretParentId, "insertFragment").set("firstChildId", firstRoot);
          }
          for (let i = 0; i < middleRoots.length; i++) {
            const rootId = middleRoots[i];
            if (rootId === undefined) continue;
            const prevId = i === 0 ? anchorBlockId : (middleRoots[i - 1] ?? null);
            const nextId = i === middleRoots.length - 1 ? afterRunBlockId : (middleRoots[i + 1] ?? null);
            const yRoot = getYBlock(doc, rootId, "insertFragment");
            yRoot.set("parentId", caretParentId);
            yRoot.set("prevSiblingId", prevId);
            yRoot.set("nextSiblingId", nextId);
          }
          if (afterRunBlockId !== null) {
            getYBlock(doc, afterRunBlockId, "insertFragment").set("prevSiblingId", lastRoot);
          } else {
            // Middle items go at end of parent's children — update parent.lastChildId.
            getYBlock(doc, caretParentId, "insertFragment").set("lastChildId", lastRoot);
          }
        }

        // Merge boundary leaf (lastLeaf into caretBlock start, or firstLeaf into caretBlock end).
        if (leafMergePlan !== null) {
          insertItemsInTx(doc, leafMergePlan);
        }
      });

      currentState = result.state;
      for (const id of result.dirtyIds) accumulatedDirtyIds.add(id);

      if (skipSplitAtStart) {
        // Caret lands at start of caretBlock after any lastLeaf prepend.
        endPosition = createPosition(caretBlockId, lastInsertedLength);
      } else {
        // skipSplitAtEnd: caret lands after firstLeaf append in caretBlock.
        endPosition = createPosition(caretBlockId, prefixLength + lastInsertedLength);
      }
    }
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
