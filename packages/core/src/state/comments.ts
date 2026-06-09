import type { State } from "./state";
import { getBlock } from "./state";
import type { BlockId } from "./block-id";
import type { Position } from "./block-position";
import { createPosition } from "./block-position";
import { comparePositions } from "./block-compare";
import { iterateBlocksInDocumentOrder } from "./document-order";

/**
 * Branded identifier for a comment thread. Minted host-side (slice 3) and
 * stamped into BOTH of a comment's paired marker embeds (`properties.commentId`)
 * AND used as the key of its `CommentRecord` in the top-level `comments` Y.Map.
 */
export type CommentId = string & { readonly __brand: "CommentId" };

/** A single reply within a comment thread. */
export interface CommentReply {
  readonly id: string;
  readonly author: string;
  readonly body: string;
  readonly createdAt: number;
}

/**
 * A comment thread's data. Stored as a `Y.Map` in the top-level `comments`
 * side-table keyed by `CommentId`. There is NO anchor field — the comment's
 * RANGE is delimited by paired zero-width `comment-start`/`comment-end` marker
 * embeds in inline content (the markers ARE the anchor; see
 * {@link buildCommentRangeIndex}). `createdAt` is host-injected
 * (deterministic/testable). `replies` is stored CRDT-mergeably (a `Y.Array<Y.Map>`
 * in the Y.Doc; slice 2), frozen to a plain array on read.
 */
export interface CommentRecord {
  readonly id: CommentId;
  readonly author: string;
  readonly body: string;
  readonly createdAt: number;
  readonly replies: readonly CommentReply[];
  readonly resolved: boolean;
}

/**
 * The `embedType` discriminant of the marker embed that opens a comment range.
 * Zero-width: renders nothing (see `render/render-core.ts`), serializes to ""
 * (see `state/extract-text.ts`), but occupies one `Position` offset (atomic
 * embed, like a footnote anchor).
 */
export const COMMENT_START_EMBED_TYPE = "comment-start";

/** The `embedType` discriminant of the marker embed that closes a comment range. */
export const COMMENT_END_EMBED_TYPE = "comment-end";

/**
 * A comment's resolved range. `start`/`end` are the positions of its
 * `comment-start`/`comment-end` markers (the marker occupies offset
 * `[offset, offset+1)`; `start`/`end` are the marker's leading edge). `orphaned`
 * is DERIVED per the design §3 (see {@link buildCommentRangeIndex}).
 */
export interface CommentRange {
  readonly start: Position;
  readonly end: Position;
  readonly orphaned: boolean;
}

/**
 * Per-commentId marker tallies accumulated during the single content scan.
 * `start`/`end` hold the marker positions; the `>1` counters let the derivation
 * flag duplicate markers as orphaned (defensive — paste-strip should prevent
 * duplicates, but the scan tolerates them).
 */
interface MarkerTally {
  start: Position | null;
  startCount: number;
  end: Position | null;
  endCount: number;
}

/**
 * Scan the MAIN-TREE inline content ONCE and build the per-comment range index.
 * For every leaf block reachable from `state.rootId` (document order), record
 * each `comment-start`/`comment-end` embed's `{blockId, offset}` keyed by its
 * `properties.commentId`.
 *
 * A comment is LIVE (`orphaned: false`) iff its content holds EXACTLY ONE
 * `comment-start` AND EXACTLY ONE `comment-end`, AND `start` is strictly before
 * `end` in document order (`comparePositions`). Otherwise `orphaned: true`:
 *   - both markers gone (the comment has no entry here at all — not in the map),
 *   - only one marker survives (a delete crossed exactly one marker),
 *   - start not strictly before end (inverted),
 *   - more than one of either marker (defensive).
 *
 * The returned map omits comments with NO markers (both gone) — they are
 * orphaned-by-absence and surfaced as orphaned by the read side, which holds the
 * record list. A one-sided marker DOES produce an entry (so the read side can
 * report it orphaned with a concrete position to skip).
 *
 * Mirrors the cross-reference index pass: one O(N inline-items) walk, no layout.
 */
export function buildCommentRangeIndex(state: State): Map<CommentId, CommentRange> {
  const tallies = new Map<CommentId, MarkerTally>();

  for (const block of iterateBlocksInDocumentOrder(state)) {
    const content = block.inlineContent;
    if (content === null) continue;
    let offset = 0;
    for (const item of content.items) {
      if (item.kind === "text") {
        offset += item.text.length;
        continue;
      }
      // Embed: contributes one offset unit. Capture comment markers before
      // advancing the offset cursor.
      const isStart = item.embedType === COMMENT_START_EMBED_TYPE;
      const isEnd = item.embedType === COMMENT_END_EMBED_TYPE;
      if (isStart || isEnd) {
        const rawId = item.properties.commentId;
        if (typeof rawId === "string") {
          const commentId = rawId as CommentId;
          const tally = getOrCreateTally(tallies, commentId);
          const pos = createPosition(block.id, offset);
          if (isStart) {
            tally.startCount++;
            if (tally.start === null) tally.start = pos;
          } else {
            tally.endCount++;
            if (tally.end === null) tally.end = pos;
          }
        }
      }
      offset += 1;
    }
  }

  const index = new Map<CommentId, CommentRange>();
  for (const [commentId, tally] of tallies) {
    index.set(commentId, deriveRange(state, tally));
  }
  return index;
}

/**
 * Resolve a single comment's range by content scan. Returns `null` when the
 * comment has NO markers at all (neither start nor end found anywhere) — i.e.
 * the whole range incl. markers was deleted and there is nothing to anchor. A
 * one-sided or inverted marker pair resolves to a `CommentRange` with
 * `orphaned: true` (a concrete position survives, just not a well-formed pair).
 */
export function resolveCommentRange(state: State, commentId: CommentId): CommentRange | null {
  return buildCommentRangeIndex(state).get(commentId) ?? null;
}

function getOrCreateTally(
  tallies: Map<CommentId, MarkerTally>,
  commentId: CommentId,
): MarkerTally {
  const existing = tallies.get(commentId);
  if (existing !== undefined) return existing;
  const fresh: MarkerTally = { start: null, startCount: 0, end: null, endCount: 0 };
  tallies.set(commentId, fresh);
  return fresh;
}

/**
 * Derive a `CommentRange` from a marker tally. A well-formed pair (exactly one
 * start + exactly one end, start strictly before end) is LIVE; everything else
 * is orphaned. The reported `start`/`end` use whatever positions survive
 * (falling back to the other marker, or a degenerate self-range when only one
 * side exists) so the read side always has concrete positions even for an
 * orphaned comment (it skips orphaned ranges anyway).
 */
function deriveRange(state: State, tally: MarkerTally): CommentRange {
  const wellFormedCount = tally.startCount === 1 && tally.endCount === 1;
  if (wellFormedCount && tally.start !== null && tally.end !== null) {
    const orphaned = comparePositions(state, tally.start, tally.end) >= 0;
    return { start: tally.start, end: tally.end, orphaned };
  }
  // One-sided or duplicated: orphaned. Fill missing endpoints defensively so
  // `start`/`end` are always concrete `Position`s (consumers skip orphaned).
  const start = tally.start ?? tally.end;
  const end = tally.end ?? tally.start;
  if (start === null || end === null) {
    // Unreachable: a tally exists only when at least one marker was recorded.
    // Defensive fallback to the document root origin keeps the type total.
    const origin = createPosition(rootLeafId(state), 0);
    return { start: origin, end: origin, orphaned: true };
  }
  return { start, end, orphaned: true };
}

/** Defensive origin block id — the document root (always present). */
function rootLeafId(state: State): BlockId {
  const root = getBlock(state, state.rootId);
  return root?.id ?? state.rootId;
}
