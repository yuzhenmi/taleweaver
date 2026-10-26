import type { State } from "../state";
import { getEmbedContent, resolveBlock, blockCount } from "../state";
import type { BlockId, IdAllocator } from "../block-id";
import { productionAllocator } from "../block-id";
import type { Span } from "../block-position";
import type { Block } from "../block";
import type { InlineItem, InlineContent } from "../inline-content";
import { splitInlineContentAtOffset, inlineContentLength } from "../inline-content";
import { normalizeSpan } from "../span-iteration";
import { selectionContextOf } from "../block-compare";
import { ancestorChain } from "../block-traversal";
import { clonePastedSubtree } from "../clone-pasted-subtree";
import { buildStateFromBlocks } from "../build-state-from-blocks";
import { COMMENT_START_EMBED_TYPE, COMMENT_END_EMBED_TYPE } from "../comments";
import {
  readSuggestionRecordFromState,
  type SuggestionRecord,
} from "../suggestions";
import { suggestionIdsOnItem } from "./suggestion-ops";
import { getListDefsForState, type ListDef } from "../list-defs";

/**
 * Extract the content covered by `span` from `state` into a self-contained
 * fragment `State`. The fragment's root is a fresh `document` block. The
 * fragment is the interchange currency for copy-paste: it feeds `encodeHtml`
 * (HTML flavor) and the lossless binary serializer (T4).
 *
 * **Walk strategy:** a document-order sibling walk over the span's SELECTION
 * CONTEXT ROOT (the root of the tree the span lives in — the document body, or
 * one footnote/header body). For each top-level subtree under that root,
 * classify it against the span:
 *  - fully contained  → `clonePastedSubtree` (drops comments, brings footnotes)
 *  - partial leaf     → `splitInlineContentAtOffset` to trim; drops comment markers
 *  - partial container → recurse into its children
 *
 * Starting from the CONTEXT ROOT (not the endpoints' LCA) is what lets a
 * fully-covered top-level container be cloned whole: a table whose only cell
 * paragraph is fully selected has endpoints whose LCA is that paragraph, but
 * the TABLE is the top-level subtree that is fully covered.
 *
 * **Cross-cell same-table spans** (no whole-cell grid-selection model exists —
 * deferred, see `packages/print/src/cursor/selection-geometry.test.ts:1025`)
 * extract the spanned LEAF content LINEARLY (the spanned paragraphs become
 * top-level fragment blocks), consistent with `extractText` / plain-copy. The
 * recursion naturally flattens such a span to its spanned leaves. Structural
 * sub-table (cell-range) extraction is explicitly deferred to that unbuilt
 * cell-grid-selection feature.
 *
 * **CRITICAL:** does NOT use `iterateSpan` / `iterateLeafBlocksInDocumentOrder`
 * as the walk skeleton (they skip / throw on container blocks — table structure
 * would be destroyed). The walk is a direct sibling chain from the context root.
 *
 * @throws if the span crosses selection contexts (header→body etc.).
 */
export function extractFragment(state: State, span: Span): State {
  return extractFragmentWithAllocator(state, span, productionAllocator);
}

/**
 * `extractFragment` seam that accepts an explicit allocator (a deterministic
 * counter-based allocator in tests). NON-exported — the only public entry
 * point is `extractFragment(state, span)`; tests that need a deterministic
 * allocator import this directly from `./extract-fragment`, never via the
 * `state/` barrel (the plan specifies only `extractFragment` on the surface).
 */
function extractFragmentWithAllocator(
  state: State,
  span: Span,
  alloc: IdAllocator,
): State {
  // 1. Normalize span to document order.
  const normalized = normalizeSpan(state, span);
  const startPos = normalized.anchor;
  const endPos = normalized.focus;

  // 2. Assert single selection context, and capture the context root — the
  //    block whose children we walk in document order.
  const startCtx = selectionContextOf(state, startPos.blockId);
  const endCtx = selectionContextOf(state, endPos.blockId);
  if (startCtx === null || endCtx === null || startCtx !== endCtx) {
    throw new Error(
      `extractFragment: cross-context span (start context "${startCtx}" vs end context "${endCtx}")`,
    );
  }

  // 3. Walk the context root's children in document order and collect top-level
  //    entries. Each entry is either a cloned subtree (from clonePastedSubtree)
  //    or a partial leaf (trimmed inline content + new BlockId).
  const topLevelEntries: TopLevelEntry[] = [];
  const allEmbedContents: Block[] = [];
  const listDefs: Record<string, ListDef> = {};
  const seenSuggestionIds = new Set<string>();
  const suggestionRecords: SuggestionRecord[] = [];

  collectFromAncestor(
    state,
    startCtx,
    startPos.blockId,
    startPos.offset,
    endPos.blockId,
    endPos.offset,
    alloc,
    topLevelEntries,
    allEmbedContents,
    listDefs,
    seenSuggestionIds,
    suggestionRecords,
  );

  // 5. Assemble the flat Block[] with correct parent/sibling pointers.
  const rootId = alloc.allocate();
  const allBlocks: Block[] = [buildDocumentRoot(rootId, topLevelEntries)];

  for (let i = 0; i < topLevelEntries.length; i++) {
    const entry = topLevelEntries[i];
    if (entry === undefined) continue; // defensive — array is in-bounds
    const prevEntry = i > 0 ? topLevelEntries[i - 1] : undefined;
    const nextEntry = i < topLevelEntries.length - 1 ? topLevelEntries[i + 1] : undefined;
    const prevId: BlockId | null = prevEntry !== undefined ? prevEntry.rootId : null;
    const nextId: BlockId | null = nextEntry !== undefined ? nextEntry.rootId : null;

    if (entry.kind === "partial") {
      // Rewrite parentId/prevSiblingId/nextSiblingId on the partial leaf.
      allBlocks.push(
        Object.freeze({
          ...entry.block,
          parentId: rootId,
          prevSiblingId: prevId,
          nextSiblingId: nextId,
        }),
      );
    } else {
      // Clone: the root gets new parent/sibling pointers; internals keep theirs.
      let rootWritten = false;
      for (const block of entry.blocks.values()) {
        if (block.id === entry.rootId) {
          allBlocks.push(
            Object.freeze({
              ...block,
              parentId: rootId,
              prevSiblingId: prevId,
              nextSiblingId: nextId,
            }),
          );
          rootWritten = true;
        } else {
          allBlocks.push(block);
        }
      }
      if (!rootWritten) {
        throw new Error(
          `extractFragment: cloned subtree root "${entry.rootId}" not found in blocks map`,
        );
      }
    }
  }

  // 6. Build and return the fragment State.
  return buildStateFromBlocks({
    rootId,
    blocks: allBlocks,
    embedContents: allEmbedContents,
    listDefs,
    suggestions: suggestionRecords,
  });
}

// ─── Internal types ───────────────────────────────────────────────────────────

/** A single top-level entry in the collected fragment. */
type TopLevelEntry =
  | {
      readonly kind: "partial";
      /** The new BlockId allocated for this partial leaf. */
      readonly rootId: BlockId;
      readonly block: Block;
    }
  | {
      readonly kind: "clone";
      /** The cloned root BlockId (from clonePastedSubtree). */
      readonly rootId: BlockId;
      /** All cloned blocks (root + descendants). */
      readonly blocks: ReadonlyMap<BlockId, Block>;
    };

// ─── Walk logic ──────────────────────────────────────────────────────────────

/**
 * Recursively collect top-level entries from the children of `ancestorId`
 * (the context root on the first call; a partially-covered container on
 * recursion). The span runs from (startBlockId, startOffset) to
 * (endBlockId, endOffset). Results are appended to the collection arrays.
 */
function collectFromAncestor(
  state: State,
  ancestorId: BlockId,
  startBlockId: BlockId,
  startOffset: number,
  endBlockId: BlockId,
  endOffset: number,
  alloc: IdAllocator,
  topLevelEntries: TopLevelEntry[],
  allEmbedContents: Block[],
  listDefs: Record<string, ListDef>,
  seenSuggestionIds: Set<string>,
  suggestionRecords: SuggestionRecord[],
): void {
  const ancestor = requireBlock(state, ancestorId);

  // Leaf ancestor: a partial-container recursion can resolve to a single leaf
  // (e.g. a cross-cell span whose innerLca on one side is the spanned cell's
  // sole paragraph). Walking its (empty) children would drop it, so extract its
  // [startOffset, endOffset) slice directly. The endpoints both name this leaf
  // when it is the recursion target (start side: start..end-of-leaf;
  // end side: 0..end — the caller passes the right offsets).
  if (ancestor.firstChildId === null) {
    if (ancestor.inlineContent !== null) {
      const sliceStart = startBlockId === ancestorId ? startOffset : 0;
      const sliceEnd = endBlockId === ancestorId
        ? endOffset
        : inlineContentLength(ancestor.inlineContent);
      const items = sliceInlineContent(ancestor.inlineContent, sliceStart, sliceEnd);
      collectSuggestionsFromItems(items, state, seenSuggestionIds, suggestionRecords);
      collectEmbedContentsFromItems(items, state, allEmbedContents);
      collectListDefsFromBlock(ancestor, state, listDefs);
      const newId = alloc.allocate();
      topLevelEntries.push({ kind: "partial", rootId: newId, block: buildPartialLeaf(newId, ancestor, items) });
    }
    return;
  }

  let cur: BlockId | null = ancestor.firstChildId;
  while (cur !== null) {
    const child = requireBlock(state, cur);

    const childContainsStart = subtreeContainsBlock(state, cur, startBlockId);
    const childContainsEnd = subtreeContainsBlock(state, cur, endBlockId);

    if (childContainsStart && childContainsEnd) {
      // Both endpoints inside this child's subtree.
      if (child.firstChildId === null) {
        // Leaf: trim both ends.
        if (child.inlineContent !== null) {
          // Check if the leaf is fully covered (no trimming needed) → could
          // still be a partial clone, but since it's a leaf, we always trim.
          const items = sliceInlineContent(child.inlineContent, startOffset, endOffset);
          collectSuggestionsFromItems(items, state, seenSuggestionIds, suggestionRecords);
          collectEmbedContentsFromItems(items, state, allEmbedContents);
          collectListDefsFromBlock(child, state, listDefs);
          const newId = alloc.allocate();
          topLevelEntries.push({ kind: "partial", rootId: newId, block: buildPartialLeaf(newId, child, items) });
        }
      } else {
        // Container: check if it is fully covered (selection covers the whole
        // container from first leaf offset 0 to last leaf end). If so, clone it
        // whole. Otherwise recurse to extract the partially-covered sub-range.
        if (isContainerFullyCovered(state, cur, startBlockId, startOffset, endBlockId, endOffset)) {
          // Clone the whole subtree.
          cloneSubtreeInto(state, cur, alloc, topLevelEntries, allEmbedContents, seenSuggestionIds, suggestionRecords, listDefs);
        } else {
          // Container partially covered: recurse into it.
          collectFromAncestor(
            state,
            cur,
            startBlockId,
            startOffset,
            endBlockId,
            endOffset,
            alloc,
            topLevelEntries,
            allEmbedContents,
            listDefs,
            seenSuggestionIds,
            suggestionRecords,
          );
        }
      }
    } else if (childContainsStart) {
      // Span starts inside this child, exits through right side.
      if (child.firstChildId === null) {
        // Leaf: trim start, take to end of block.
        if (child.inlineContent !== null) {
          const endOfBlock = inlineContentLength(child.inlineContent);
          const items = sliceInlineContent(child.inlineContent, startOffset, endOfBlock);
          collectSuggestionsFromItems(items, state, seenSuggestionIds, suggestionRecords);
          collectEmbedContentsFromItems(items, state, allEmbedContents);
          collectListDefsFromBlock(child, state, listDefs);
          const newId = alloc.allocate();
          topLevelEntries.push({ kind: "partial", rootId: newId, block: buildPartialLeaf(newId, child, items) });
        }
      } else {
        // Partially-overlapped container: span starts inside, exits right.
        // Recurse with (startBlockId, startOffset) to (last leaf, end-of-leaf).
        const lastLeafId = findLastLeaf(state, cur);
        if (lastLeafId !== null) {
          const lastLeaf = requireBlock(state, lastLeafId);
          const lastLeafLen = lastLeaf.inlineContent !== null
            ? inlineContentLength(lastLeaf.inlineContent)
            : 0;
          const innerLca = findLca(state, startBlockId, lastLeafId);
          if (innerLca !== null) {
            collectFromAncestor(
              state,
              innerLca,
              startBlockId,
              startOffset,
              lastLeafId,
              lastLeafLen,
              alloc,
              topLevelEntries,
              allEmbedContents,
              listDefs,
              seenSuggestionIds,
              suggestionRecords,
            );
          }
        }
      }
    } else if (childContainsEnd) {
      // Span ends inside this child, started before it.
      if (child.firstChildId === null) {
        // Leaf: trim end, take from start of block.
        if (child.inlineContent !== null) {
          const items = sliceInlineContent(child.inlineContent, 0, endOffset);
          collectSuggestionsFromItems(items, state, seenSuggestionIds, suggestionRecords);
          collectEmbedContentsFromItems(items, state, allEmbedContents);
          collectListDefsFromBlock(child, state, listDefs);
          const newId = alloc.allocate();
          topLevelEntries.push({ kind: "partial", rootId: newId, block: buildPartialLeaf(newId, child, items) });
        }
      } else {
        // Partially-overlapped container: span enters from left, ends inside.
        const firstLeafId = findFirstLeaf(state, cur);
        if (firstLeafId !== null) {
          const innerLca = findLca(state, firstLeafId, endBlockId);
          if (innerLca !== null) {
            collectFromAncestor(
              state,
              innerLca,
              firstLeafId,
              0,
              endBlockId,
              endOffset,
              alloc,
              topLevelEntries,
              allEmbedContents,
              listDefs,
              seenSuggestionIds,
              suggestionRecords,
            );
          }
        }
      }
    } else {
      // This child subtree does not contain either endpoint: it must be fully
      // inside the span (between startBlock and endBlock), or fully outside.
      //
      // Determine position relative to span by checking document order:
      //  - If this child is a strict descendant/ancestor of start/end endpoints
      //    → the childContainsStart/End branches above would have caught it.
      //  - Since neither endpoint is in this subtree, it's either before start
      //    or after end, or fully between them.
      //
      // We check: is startBlock in a subtree that comes before cur? And is
      // endBlock in a subtree that comes after cur?
      // If yes to both → cur is between start and end → fully inside → clone.
      // Otherwise → outside span → skip.

      const startAncestors = new Set(ancestorChain(state, startBlockId));
      const endAncestors = new Set(ancestorChain(state, endBlockId));

      // Find the LCA's child that contains startBlock.
      const startSibling = findChildOfAncestor(state, ancestorId, startBlockId, startAncestors);
      // Find the LCA's child that contains endBlock.
      const endSibling = findChildOfAncestor(state, ancestorId, endBlockId, endAncestors);

      // cur is between startSibling and endSibling if cur !== startSibling && cur !== endSibling
      // and cur comes after startSibling and before endSibling in document order.
      if (startSibling !== null && endSibling !== null && cur !== startSibling && cur !== endSibling) {
        // Verify that cur is actually between them (after start, before end).
        // We know startSibling < endSibling in doc order (span is normalized).
        // cur must be > startSibling and < endSibling.
        const afterStart = isAfterInSiblingChain(state, cur, startSibling, ancestorId);
        const beforeEnd = isBeforeInSiblingChain(state, cur, endSibling, ancestorId);
        if (afterStart && beforeEnd) {
          // Fully inside the span: clone the whole subtree.
          cloneSubtreeInto(state, cur, alloc, topLevelEntries, allEmbedContents, seenSuggestionIds, suggestionRecords, listDefs);
        }
        // else: fully outside span (before start or after end) → skip.
      }
    }

    cur = child.nextSiblingId;
  }
}

/**
 * Clone a subtree rooted at `subtreeId` and add it to the collections.
 * Used for fully-covered subtrees (containers or leaves).
 */
function cloneSubtreeInto(
  state: State,
  subtreeId: BlockId,
  alloc: IdAllocator,
  topLevelEntries: TopLevelEntry[],
  allEmbedContents: Block[],
  seenSuggestionIds: Set<string>,
  suggestionRecords: SuggestionRecord[],
  listDefs: Record<string, ListDef>,
): void {
  const cloned = clonePastedSubtree(state, subtreeId, alloc, state);
  for (const block of cloned.embedContents.values()) {
    allEmbedContents.push(block);
  }
  for (const block of cloned.blocks.values()) {
    if (block.inlineContent) {
      collectSuggestionsFromItems(
        [...block.inlineContent.items],
        state,
        seenSuggestionIds,
        suggestionRecords,
      );
    }
    collectListDefsFromBlockSnapshot(block, state, listDefs);
  }
  topLevelEntries.push({
    kind: "clone",
    rootId: cloned.rootId,
    blocks: cloned.blocks,
  });
}

// ─── Utility helpers ─────────────────────────────────────────────────────────

/**
 * True iff the span (startBlockId, startOffset) → (endBlockId, endOffset)
 * covers the entire content of the container subtree rooted at `containerId`.
 * "Entire content" means:
 *   - startBlockId is the first leaf of the container AND startOffset is 0
 *   - endBlockId is the last leaf of the container AND endOffset equals the
 *     leaf's full inline-content length
 */
function isContainerFullyCovered(
  state: State,
  containerId: BlockId,
  startBlockId: BlockId,
  startOffset: number,
  endBlockId: BlockId,
  endOffset: number,
): boolean {
  const firstLeaf = findFirstLeaf(state, containerId);
  if (firstLeaf === null) return false;
  if (firstLeaf !== startBlockId || startOffset !== 0) return false;

  const lastLeaf = findLastLeaf(state, containerId);
  if (lastLeaf === null) return false;
  if (lastLeaf !== endBlockId) return false;

  const lastLeafBlock = resolveBlock(state, lastLeaf)?.block ?? null;
  if (lastLeafBlock === null) return false;
  const lastLeafLen = lastLeafBlock.inlineContent !== null
    ? inlineContentLength(lastLeafBlock.inlineContent)
    : 0;
  return endOffset === lastLeafLen;
}

function requireBlock(state: State, id: BlockId): Block {
  const block = resolveBlock(state, id)?.block ?? null;
  if (block === null) {
    throw new Error(`extractFragment: block "${id}" not found`);
  }
  return block;
}

/**
 * Find the LCA of two blocks in any tree (main, embed, template). Returns the
 * block's own id if they are the same block. Returns null if no common ancestor.
 */
function findLca(state: State, idA: BlockId, idB: BlockId): BlockId | null {
  if (idA === idB) return idA;
  const chainA = ancestorChain(state, idA); // [idA, parent, ..., root]
  const chainB = ancestorChain(state, idB);
  if (chainA.length === 0 || chainB.length === 0) return null;
  const setA = new Set(chainA);
  for (const id of chainB) {
    if (setA.has(id)) return id;
  }
  return null;
}

/**
 * True iff the subtree rooted at `subtreeId` contains `targetId` (i.e. `targetId`
 * is an ancestor-or-self of `subtreeId`'s subtree). Uses the ancestor chain.
 */
function subtreeContainsBlock(state: State, subtreeId: BlockId, targetId: BlockId): boolean {
  if (subtreeId === targetId) return true;
  const chain = ancestorChain(state, targetId);
  return chain.includes(subtreeId);
}

/**
 * Find the direct child of `ancestorId` that is an ancestor-or-self of `targetId`.
 * Returns null if targetId is not in ancestorId's subtree.
 */
function findChildOfAncestor(
  state: State,
  ancestorId: BlockId,
  targetId: BlockId,
  targetAncestors?: Set<BlockId>,
): BlockId | null {
  const ancestors = targetAncestors ?? new Set(ancestorChain(state, targetId));
  const ancestor = requireBlock(state, ancestorId);
  let cur: BlockId | null = ancestor.firstChildId;
  while (cur !== null) {
    if (cur === targetId || ancestors.has(cur)) return cur;
    const child = resolveBlock(state, cur)?.block ?? null;
    cur = child?.nextSiblingId ?? null;
  }
  return null;
}

/**
 * True iff `curId` appears strictly AFTER `referenceId` in the sibling chain
 * under `parentId`. Both must be direct children of `parentId`.
 */
function isAfterInSiblingChain(
  state: State,
  curId: BlockId,
  referenceId: BlockId,
  parentId: BlockId,
): boolean {
  const parent = requireBlock(state, parentId);
  let found = false;
  let sib: BlockId | null = parent.firstChildId;
  while (sib !== null) {
    if (sib === referenceId) found = true;
    if (sib === curId) return found && sib !== referenceId;
    const block = resolveBlock(state, sib)?.block ?? null;
    sib = block?.nextSiblingId ?? null;
  }
  return false;
}

/**
 * True iff `curId` appears strictly BEFORE `referenceId` in the sibling chain
 * under `parentId`.
 */
function isBeforeInSiblingChain(
  state: State,
  curId: BlockId,
  referenceId: BlockId,
  parentId: BlockId,
): boolean {
  const parent = requireBlock(state, parentId);
  let sib: BlockId | null = parent.firstChildId;
  while (sib !== null) {
    if (sib === curId) return true;
    if (sib === referenceId) return false;
    const block = resolveBlock(state, sib)?.block ?? null;
    sib = block?.nextSiblingId ?? null;
  }
  return false;
}

/**
 * Walk via firstChildId until we reach a leaf (no firstChildId).
 * Cycle-detection bound: `blockCount(state) + 1` (the all-tree count is a safe
 * upper limit on the distinct blocks a single descent can visit) — THROWS on
 * overflow, matching `selectionContextOf` / `nextBlockInDocOrder`. A silent
 * wrong-leaf return would corrupt the extracted fragment's range.
 */
function findFirstLeaf(state: State, rootId: BlockId): BlockId | null {
  const start = resolveBlock(state, rootId)?.block ?? null;
  if (start === null) return null;
  let cur: Block = start;
  const maxSteps = blockCount(state) + 1;
  let steps = 0;
  while (cur.firstChildId !== null) {
    if (++steps > maxSteps) {
      throw new Error(`extractFragment: cycle detected walking firstChild from "${rootId}" (visited >${maxSteps} blocks)`);
    }
    const firstChildId: BlockId = cur.firstChildId;
    const next = resolveBlock(state, firstChildId)?.block ?? null;
    if (next === null) return cur.id;
    cur = next;
  }
  return cur.id;
}

/**
 * Walk via lastChildId until we reach a leaf (no lastChildId → no children).
 * Same `blockCount`-bounded, throw-on-overflow cycle guard as `findFirstLeaf`.
 */
function findLastLeaf(state: State, rootId: BlockId): BlockId | null {
  const start = resolveBlock(state, rootId)?.block ?? null;
  if (start === null) return null;
  let cur: Block = start;
  const maxSteps = blockCount(state) + 1;
  let steps = 0;
  while (cur.lastChildId !== null) {
    if (++steps > maxSteps) {
      throw new Error(`extractFragment: cycle detected walking lastChild from "${rootId}" (visited >${maxSteps} blocks)`);
    }
    const lastChildId: BlockId = cur.lastChildId;
    const next = resolveBlock(state, lastChildId)?.block ?? null;
    if (next === null) return cur.id;
    cur = next;
  }
  return cur.id;
}

/**
 * Slice inline content from [start, end). Drops comment-marker embeds (M3).
 */
function sliceInlineContent(
  content: InlineContent,
  start: number,
  end: number,
): InlineItem[] {
  const [, fromStart] = splitInlineContentAtOffset(content, start);
  const trimmedContent: InlineContent = Object.freeze({ items: Object.freeze(fromStart) });
  const [slice] = splitInlineContentAtOffset(trimmedContent, end - start);
  // Drop comment-start and comment-end marker embeds (M3: partial arm).
  return slice.filter(
    (item) =>
      !(
        item.kind === "embed" &&
        (item.embedType === COMMENT_START_EMBED_TYPE ||
          item.embedType === COMMENT_END_EMBED_TYPE)
      ),
  );
}

/**
 * Build a partial leaf Block snapshot with new id and given inline items.
 * parent/prevSibling/nextSibling are null (will be set by the assembler).
 */
function buildPartialLeaf(newId: BlockId, source: Block, items: InlineItem[]): Block {
  return Object.freeze({
    id: newId,
    type: source.type,
    attrs: source.attrs,
    parentId: null,
    prevSiblingId: null,
    nextSiblingId: null,
    firstChildId: null,
    lastChildId: null,
    inlineContent: Object.freeze({ items: Object.freeze(items) }),
  });
}

/** Build the fragment's document root block. */
function buildDocumentRoot(rootId: BlockId, entries: TopLevelEntry[]): Block {
  const firstChildId = entries[0]?.rootId ?? null;
  const lastChildId = entries[entries.length - 1]?.rootId ?? null;
  return Object.freeze({
    id: rootId,
    type: "document",
    attrs: Object.freeze({}),
    parentId: null,
    prevSiblingId: null,
    nextSiblingId: null,
    firstChildId,
    lastChildId,
    inlineContent: null,
  });
}

/**
 * Collect embed content blocks referenced by any `contentBlockId` embed in items.
 * Recursively follows nested embed-content references (e.g., footnote body
 * paragraphs that themselves contain footnotes).
 */
function collectEmbedContentsFromItems(
  items: readonly InlineItem[],
  state: State,
  out: Block[],
): void {
  const visited = new Set<BlockId>();
  function visit(id: BlockId): void {
    if (visited.has(id)) return;
    visited.add(id);
    const block = getEmbedContent(state, id);
    if (block === null) return;
    out.push(block);
    // Walk children.
    let cur: BlockId | null = block.firstChildId;
    while (cur !== null) {
      visit(cur);
      const child = getEmbedContent(state, cur);
      cur = child?.nextSiblingId ?? null;
    }
    // Walk nested embed-content references.
    if (block.inlineContent) {
      for (const item of block.inlineContent.items) {
        if (item.kind === "embed") {
          const cbId = item.properties["contentBlockId"];
          if (typeof cbId === "string") visit(cbId as BlockId);
        }
      }
    }
  }

  for (const item of items) {
    if (item.kind === "embed") {
      const cbId = item.properties["contentBlockId"];
      if (typeof cbId === "string") visit(cbId as BlockId);
    }
  }
}

/**
 * Collect any referenced suggestion records from inline items. Provenance lives
 * on text-run attrs (insertion/deletion/formatting), on break-suggestion embeds
 * (`properties.suggestionId`), AND on visible field embeds (footnote-anchor /
 * cross-reference) via `FORMATTING_SUGGESTION_ATTR`. The canonical harvester
 * `suggestionIdsOnItem` (suggestion-ops) covers all three so the lossless flavor
 * never round-trips a dangling reference (a fragment carrying a suggested
 * block-split/join or a formatting-suggested anchor brings its record too).
 */
function collectSuggestionsFromItems(
  items: readonly InlineItem[],
  state: State,
  seen: Set<string>,
  out: SuggestionRecord[],
): void {
  for (const item of items) {
    for (const id of suggestionIdsOnItem(item)) {
      if (seen.has(id)) continue;
      seen.add(id);
      const record = readSuggestionRecordFromState(state, id);
      if (record !== null) out.push(record);
    }
  }
}

/** Collect the listDef for a block if it has a `listId` attr. */
function collectListDefsFromBlock(
  block: Block,
  state: State,
  out: Record<string, ListDef>,
): void {
  const listId = block.attrs["listId"];
  if (typeof listId !== "string" || listId in out) return;
  const defs = getListDefsForState(state);
  const def = defs.get(listId);
  if (def !== undefined) out[listId] = def;
}

/** Like collectListDefsFromBlock but takes a Block snapshot (already have it). */
function collectListDefsFromBlockSnapshot(
  block: Block,
  state: State,
  out: Record<string, ListDef>,
): void {
  collectListDefsFromBlock(block, state, out);
}
