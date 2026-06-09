import type * as Y from "yjs";
import type { State, OperationResult } from "../state";
import { applyOperation, resolveBlock } from "../state";
import type { BlockId } from "../block-id";
import type { Position, Span } from "../block-position";
import { spanStart, spanEnd } from "../block-compare";
import {
  inlineContentLength,
  splitInlineContentAtOffset,
  mergeAdjacentTextItems,
  type EmbedItem,
  type InlineContent,
  type InlineItem,
} from "../inline-content";
import { getYBlock, requireInTransaction, type BlockTreeKind } from "../yjs-doc";
import { buildYInlineContent } from "../y-block";
import {
  COMMENT_START_EMBED_TYPE,
  COMMENT_END_EMBED_TYPE,
  type CommentId,
} from "../comments";

/**
 * Pre-computed write for ONE leaf block: its tree provenance plus the new
 * `items[]` to full-replace its inlineContent with. An embed is a merge
 * barrier, so marker insertion is always a full-replace of the leaf's items.
 *
 * Exported so a higher-level op (`addComment`, slice 2) can compose the marker
 * insert with its thread-record write in ONE `applyOperation` transaction:
 * `planCommentMarkers` against the pre-transaction snapshot, then
 * `applyCommentMarkerWritesInTx` inside the surrounding transaction.
 */
export interface LeafWrite {
  readonly blockId: BlockId;
  readonly kind: BlockTreeKind;
  readonly items: ReadonlyArray<InlineItem>;
}

/**
 * Insert the paired zero-width comment markers delimiting `span`, atomically
 * (ONE `applyOperation` transaction → one undo entry, one collab event). The
 * markers ARE the comment's anchor: because they are inline content (exactly
 * like a footnote-anchor `EmbedItem`), the existing structural ops move/clone
 * them with surrounding text for free, so the range survives insert / delete /
 * split / merge / paste.
 *
 * Each marker is a bodyless `EmbedItem` carrying `properties.commentId` and
 * NOTHING else (no `contentBlockId` — it owns no embed body, like a
 * cross-reference pointer, so the embed-cascade scanners ignore it). The
 * `comment-end` marker is conceptually placed at the span END first, THEN the
 * `comment-start` marker at the span START — END-FIRST so the start insert does
 * not shift the end offset (when both fall in the same block, both markers are
 * spliced into ONE items array end-first; when the span crosses blocks, each
 * marker lands in its own leaf).
 *
 * The op TRUSTS `commentId` (minted host-side by the editor action in a later
 * slice). It DOES validate both endpoint positions.
 *
 * `dirtyIds` covers the host leaf block(s) whose inlineContent changed —
 * `captureDirtyIds` tracks the tree maps automatically.
 *
 * Throws if either endpoint's block does not resolve, is not a leaf, or its
 * offset is out of range.
 */
export function insertCommentMarkers(
  state: State,
  span: Span,
  commentId: CommentId,
): OperationResult {
  const start = spanStart(state, span);
  const end = spanEnd(state, span);
  const writes = planCommentMarkers(state, start, end, commentId);

  return applyOperation(state, (doc) => {
    applyCommentMarkerWritesInTx(doc, writes);
  });
}

/**
 * Validate both endpoints and produce the per-leaf write list against the
 * pre-transaction snapshot. Two cases:
 *
 *   - START and END in the SAME block → ONE write: splice the END marker at
 *     `end.offset` then the START marker at `start.offset` into that block's
 *     items (end-first so the start splice does not shift the end offset).
 *   - START and END in DIFFERENT blocks → TWO writes: the start marker into the
 *     start leaf, the end marker into the end leaf (independent splices).
 *
 * Throws on a missing block, a non-leaf host, or an out-of-range offset for
 * either endpoint.
 */
export function planCommentMarkers(
  state: State,
  start: Position,
  end: Position,
  commentId: CommentId,
): readonly LeafWrite[] {
  const startMarker = makeMarker(COMMENT_START_EMBED_TYPE, commentId);
  const endMarker = makeMarker(COMMENT_END_EMBED_TYPE, commentId);

  if (start.blockId === end.blockId) {
    const { content, kind } = resolveLeaf(state, start.blockId);
    requireInRange(content, start.offset, start.blockId);
    requireInRange(content, end.offset, end.blockId);
    // End-first: splice the end marker, then the start marker into the result.
    const afterEnd = spliceMarker(content, end.offset, endMarker);
    const afterStart = spliceMarker({ items: afterEnd }, start.offset, startMarker);
    return [{ blockId: start.blockId, kind, items: afterStart }];
  }

  const startLeaf = resolveLeaf(state, start.blockId);
  requireInRange(startLeaf.content, start.offset, start.blockId);
  const endLeaf = resolveLeaf(state, end.blockId);
  requireInRange(endLeaf.content, end.offset, end.blockId);

  return [
    {
      blockId: end.blockId,
      kind: endLeaf.kind,
      items: spliceMarker(endLeaf.content, end.offset, endMarker),
    },
    {
      blockId: start.blockId,
      kind: startLeaf.kind,
      items: spliceMarker(startLeaf.content, start.offset, startMarker),
    },
  ];
}

function makeMarker(
  embedType: typeof COMMENT_START_EMBED_TYPE | typeof COMMENT_END_EMBED_TYPE,
  commentId: CommentId,
): EmbedItem {
  return Object.freeze({
    kind: "embed",
    embedType,
    attrs: Object.freeze({}),
    properties: Object.freeze({ commentId }),
  });
}

/** Resolve a leaf block, throwing if missing or not a leaf. */
function resolveLeaf(
  state: State,
  blockId: BlockId,
): { content: InlineContent; kind: BlockTreeKind } {
  const resolved = resolveBlock(state, blockId);
  if (resolved === null) {
    throw new Error(`insertCommentMarkers: block "${blockId}" not found`);
  }
  if (resolved.block.inlineContent === null) {
    throw new Error(
      `insertCommentMarkers: block "${blockId}" is not a leaf (no inlineContent)`,
    );
  }
  return { content: resolved.block.inlineContent, kind: resolved.kind };
}

function requireInRange(content: InlineContent, offset: number, blockId: BlockId): void {
  const totalLen = inlineContentLength(content);
  if (offset < 0 || offset > totalLen) {
    throw new Error(
      `insertCommentMarkers: offset ${offset} out of range [0, ${totalLen}] for block "${blockId}"`,
    );
  }
}

/**
 * Splice a marker into `content` at `offset`, returning the normalized items.
 * An embed is a merge barrier, so `mergeAdjacentTextItems` only normalizes the
 * split halves around the marker — it never merges across it.
 */
function spliceMarker(
  content: InlineContent,
  offset: number,
  marker: EmbedItem,
): ReadonlyArray<InlineItem> {
  const [left, right] = splitInlineContentAtOffset(content, offset);
  return mergeAdjacentTextItems([...left, marker, ...right]);
}

/**
 * In-transaction primitive: full-replace the host leaf's inlineContent with the
 * pre-computed `write.items`. Caller owns the surrounding transaction. Routes
 * the write to the leaf's owning tree (`write.kind`).
 */
function insertLeafWriteInTx(doc: Y.Doc, write: LeafWrite): void {
  requireInTransaction(doc, "insertCommentMarkers");
  const yBlock = getYBlock(doc, write.blockId, "insertCommentMarkers", write.kind);
  yBlock.set("inlineContent", buildYInlineContent({ items: write.items }));
}

/**
 * In-transaction primitive: apply a pre-computed list of marker `LeafWrite`s.
 * Caller owns the surrounding transaction (this MUST run inside an already-open
 * `applyOperation`/`runTransaction`). The companion to `planCommentMarkers`: a
 * higher-level op (`addComment`) plans against the pre-transaction snapshot,
 * then calls this inside the SAME transaction as its thread-record write so the
 * markers + record land as ONE undo entry / one collab event.
 */
export function applyCommentMarkerWritesInTx(
  doc: Y.Doc,
  writes: readonly LeafWrite[],
): void {
  for (const write of writes) {
    insertLeafWriteInTx(doc, write);
  }
}
