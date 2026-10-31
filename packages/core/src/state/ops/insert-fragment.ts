import type * as Y from "yjs";
import type { Document, OperationResult } from "../document";
import { applyOperation, getBlock, resolveBlock } from "../document";
import type { Block } from "../block";
import type { BlockId, IdAllocator } from "../block-id";
import type { Position, Span } from "../block-position";
import { createPosition } from "../block-position";
import type { InlineItem } from "../inline-content";
import { splitInlineContentAtOffset } from "../inline-content";
import { deleteRange, deleteRangeSeam } from "./delete-range";
import {
  planSplitBlockAtPosition,
  splitBlockAtPositionInTx,
} from "./split-block";
import {
  planInsertItemsAt,
  insertItemsInTx,
} from "./insert-items";
import { clonePastedSubtree } from "../clone-pasted-subtree";
import type { ClonedSubtree } from "../clone-pasted-subtree";
import { isCrossContextSelection } from "../../editor/actions/helpers/is-cross-context-selection";
import { isCollapsed } from "../../cursor/selection";
import { getListDefsForDocument } from "../list-defs";
import { writeListDefInTx } from "../list-defs";
import { newListId } from "../block-id";
import { getSuggestionsMap, type BlockTreeKind } from "../yjs-doc";
import { insertChildren, writeRoot, writeBlockAttrs, writeBlockType, writeTypedMarkAttrs, type TreeNode } from "../flow-ops";
import type { ReadonlyAttrs } from "../attrs";
import { treesOf } from "../build-document-from-blocks";
import { ancestorChain, topLevelBlockIds } from "../block-traversal";
import { FOOTNOTE_ANCHOR_EMBED_TYPE } from "./insert-footnote";
import { DOCUMENT_INTERNAL } from "../document-internal";
import type { SuggestionId, SuggestionRecord } from "../suggestions";
import {
  newSuggestionId,
  writeSuggestionRecordInTx,
  readSuggestionRecord,
  INSERTION_SUGGESTION_ATTR,
  DELETION_SUGGESTION_ATTR,
  formattingSuggestionIds,
  formattingSuggestionKey,
} from "../suggestions";

// ─────────────────────────────────────────────────────────────────────────────
// Public type
// ─────────────────────────────────────────────────────────────────────────────

/** Result of `insertFragment`: standard OperationResult plus the caret landing position. */
export interface InsertFragmentResult extends OperationResult {
  readonly endPosition: Position;
}

// ─────────────────────────────────────────────────────────────────────────────
// Suggestion-record transfer + id remap
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a fresh-id remap for every suggestion record in `fragmentState`.
 * Returns both the old→new id map and the original records (needed for writing
 * the records into the destination under their new ids).
 *
 * Uses `newSuggestionId()` (crypto.randomUUID-based) — the same minting path
 * the suggestion subsystem uses for brand-new suggestions.
 */
function buildSuggestionIdRemap(fragmentDocument: Document): {
  idMap: ReadonlyMap<SuggestionId, SuggestionId>;
  records: SuggestionRecord[];
} {
  const doc = fragmentDocument[DOCUMENT_INTERNAL].doc;
  const suggestionsMap = getSuggestionsMap(doc);
  const idMap = new Map<SuggestionId, SuggestionId>();
  const records: SuggestionRecord[] = [];

  for (const key of suggestionsMap.keys()) {
    const oldId = key as SuggestionId;
    const record = readSuggestionRecord(doc, oldId);
    if (record === null) continue;
    const newId = newSuggestionId();
    idMap.set(oldId, newId);
    records.push(record);
  }

  return { idMap, records };
}

/**
 * Rewrite suggestion ids in an array of inline items, replacing every occurrence
 * of an old suggestion id (in text ATTRS or embed formatting tags) with the
 * corresponding new id from `idMap`. Returns a new array only when at least one
 * item changed; otherwise returns the original array (reference equality).
 *
 * Covers:
 * - text runs: INSERTION_SUGGESTION_ATTR, DELETION_SUGGESTION_ATTR, and every
 *   per-id formatting tag (re-keyed, its shadowed-key value kept)
 * - visible embeds: their formatting tags
 */
function rewriteItemSuggestionIds(
  items: ReadonlyArray<InlineItem>,
  idMap: ReadonlyMap<SuggestionId, SuggestionId>,
): ReadonlyArray<InlineItem> {
  if (idMap.size === 0) return items;

  let changed = false;
  const rewritten: InlineItem[] = items.map((item) => {
    const newAttrs = remapSuggestionAttrs(item.attrs, idMap);
    if (item.kind === "text") {
      if (newAttrs !== null) {
        changed = true;
        return { kind: "text" as const, text: item.text, attrs: newAttrs };
      }
      return item;
    }
    if (newAttrs !== null) {
      changed = true;
      item = { ...item, attrs: newAttrs };
    }
    return item;
  });

  return changed ? rewritten : items;
}

/** `attrs` with every suggestion id in `idMap` remapped, or `null` when none is. */
function remapSuggestionAttrs(
  attrs: Readonly<Record<string, unknown>>,
  idMap: ReadonlyMap<SuggestionId, SuggestionId>,
): Record<string, unknown> | null {
  let out: Record<string, unknown> | null = null;
  for (const key of [INSERTION_SUGGESTION_ATTR, DELETION_SUGGESTION_ATTR] as const) {
    const v = attrs[key];
    const newId = typeof v === "string" ? idMap.get(v as SuggestionId) : undefined;
    if (newId !== undefined) (out ??= { ...attrs })[key] = newId;
  }
  for (const id of formattingSuggestionIds(attrs)) {
    const newId = idMap.get(id);
    if (newId === undefined) continue;
    const next: Record<string, unknown> = (out ??= { ...attrs });
    const value = next[formattingSuggestionKey(id)];
    delete next[formattingSuggestionKey(id)];
    next[formattingSuggestionKey(newId)] = value;
  }
  return out;
}

/**
 * Write each fragment suggestion record into the destination document under its
 * fresh id (from `idMap`), preserving kind / author / createdAt / order / proposedAttrs /
 * metadata. A pasted copy of a suggestion GROUP becomes a NEW group (one fresh group id
 * per source group), so it is reviewed independently of the original.
 * Must be called inside an open Yjs transaction.
 */
function transferSuggestionRecords(
  records: SuggestionRecord[],
  idMap: ReadonlyMap<SuggestionId, SuggestionId>,
  destDoc: Y.Doc,
): void {
  const groupMap = new Map<string, string>();
  for (const record of records) {
    const newId = idMap.get(record.id);
    if (newId === undefined) continue;
    let groupId: string | undefined;
    if (record.groupId !== undefined) {
      groupId = groupMap.get(record.groupId) ?? newSuggestionId();
      groupMap.set(record.groupId, groupId);
    }
    writeSuggestionRecordInTx(destDoc, {
      id: newId,
      kind: record.kind,
      author: record.author,
      createdAt: record.createdAt,
      ...(record.order !== undefined ? { order: record.order } : {}),
      ...(record.proposedAttrs !== undefined ? { proposedAttrs: record.proposedAttrs } : {}),
      ...(groupId !== undefined ? { groupId } : {}),
      ...(record.metadata !== undefined ? { metadata: record.metadata } : {}),
    });
  }
}

/**
 * Apply suggestion-id rewrite to every leaf block in a `ClonedSubtree`.
 * Returns a NEW ClonedSubtree whose `blocks` map has rewritten inline items;
 * `embedContents` items are also rewritten (footnote body paragraphs can carry
 * suggestion attrs). Returns the original when `idMap` is empty.
 */
function rewriteClonedSubtreeSuggestionIds(
  cloned: ClonedSubtree,
  idMap: ReadonlyMap<SuggestionId, SuggestionId>,
): ClonedSubtree {
  if (idMap.size === 0) return cloned;

  function rewriteBlocksMap(
    source: ReadonlyMap<BlockId, Block>,
  ): ReadonlyMap<BlockId, Block> {
    let changed = false;
    const newMap = new Map<BlockId, Block>();
    for (const [id, block] of source) {
      if (block.inlineContent !== null) {
        const newItems = rewriteItemSuggestionIds(block.inlineContent.items, idMap);
        if (newItems !== block.inlineContent.items) {
          changed = true;
          newMap.set(id, { ...block, inlineContent: { ...block.inlineContent, items: newItems } });
          continue;
        }
      }
      newMap.set(id, block);
    }
    return changed ? newMap : source;
  }

  const newBlocks = rewriteBlocksMap(cloned.blocks);
  const newEmbedContents = rewriteBlocksMap(cloned.embedContents);
  if (newBlocks === cloned.blocks && newEmbedContents === cloned.embedContents) return cloned;
  return { rootId: cloned.rootId, blocks: newBlocks, embedContents: newEmbedContents };
}

// ─────────────────────────────────────────────────────────────────────────────
// Edge-case helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if `blockId` lives inside a table-cell by walking the
 * ancestor chain. Returns true when any ancestor has type "table-cell".
 */
function isInsideTableCell(document: Document, blockId: BlockId): boolean {
  const chain = ancestorChain(document, blockId);
  return chain.some((id) => {
    const b = resolveBlock(document, id)?.block;
    return b !== undefined && b.type === "table-cell";
  });
}

/**
 * Walk a cloned table subtree and collect all LEAF blocks (paragraphs
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
 * as `embedContent` roots. The blocks are FROZEN `Block` SNAPSHOTS from
 * `clonePastedSubtree` with fresh ids and re-keyed contentBlockId references;
 * each body root is written with `writeRoot` (as `insert-footnote.ts` does). MUST
 * run inside an already-open transaction.
 */
function materializeEmbedContentsInTx(
  doc: Y.Doc,
  clonedEmbedContents: ReadonlyMap<BlockId, Block>,
): void {
  if (clonedEmbedContents.size === 0) return;
  for (const root of treesOf([...clonedEmbedContents.values()], null)) writeRoot(doc, root, "embedContent");
}

/**
 * The ¶ ending a pasted CLOSED paragraph takes that paragraph's ¶ formatting (Word: a
 * pasted paragraph mark brings its own rPr), filtered to the doc's inclusive keys. No
 * registry bound to the doc → no write (as every `markAttrs` writer).
 */
function writePastedMarkAttrs(doc: Y.Doc, id: BlockId, markAttrs: ReadonlyAttrs | undefined): void {
  writeTypedMarkAttrs(doc, id, markAttrs ?? {});
}

/** The middle run of a multi-block paste as tree nodes (containers keep their subtree). */
function middleNodes(
  entries: ReadonlyArray<
    | { readonly kind: "container"; readonly cloned: ClonedSubtree }
    | { readonly kind: "leaf"; readonly id: BlockId; readonly type: string; readonly attrs: Record<string, unknown>; readonly items: ReadonlyArray<InlineItem>; readonly markAttrs?: ReadonlyAttrs }
  >,
): TreeNode[] {
  return entries.flatMap((e): TreeNode[] =>
    e.kind === "container"
      ? treesOf([...e.cloned.blocks.values()], e.cloned.rootId)
      : [{ id: e.id, type: e.type, attrs: e.attrs, inlineContent: { items: [...e.items] }, children: [], ...(e.markAttrs !== undefined ? { markAttrs: e.markAttrs } : {}) }],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main operation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Insert a fragment `Document` (produced by `extractFragment` / `decodeHtml` / `decodeFragmentClip`)
 * into `document` at `selection`, in DIRECT (non-suggesting) mode.
 *
 * **Boundary semantics:**
 * - Cross-context selection → identity no-op.
 * - Non-collapsed selection → `deleteRange` first; caret = the seam it leaves (`deleteRangeSeam`).
 * - Empty fragment (no top-level blocks) → identity no-op.
 * - 1 top-level leaf → inline-merge into caret block via `planInsertItemsAt`.
 * - N > 1 top-level items (leaves and/or containers) → split caret block; first leaf (if any)
 *   merges into prefix; last leaf (if any) prepends to suffix; middle items (containers and/or
 *   leaves) become standalone siblings; container subtrees are materialized into
 *   `getBlocksMap` + relinked inline in the transaction body.
 *
 * Fragment `listDefs` are cloned under fresh ids so pasted list numbering is
 * independent of the destination's lists. Fragment `suggestion` records are copied
 * into the destination under FRESH ids; every carrier (text attrs + embed
 * formatting tags) is rewritten to the new id so the destination holds no dangling
 * references. Break tags are never carried: a pasted boundary is a real break.
 */
export function insertFragment(
  document: Document,
  selection: Span,
  fragment: Document,
  allocator: IdAllocator,
): InsertFragmentResult {
  // Step 1: cross-context guard → identity no-op.
  if (isCrossContextSelection(document, selection)) {
    return { document, dirtyIds: new Set<BlockId>(), endPosition: selection.focus };
  }

  const accumulatedDirtyIds = new Set<BlockId>();

  // Step 2: non-collapsed selection → deleteRange; accumulate dirtyIds; caret = the
  // seam the delete leaves (`deleteRangeSeam`: in the surviving block).
  let currentDocument: Document = document;
  let caretPos: Position = selection.focus;

  if (!isCollapsed(selection)) {
    const seam = deleteRangeSeam(document, selection);
    if (seam === null) return { document, dirtyIds: new Set<BlockId>(), endPosition: selection.focus };
    const deleteResult = deleteRange(currentDocument, selection);
    currentDocument = deleteResult.document;
    for (const id of deleteResult.dirtyIds) accumulatedDirtyIds.add(id);
    caretPos = seam;
  }

  // Step 3: collect cloned top-level blocks from the fragment.
  const fragRoot = getBlock(fragment, fragment.rootId);
  if (fragRoot === null) {
    // Malformed fragment — identity no-op.
    return { document, dirtyIds: new Set<BlockId>(), endPosition: caretPos };
  }

  // Build the suggestion-id remap BEFORE walking/cloning so the rewrite can be
  // applied to every cloned item in the same pass. Fresh ids are minted once here;
  // the records and the idMap are passed into transferSuggestionRecords inside
  // each transaction arm below.
  const { idMap: suggestionIdMap, records: suggestionRecords } = buildSuggestionIdRemap(fragment);

  // Walk fragment's top-level children and clone EACH into the destination
  // namespace via `clonePastedSubtree`. Cloning is REQUIRED
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
        /** The pasted paragraph's ¶ formatting (Word: a pasted ¶ brings its rPr). */
        readonly markAttrs?: ReadonlyAttrs;
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

  // The fragment's blocks sit in its (final) section — a fragment is section-free.
  for (const cur of topLevelBlockIds(fragment)) {
    const fragBlock = getBlock(fragment, cur);
    if (fragBlock === null) break;

    // Clone the subtree into the destination namespace. For a leaf, `blocks`
    // holds exactly one entry; for a container, `blocks` holds the whole
    // subtree (table + rows + cells + leaf paragraphs). `embedContents` holds
    // any footnote bodies reachable from inline content at any depth.
    const rawCloned = clonePastedSubtree(fragment, fragBlock.id, allocator, document);
    // Rewrite suggestion ids in the cloned subtree (leaf items and all
    // container-block items) so spliced blocks already carry the new ids.
    const cloned = rewriteClonedSubtreeSuggestionIds(rawCloned, suggestionIdMap);
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
      // Leaf block: record as a leaf item (items already rewritten by rewriteClonedSubtreeSuggestionIds).
      topLevelItems.push({
        kind: "leaf",
        type: clonedRoot.type,
        attrs: { ...(clonedRoot.attrs as Record<string, unknown>) },
        items: clonedRoot.inlineContent.items,
        ...(clonedRoot.markAttrs !== undefined ? { markAttrs: clonedRoot.markAttrs } : {}),
      });
    } else {
      // Container block (table, section, etc.): record the full cloned subtree.
      topLevelItems.push({ kind: "container", cloned });
    }
  }

  // Step 3 continued: merge fragment listDefs under fresh ids.
  // Build a listId remap: old fragment listId → new destination listId.
  const fragListDefs = getListDefsForDocument(fragment);
  const listIdRemap = new Map<string, string>();
  for (const [oldListId] of fragListDefs) {
    listIdRemap.set(oldListId, newListId());
  }

  // Step 4: splice.
  // Step 4a: 0 top-level blocks → identity no-op.
  if (topLevelItems.length === 0) {
    return { document, dirtyIds: new Set<BlockId>(), endPosition: caretPos };
  }

  const caretBlockId = caretPos.blockId;
  const caretOffset = caretPos.offset;
  // Use resolveBlock so embedContent caret positions (e.g. footnote body) work.
  const caretResolvedForSplice = resolveBlock(currentDocument, caretBlockId);
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

  // ── Edge-case transforms (applied in order before splice) ──────────────

  // Table-into-cell flatten.
  // If the caret is inside a table-cell, replace any cloned table containers with
  // their cell leaf paragraphs (no nested tables).
  if (isInsideTableCell(currentDocument, caretPos.blockId)) {
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

  // List-level rebasing.
  // Find the minimum listLevel across all leaf list-items in the fragment.
  // Subtract minLevel from each, then add the target block's listLevel (if in a list).
  {
    const caretBlockForRebase = resolveBlock(currentDocument, caretPos.blockId)?.block ?? null;
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

  // (No empty-leaf trimming: an empty leading / trailing leaf is a ¶ the span covered
  // — so pasting it inserts a paragraph break, as Word / GDocs do.)

  // Footnote-in-footnote stripping.
  // If the caret is inside an embed-content (e.g. a footnote body), strip
  // footnote-anchor embeds from any leaf items' inline content.
  const caretResolvedBlock = resolveBlock(currentDocument, caretPos.blockId);
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

  // Empty target adopt — if the caret block is empty at offset 0 AND the first
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

    const insertPlan = planInsertItemsAt(caretBlockId, caretBlockKind, caretOffset, leafItems);

    const insertedLength = leafItems.reduce(
      (sum, it) => sum + (it.kind === "text" ? it.text.length : 1),
      0,
    );

    const result = applyOperation(currentDocument, (doc) => {
      // Materialize cloned footnote bodies into the destination embedContents tree.
      materializeEmbedContentsInTx(doc, clonedEmbedContents);
      // Write fragment listDefs under fresh ids.
      for (const [oldId, def] of fragListDefs) {
        const newId = listIdRemap.get(oldId);
        if (newId !== undefined) writeListDefInTx(doc, newId, def);
      }
      // Transfer suggestion records (re-keyed under fresh ids).
      transferSuggestionRecords(suggestionRecords, suggestionIdMap, doc);
      // Adopt type+attrs of the single leaf if caret block was empty at 0.
      if (shouldAdoptType) {
        writeBlockType(doc, caretBlockId, leaf.type);
        writeBlockAttrs(doc, caretBlockId, leaf.attrs);
      }
      insertItemsInTx(doc, insertPlan);
    });

    currentDocument = result.document;
    for (const id of result.dirtyIds) accumulatedDirtyIds.add(id);
    endPosition = createPosition(caretBlockId, caretOffset + insertedLength);
  } else {
    // ── Multi-item (containers and/or multiple leaves): split-merge ──────────
    //
    // General algorithm:
    //   - Split caret block at caretOffset → prefix (the head, new id) + suffix (caretBlockId).
    //   - If first item is a leaf: merge its items into the end of prefix.
    //   - If last item is a leaf: prepend its items to the start of suffix.
    //   - Everything in between (containers and/or middle leaves) → insert as
    //     standalone siblings between prefix and suffix. All materialized in one
    //     transaction via getBlocksMap + boundary relink.
    //
    // Skip-split optimization — when offset=0 with no firstLeaf, the split
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

    // Detect skip-split conditions.
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
      | { readonly kind: "leaf"; readonly id: BlockId; readonly type: string; readonly attrs: Record<string, unknown>; readonly items: ReadonlyArray<InlineItem>; readonly markAttrs?: ReadonlyAttrs };

    const orderedMiddle: MiddleEntry[] = middleItems.map((item) =>
      item.kind === "container"
        ? { kind: "container", cloned: item.cloned }
        : { kind: "leaf", id: allocator.allocate(), type: item.type, attrs: item.attrs, items: item.items, markAttrs: item.markAttrs },
    );

    // ── Split-based path (normal case) ───────────────────────────────────────
    if (!skipSplit) {
      // Split (Word): the HEAD [0, caretOffset) takes the new id — the prefix; the
      // caret block keeps its id as the suffix.
      const splitPlan = planSplitBlockAtPosition(currentDocument, caretPos, allocator);
      const prefixBlockId = splitPlan.newBlockId;
      const suffixBlockId = caretBlockId;

      // Plan prefix merge: append firstLeaf.items to end of prefix block.
      const [prefixItems] = splitInlineContentAtOffset(caretBlock.inlineContent, caretOffset);
      const prefixLength = prefixItems.reduce(
        (s, it) => s + (it.kind === "text" ? it.text.length : 1),
        0,
      );
      const prefixMergePlan =
        firstLeaf !== null
          ? planInsertItemsAt(prefixBlockId, caretBlockKind, prefixLength, firstLeaf.items)
          : null;

      // Plan suffix prepend: prepend lastLeaf.items at offset 0 of suffix block.
      // The suffix block was just created by splitBlockAtPositionInTx in the same
      // tree as the caret block, so it uses the same kind.
      const suffixPrependPlan =
        lastLeaf !== null
          ? planInsertItemsAt(suffixBlockId, caretBlockKind, 0, lastLeaf.items)
          : null;

      const lastInsertedLength =
        lastLeaf !== null
          ? lastLeaf.items.reduce((s, it) => s + (it.kind === "text" ? it.text.length : 1), 0)
          : 0;

      const result = applyOperation(currentDocument, (doc) => {
        // Materialize cloned footnote bodies into the destination embedContents tree.
        materializeEmbedContentsInTx(doc, clonedEmbedContents);
        // Write fragment listDefs under fresh ids.
        for (const [oldId, def] of fragListDefs) {
          const newId = listIdRemap.get(oldId);
          if (newId !== undefined) writeListDefInTx(doc, newId, def);
        }
        // Transfer suggestion records (re-keyed under fresh ids).
        transferSuggestionRecords(suggestionRecords, suggestionIdMap, doc);
        // (a) Split the caret block → prefix + suffix.
        splitBlockAtPositionInTx(doc, splitPlan);
        // (a') adopt: if caret block was empty at offset 0 and first item is a leaf,
        // adopt the leaf's type+attrs onto the prefix block (same as single-leaf adopt arm).
        if (shouldAdoptType && firstLeaf !== null) {
          writeBlockType(doc, prefixBlockId, firstLeaf.type);
          writeBlockAttrs(doc, prefixBlockId, firstLeaf.attrs);
        }
        // (b) Merge firstLeaf into prefix (if first item is a leaf). The prefix's ¶
        // is the pasted first paragraph's (closed) ¶, so it brings that ¶'s formatting.
        if (prefixMergePlan !== null) {
          insertItemsInTx(doc, prefixMergePlan);
        }
        if (firstLeaf !== null) writePastedMarkAttrs(doc, prefixBlockId, firstLeaf.markAttrs);
        // (c) Insert middle items (containers + middle leaves) between prefix and suffix.
        // Single contiguous splice: materialize all container subtrees and standalone
        // leaf blocks into blocksMap, then relink the whole run's sibling chain
        // (prefix → [middle roots] → suffix) in one pass.
        if (orderedMiddle.length > 0) {
          insertChildren(doc, caretParentId, prefixBlockId, middleNodes(orderedMiddle), caretBlockKind);
        }
        // (d) Prepend lastLeaf to suffix (if last item is a leaf).
        if (suffixPrependPlan !== null) {
          insertItemsInTx(doc, suffixPrependPlan);
        }
      });

      currentDocument = result.document;
      for (const id of result.dirtyIds) accumulatedDirtyIds.add(id);

      // endPosition: if last item was a leaf, offset = lastInsertedLength (into suffix).
      // If last item was a container, offset = 0 (suffix is unchanged, caret at start).
      endPosition = createPosition(suffixBlockId, lastInsertedLength);
    } else {
      // ── Skip-split path: offset at boundary with no leaf to fill empty side ──
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

      // Plan leaf merge if needed.
      // skipSplitAtStart: lastLeaf prepends to caretBlock at offset 0 (caretBlock = suffix).
      // skipSplitAtEnd: firstLeaf appends to caretBlock at end (caretBlock = prefix).
      const [prefixItems] = splitInlineContentAtOffset(caretBlock.inlineContent, caretOffset);
      const prefixLength = prefixItems.reduce(
        (s, it) => s + (it.kind === "text" ? it.text.length : 1),
        0,
      );
      const leafMergePlan = skipSplitAtStart && lastLeaf !== null
        ? planInsertItemsAt(caretBlockId, caretBlockKind, 0, lastLeaf.items)
        : skipSplitAtEnd && firstLeaf !== null
          ? planInsertItemsAt(caretBlockId, caretBlockKind, prefixLength, firstLeaf.items)
          : null;

      const lastInsertedLength =
        skipSplitAtStart && lastLeaf !== null
          ? lastLeaf.items.reduce((s, it) => s + (it.kind === "text" ? it.text.length : 1), 0)
          : skipSplitAtEnd && firstLeaf !== null
            ? firstLeaf.items.reduce((s, it) => s + (it.kind === "text" ? it.text.length : 1), 0)
            : 0;

      const result = applyOperation(currentDocument, (doc) => {
        // Materialize cloned footnote bodies into the destination embedContents tree.
        materializeEmbedContentsInTx(doc, clonedEmbedContents);
        // Write fragment listDefs under fresh ids.
        for (const [oldId, def] of fragListDefs) {
          const newId = listIdRemap.get(oldId);
          if (newId !== undefined) writeListDefInTx(doc, newId, def);
        }
        // Transfer suggestion records (re-keyed under fresh ids).
        transferSuggestionRecords(suggestionRecords, suggestionIdMap, doc);
        // adopt (skip-split path): if caret block was empty at offset 0 and
        // skipSplitAtEnd is true (caret block is the prefix), adopt the first leaf's
        // type+attrs onto the caret block — same contract as the split arm's adopt block.
        // skipSplitAtStart implies firstLeaf===null (items go BEFORE the caret block),
        // so adoption is only meaningful for skipSplitAtEnd.
        if (shouldAdoptType && skipSplitAtEnd && firstLeaf !== null) {
          writeBlockType(doc, caretBlockId, firstLeaf.type);
          writeBlockAttrs(doc, caretBlockId, firstLeaf.attrs);
        }

        // Insert middle items.
        if (orderedMiddle.length > 0) {
          insertChildren(doc, caretParentId, anchorBlockId, middleNodes(orderedMiddle), caretBlockKind);
        }

        // Merge boundary leaf (lastLeaf into caretBlock start, or firstLeaf into caretBlock end).
        if (leafMergePlan !== null) {
          insertItemsInTx(doc, leafMergePlan);
        }
      });

      currentDocument = result.document;
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
  if (currentDocument === document) {
    return { document, dirtyIds: new Set<BlockId>(), endPosition: caretPos };
  }

  return {
    document: currentDocument,
    dirtyIds: accumulatedDirtyIds,
    endPosition,
  };
}
