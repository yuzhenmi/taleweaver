import * as Y from "yjs";
import type { State, OperationResult } from "../state";
import { applyOperation, resolveBlock } from "../state";
import { iterateBlocksInDocumentOrder } from "../document-order";
import { STATE_INTERNAL } from "../state-internal";
import type { BlockId } from "../block-id";
import type { Span } from "../block-position";
import { spanStart, spanEnd } from "../block-compare";
import {
  mergeAdjacentTextItems,
  type InlineItem,
} from "../inline-content";
import {
  getCommentsMap,
  getYBlock,
  requireInTransaction,
  type BlockTreeKind,
} from "../yjs-doc";
import { buildYInlineContent } from "../y-block";
import {
  writeCommentRecordInTx,
  replyToY,
  COMMENT_START_EMBED_TYPE,
  COMMENT_END_EMBED_TYPE,
  type CommentId,
  type CommentRecord,
  type CommentReply,
} from "../comments";
import {
  planCommentMarkers,
  applyCommentMarkerWritesInTx,
} from "./insert-comment-markers";

/** An empty dirtyIds set — the identity-no-op return per the T7 contract. */
const NO_DIRTY: ReadonlySet<BlockId> = new Set<BlockId>();

/**
 * Fields the host supplies when minting a comment thread. `id` is the branded
 * `CommentId` (minted host-side); `author`/`body`/`createdAt` are deterministic
 * host-injected values (createdAt mirrors `EditorConfig.now`).
 */
export interface AddCommentInput {
  readonly id: CommentId;
  readonly author: string;
  readonly body: string;
  readonly createdAt: number;
}

/** Fields the host supplies when appending a reply. */
export interface AddReplyInput {
  readonly replyId: string;
  readonly author: string;
  readonly body: string;
  readonly createdAt: number;
}

/**
 * Add a comment over `span`: insert the paired zero-width `comment-start`/
 * `comment-end` markers AND write the thread record, in ONE tracked
 * `applyOperation` transaction — so the markers + record land as ONE undo
 * entry (undoable-as-content, §2) and one collab event.
 *
 * Composes the slice-1 `insert-comment-markers` PLAN + its `*InTx` applier
 * (NOT `insertCommentMarkers`, which would open its own transaction) so the
 * marker inserts share the record write's transaction. The record starts with
 * `replies: []` and `resolved: false`.
 *
 * Validates the span exactly like `insertCommentMarkers` (via
 * `planCommentMarkers`): throws if either endpoint's block is missing, is not a
 * leaf, or its offset is out of range. (The editor action — a later slice — is
 * responsible for the collapsed / cross-context / non-main-body guards.)
 */
export function addComment(
  state: State,
  span: Span,
  input: AddCommentInput,
): OperationResult {
  // Identity no-op if a comment with this id already exists. Host-minted ids are
  // unique by contract, so a same-id re-add is a programmer error; short-circuit
  // to the input state BEFORE planning/splicing a SECOND marker pair (which would
  // overwrite the record AND leave a duplicate-marker comment — the precondition
  // the I-1 `deleteComment` full-scan defends against). Mirrors `setResolved`'s
  // absent-guard short-circuit (the T7 identity-no-op contract).
  if (getCommentsMap(state[STATE_INTERNAL].doc).get(input.id) !== undefined) {
    return { state, dirtyIds: NO_DIRTY };
  }
  const start = spanStart(state, span);
  const end = spanEnd(state, span);
  const writes = planCommentMarkers(state, start, end, input.id);
  const record: CommentRecord = {
    id: input.id,
    author: input.author,
    body: input.body,
    createdAt: input.createdAt,
    replies: [],
    resolved: false,
  };
  return applyOperation(state, (doc) => {
    applyCommentMarkerWritesInTx(doc, writes);
    writeCommentRecordInTx(doc, record);
  });
}

/**
 * Mark a comment resolved. Tracked op (the `comments` map is in the
 * UndoManager's scopes). Identity no-op (returns the same `state` reference, so
 * the editor short-circuits per the T7 contract) if the comment is absent or
 * already resolved. A real flip surfaces `state.rootId` as the dirtyId (the
 * `comments` map is excluded from dirty-capture) so the op advances state and
 * lands a committable, undoable entry — see {@link setResolved}.
 */
export function resolveComment(state: State, id: CommentId): OperationResult {
  return setResolved(state, id, true);
}

/**
 * Reopen a resolved comment. Tracked op. Identity no-op if the comment is
 * absent or already open.
 */
export function reopenComment(state: State, id: CommentId): OperationResult {
  return setResolved(state, id, false);
}

function setResolved(state: State, id: CommentId, resolved: boolean): OperationResult {
  const doc = state[STATE_INTERNAL].doc;
  const yRecord = getCommentsMap(doc).get(id);
  if (yRecord === undefined) return { state, dirtyIds: NO_DIRTY };
  if (yRecord.get("resolved") === resolved) return { state, dirtyIds: NO_DIRTY };
  return applyOperation(state, (d) => {
    const rec = getCommentsMap(d).get(id);
    if (rec !== undefined) rec.set("resolved", resolved);
    // The `comments` map is EXCLUDED from dirty-capture (a side-table, not a
    // block tree — see `yjs-doc.ts`), so this flip alone would capture no
    // dirtyId, making `applyOperation` short-circuit to the input `state`
    // (identity) and `History.commit` drop the entry (`dirtyIds.size === 0` →
    // no StackItem committed → the tracked map mutation lands an ORPHAN
    // StackItem with no SelectionEntry, crashing the next undo). Surface the
    // document root so the flip advances state and lands a tracked, undoable
    // entry — the same `extra`-channel pattern `deleteComment` uses for its
    // orphaned-by-absence case.
    return new Set<BlockId>([state.rootId]);
  });
}

/**
 * Delete a comment: remove BOTH markers from content AND the thread record from
 * the `comments` map, in ONE tracked transaction (undoable as a unit; redo
 * re-adds).
 *
 * The markers are stripped per OWNING BLOCK: every inline item carrying this
 * `commentId` as a `comment-start`/`comment-end` embed is filtered out of its
 * block's `inlineContent`, and the block is full-replaced. This is correct for
 * BOTH the same-block case (both markers stripped in one rewrite) and the
 * cross-block case (each marker stripped from its own block) — and avoids the
 * stale-offset hazard of composing two independent `deleteRange` plans against
 * the same pre-transaction snapshot (a same-block second delete would re-write
 * the block from a snapshot that still contained the first marker).
 *
 * No-op (identity) if the comment has neither a record nor any marker in
 * content. A one-sided surviving marker is stripped too.
 *
 * When markers survive, their owning-block rewrites are themselves tree-map
 * writes, so `applyOperation` captures them as dirty and the op advances state
 * (tracked + undoable). In the ORPHANED-BY-ABSENCE case — the record is present
 * but BOTH markers are already gone (e.g. a `deleteRange` removed the whole
 * commented span incl. both markers) — there is no block rewrite, so the only
 * mutation is the `comments` map delete. The `comments` map is deliberately
 * EXCLUDED from dirty-capture (it is a side-table, not a block tree; see
 * `yjs-doc.ts`), so without help that delete would capture no dirtyId, making
 * `applyOperation` short-circuit to the input state (identity) and
 * `History.commit` drop the entry (`dirtyIds.size === 0` → no StackItem →
 * NOT undoable), silently violating the "tracked, undoable" contract above.
 * To keep the record delete tracked, we surface the document root as the
 * affected dirtyId via the op-contributed `extra` channel (mirrors how
 * `setListType` surfaces affected block ids for its side-table-only write).
 */
export function deleteComment(state: State, id: CommentId): OperationResult {
  const doc = state[STATE_INTERNAL].doc;
  const hasRecord = getCommentsMap(doc).get(id) !== undefined;
  const writes = planMarkerStrip(state, id);
  if (!hasRecord && writes.length === 0) return { state, dirtyIds: NO_DIRTY };

  return applyOperation(state, (d) => {
    for (const write of writes) {
      requireInTransaction(d, "deleteComment");
      const yBlock = getYBlock(d, write.blockId, "deleteComment", write.kind);
      yBlock.set("inlineContent", buildYInlineContent({ items: write.items }));
    }
    getCommentsMap(d).delete(id);
    // Orphaned-by-absence: no marker block was rewritten, so the comments-map
    // delete alone would capture no dirtyId (the map is excluded from
    // dirty-capture). Surface the document root so the record delete advances
    // state and lands a tracked, undoable entry.
    if (writes.length === 0) return new Set<BlockId>([state.rootId]);
  });
}

/**
 * Append a reply to a comment thread. Pushes a reply `Y.Map` onto the record's
 * `replies` `Y.Array` (tracked). Identity no-op (same `state` reference) if the
 * comment is absent. A real push surfaces `state.rootId` as the dirtyId (the
 * `comments` map is excluded from dirty-capture) so the op advances state and
 * lands a committable, undoable entry — mirrors {@link setResolved}.
 */
export function addReply(
  state: State,
  id: CommentId,
  input: AddReplyInput,
): OperationResult {
  const doc = state[STATE_INTERNAL].doc;
  if (getCommentsMap(doc).get(id) === undefined) return { state, dirtyIds: NO_DIRTY };
  const reply: CommentReply = {
    id: input.replyId,
    author: input.author,
    body: input.body,
    createdAt: input.createdAt,
  };
  return applyOperation(state, (d) => {
    const yRecord = getCommentsMap(d).get(id);
    if (yRecord === undefined) return;
    const yReplies = yRecord.get("replies");
    // Only surface the dirtyId when the push ACTUALLY happens. If `replies` is
    // not a `Y.Array` (corrupted record), no tracked mutation occurs, so
    // surfacing `state.rootId` would force `History.commit` to run with a dirty
    // root yet NO Yjs StackItem → "no undo StackItem" throw. Returning nothing
    // there yields the identity no-op (the `applyOperation` short-circuit) — the
    // correct outcome for a write that didn't land.
    if (!(yReplies instanceof Y.Array)) return;
    yReplies.push([replyToY(reply)]);
    // The `comments` map is EXCLUDED from dirty-capture (a side-table, not a
    // block tree), so this reply push alone would capture no dirtyId — the same
    // hazard `setResolved` documents: `applyOperation` short-circuits to the
    // input `state` (identity) and `History.commit` drops the entry, leaving an
    // orphan StackItem that crashes the next undo. Surface the document root so
    // the push advances state and lands a tracked, undoable entry.
    return new Set<BlockId>([state.rootId]);
  });
}

/** Pre-computed marker-strip write for one owning leaf block. */
interface StripWrite {
  readonly blockId: BlockId;
  readonly kind: BlockTreeKind;
  readonly items: ReadonlyArray<InlineItem>;
}

/**
 * Plan the marker-strip for `id`: for each block whose inline content holds a
 * `comment-start`/`comment-end` embed carrying this `commentId`, produce a
 * write with those embeds removed (and the split text halves re-normalized via
 * `mergeAdjacentTextItems`, since removing the embed merge-barrier may make two
 * text runs adjacent). Blocks with no such marker produce no write. Computed
 * against the pre-transaction snapshot via ONE full-document block walk
 * (`iterateBlocksInDocumentOrder`, the same scan the resolver uses) plus
 * `resolveBlock` for each owning block — so every marker for `id` is stripped,
 * not only the range index's two first-seen endpoint blocks (see below).
 */
function planMarkerStrip(state: State, id: CommentId): StripWrite[] {
  // Scan EVERY block (the SAME full-document walk `buildCommentRangeIndex` uses)
  // and strip markers for `id` wherever they appear — NOT only the range index's
  // two first-seen endpoint blocks. The index records only the first start and
  // first end position, so a malformed comment with a DUPLICATE marker in a third
  // block (reachable via a collab merge or import, not single-user ops) would
  // otherwise leave that stray marker orphaned in content forever. Every other
  // consumer (`deriveRange`, the orphan logic) is duplicate-tolerant; this keeps
  // the strip scope uniform with the resolver's scan. `deleteComment` is rare, so
  // the O(N inline-items) walk is not a hot path.
  const writes: StripWrite[] = [];
  for (const block of iterateBlocksInDocumentOrder(state)) {
    const content = block.inlineContent;
    if (content === null) continue;
    const kept: InlineItem[] = [];
    let removed = false;
    for (const item of content.items) {
      if (isCommentMarkerFor(item, id)) {
        removed = true;
        continue;
      }
      kept.push(item);
    }
    if (!removed) continue;
    const resolved = resolveBlock(state, block.id);
    if (resolved === null) continue; // unreachable: an iterated block resolves.
    writes.push({
      blockId: block.id,
      kind: resolved.kind,
      items: mergeAdjacentTextItems(kept),
    });
  }
  return writes;
}

/** True iff `item` is a comment marker embed carrying `commentId === id`. */
function isCommentMarkerFor(item: InlineItem, id: CommentId): boolean {
  return (
    item.kind === "embed" &&
    (item.embedType === COMMENT_START_EMBED_TYPE ||
      item.embedType === COMMENT_END_EMBED_TYPE) &&
    item.properties.commentId === id
  );
}
