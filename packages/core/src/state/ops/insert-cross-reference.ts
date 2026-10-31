import { requireBlockText } from "../block-text";
import type { Document, OperationResult } from "../document";
import { applyOperation, resolveBlock } from "../document";
import type { BlockId } from "../block-id";
import type { Position } from "../block-position";
import {
  inlineContentLength,
  type EmbedItem,
  type InlineItem,
} from "../inline-content";
import { requireInTransaction } from "../yjs-doc";
import { productionAllocator } from "../block-id";
import { isStructuralMarkerEmbedType } from "../embed-markers";
import { BOOKMARK_START_EMBED_TYPE, BOOKMARK_END_EMBED_TYPE, bookmarkIdOf, collectBookmarks, hasContent } from "../bookmarks";
import { insertInlineItems } from "../y-inline";
import type { PageFieldNumberStyle } from "../page-field";

/** The `embedType` discriminant for a cross-reference field. */
export const CROSS_REFERENCE_EMBED_TYPE = "cross-reference";

/** What a field whose bookmark is gone displays (Word's text). */
export const BROKEN_CROSS_REFERENCE_TEXT = "Error! Reference source not found.";

/**
 * What a cross-reference DISPLAYS about its target bookmark (Word's REF / PAGEREF):
 * `"text"` → the bookmarked range's text; `"number"` → the list counter of the
 * paragraph holding the bookmark start; `"page"` → the 1-based page of the bookmark
 * start (LAYOUT-dependent, resolved after pagination; carries a
 * {@link PageFieldNumberStyle}).
 */
export type CrossReferenceMode = "number" | "text" | "page";

/**
 * Pre-computed plan for `insertCrossReference`: the host leaf + offset and the field
 * embed, plus the target paragraph's bookmark markers to write (none when an exact
 * bookmark over the target already exists — Word reuses its `_Ref` bookmark).
 */
interface CrossReferenceInsertPlan {
  readonly blockId: BlockId;
  readonly offset: number;
  readonly embed: EmbedItem;
  readonly bookmark: { readonly targetId: BlockId; readonly bookmarkId: string } | null;
}

/**
 * Insert a cross-reference field to paragraph `targetId` at `position`, atomically
 * (ONE `applyOperation` transaction → one undo entry, one collab event).
 *
 * A cross-reference targets a BOOKMARK, not a block id (Word: REF / PAGEREF target
 * a hidden `_Ref…` bookmark spanning the target paragraph's text; a block id is not
 * a durable reference target). If a bookmark spanning exactly the
 * target's text already exists it is reused; otherwise `bookmark-start` /
 * `bookmark-end` markers are written around the target's content in the same
 * transaction. The field stores `{ bookmarkId, refMode, numberStyle? }`
 * (`numberStyle`, default `"decimal"`, for `refMode === "page"` only).
 *
 * The field OWNS nothing: removing it leaves the bookmark (Word does too); removing
 * the bookmarked text breaks the reference — a legal state rendered as Word's
 * "Error! Reference source not found". Bookmark markers are never tracked.
 *
 * The op TRUSTS a validated target (the editor handler checks its kind for
 * `refMode`); it validates the host position and that the target is a text leaf.
 */
export function insertCrossReference(
  document: Document,
  position: Position,
  targetId: BlockId,
  refMode: CrossReferenceMode,
  numberStyle: PageFieldNumberStyle = "decimal",
): OperationResult {
  const plan = planCrossReferenceInsert(document, position, targetId, refMode, numberStyle);
  return applyOperation(document, (doc) => {
    requireInTransaction(doc, "insertCrossReference");
    insertInlineItems(requireBlockText(doc, plan.blockId, "insertCrossReference"), plan.offset, [plan.embed]);
    if (plan.bookmark !== null) {
      const t = requireBlockText(doc, plan.bookmark.targetId, "insertCrossReference");
      const props = Object.freeze({ bookmarkId: plan.bookmark.bookmarkId });
      // End first (after the target's content, incl. a field just inserted into it).
      insertInlineItems(t, t.length, [marker(BOOKMARK_END_EMBED_TYPE, props)]);
      insertInlineItems(t, 0, [marker(BOOKMARK_START_EMBED_TYPE, props)]);
    }
  });
}

function marker(embedType: string, properties: Readonly<Record<string, unknown>>): EmbedItem {
  return Object.freeze({ kind: "embed", embedType, attrs: Object.freeze({}), properties });
}

/**
 * The id of a bookmark whose markers enclose exactly `items`' content (a start marker
 * precedes every non-marker unit and an end marker follows every one), or null. Its
 * live pair may still be elsewhere (duplicate ids): the caller checks.
 */
function exactBookmarkOver(items: readonly InlineItem[]): string | null {
  const first = items.findIndex((it) => it.kind !== "embed" || !isStructuralMarkerEmbedType(it.embedType));
  const content = first < 0 ? items.length : first;
  let last = items.length - 1;
  while (last >= 0) {
    const it = items[last];
    if (it === undefined || it.kind !== "embed" || !isStructuralMarkerEmbedType(it.embedType)) break;
    last--;
  }
  const starts = new Set<string>();
  for (let i = 0; i < content; i++) {
    const it = items[i];
    const id = it === undefined ? null : bookmarkIdOf(it);
    if (id !== null && it?.kind === "embed" && it.embedType === BOOKMARK_START_EMBED_TYPE) starts.add(id);
  }
  for (let i = last + 1; i < items.length; i++) {
    const it = items[i];
    const id = it === undefined ? null : bookmarkIdOf(it);
    if (id !== null && it?.kind === "embed" && it.embedType === BOOKMARK_END_EMBED_TYPE && starts.has(id)) return id;
  }
  return null;
}

/**
 * Validate `position` and the target and produce the insertion plan. All snapshot
 * reads + validation happen here, BEFORE the surrounding `applyOperation` opens.
 */
function planCrossReferenceInsert(
  document: Document,
  position: Position,
  targetId: BlockId,
  refMode: CrossReferenceMode,
  numberStyle: PageFieldNumberStyle,
): CrossReferenceInsertPlan {
  const resolved = resolveBlock(document, position.blockId);
  if (resolved === null) {
    throw new Error(`insertCrossReference: block "${position.blockId}" not found`);
  }
  const { block } = resolved;
  if (block.inlineContent === null) {
    throw new Error(
      `insertCrossReference: block "${position.blockId}" is not a leaf (no inlineContent)`,
    );
  }
  const totalLen = inlineContentLength(block.inlineContent);
  if (position.offset < 0 || position.offset > totalLen) {
    throw new Error(
      `insertCrossReference: offset ${position.offset} out of range [0, ${totalLen}] for block "${position.blockId}"`,
    );
  }
  const target = resolveBlock(document, targetId)?.block ?? null;
  if (target === null || target.inlineContent === null) {
    throw new Error(`insertCrossReference: target "${targetId}" is not a text block`);
  }
  // Reuse that bookmark only when its id's LIVE pair (duplicate rule) is it: starting in the
  // target (then at its leading marker, so the pair also ends in the target, at the first
  // end marker after it) and ending after all its content.
  const items = target.inlineContent.items;
  const existing = exactBookmarkOver(items);
  const pair = existing === null ? undefined : collectBookmarks(document).get(existing);
  const reuse = pair !== undefined && pair.start.blockId === targetId && !hasContent(items, pair.end.offset, Infinity) ? existing : null;
  const bookmarkId = reuse ?? productionAllocator.allocate();

  const properties =
    refMode === "page"
      ? Object.freeze({ bookmarkId, refMode, numberStyle })
      : Object.freeze({ bookmarkId, refMode });
  const reference: EmbedItem = Object.freeze({
    kind: "embed",
    embedType: CROSS_REFERENCE_EMBED_TYPE,
    attrs: Object.freeze({}),
    properties,
  });

  return {
    blockId: position.blockId,
    offset: position.offset,
    embed: reference,
    bookmark: reuse === null ? { targetId, bookmarkId } : null,
  };
}
