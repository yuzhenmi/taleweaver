/**
 * Bookmarks (Word's model): a named range delimited by paired
 * zero-width inline markers `bookmark-start` / `bookmark-end` carrying
 * `properties.bookmarkId`. Cross-reference fields target a bookmark, never a block
 * id (a block id is not a durable reference target — a split renames text).
 *
 * Markers are structural (`embed-markers.ts`): never formatted, never tracked
 * (Word does not track bookmarks), zero-width in render and text extraction, one
 * Position offset each (as comment markers).
 *
 * Pairing (deterministic and convergent under concurrency / undo): scanning in
 * document order, the FIRST live `bookmark-start` of an id pairs with the first
 * live `bookmark-end` of that id after it. Every other marker of the id is inert —
 * not rendered, not resolved, dropped on copy. A bookmark whose start or end is
 * gone is BROKEN (the field renders Word's "Error! Reference source not found").
 */
import type { State } from "./state";
import type { BlockId } from "./block-id";
import type { Position } from "./block-position";
import { createPosition } from "./block-position";
import type { InlineItem } from "./inline-content";
import type { InlineText } from "./block-text";
import { iterateBlocksInDocumentOrder } from "./document-order";
import { COMMENT_END_EMBED_TYPE } from "./comments";
import { isStructuralMarkerEmbedType } from "./embed-markers";

/** The `embedType` of the marker opening a bookmark. */
export const BOOKMARK_START_EMBED_TYPE = "bookmark-start";
/** The `embedType` of the marker closing a bookmark. */
export const BOOKMARK_END_EMBED_TYPE = "bookmark-end";

/**
 * A paired bookmark: `start` = the position just AFTER its start marker (the first
 * bookmarked unit), `end` = the position of its end marker (just after the last
 * bookmarked unit). `start.blockId` is the paragraph holding the bookmark start
 * (`number` / `page` modes read it).
 */
export interface BookmarkRange {
  readonly start: Position;
  readonly end: Position;
}

/** The `bookmarkId` of a bookmark marker item, or null for any other item. */
export function bookmarkIdOf(item: InlineItem): string | null {
  if (item.kind !== "embed") return null;
  if (item.embedType !== BOOKMARK_START_EMBED_TYPE && item.embedType !== BOOKMARK_END_EMBED_TYPE) return null;
  const id = item.properties.bookmarkId;
  return typeof id === "string" ? id : null;
}

/** A range END marker (binds to the PRECEDING text at a split; START markers bind to the following text). */
function isEndMarker(item: InlineItem | undefined): boolean {
  return item?.kind === "embed" && (item.embedType === BOOKMARK_END_EMBED_TYPE || item.embedType === COMMENT_END_EMBED_TYPE);
}

/** True for any structural marker item. */
function isMarker(item: InlineItem | undefined): boolean {
  return item?.kind === "embed" && isStructuralMarkerEmbedType(item.embedType);
}

/**
 * Where a split at unit `k` of `items` places the new ¶: inside the
 * run of markers adjacent to `k`, AFTER its last end marker (end markers stay with the
 * preceding text) and so BEFORE the start markers that follow it (they stay with the
 * following text).
 */
export function splitOffsetBetweenMarkers(items: readonly InlineItem[], k: number): number {
  const units: InlineItem[] = [];
  for (const it of items) {
    // Text runs never hold markers; only the item boundary matters here.
    if (it.kind === "text") for (let i = 0; i < it.text.length; i++) units.push(it);
    else units.push(it);
  }
  let lo = k;
  while (lo > 0 && isMarker(units[lo - 1])) lo--;
  let hi = k;
  while (hi < units.length && isMarker(units[hi])) hi++;
  let at = lo;
  for (let i = lo; i < hi; i++) if (isEndMarker(units[i])) at = i + 1;
  return at;
}

/** One bookmark marker of one id: a start marker or not, at unit `offset` of block `blockId`. */
export interface BookmarkMarker {
  readonly blockId: BlockId;
  readonly offset: number;
  readonly start: boolean;
}

/**
 * The pairing rule over ONE id's markers given in document order: the first start
 * pairs with the first end after it; every other marker is inert. Undefined when
 * there is no such pair (a broken bookmark).
 */
export function pairBookmarkMarkers(markers: Iterable<BookmarkMarker>): BookmarkRange | undefined {
  let start: Position | undefined;
  for (const m of markers) {
    if (m.start) start ??= createPosition(m.blockId, m.offset + 1);
    else if (start !== undefined) return { start, end: createPosition(m.blockId, m.offset) };
  }
  return undefined;
}

/**
 * Every paired bookmark of the main tree (the duplicate-id rule above), in one pass
 * over the document's inline content. O(document).
 */
export function collectBookmarks(state: State): Map<string, BookmarkRange> {
  const byId = new Map<string, BookmarkMarker[]>();
  for (const block of iterateBlocksInDocumentOrder(state)) {
    if (block.inlineContent === null) continue;
    let offset = 0;
    for (const item of block.inlineContent.items) {
      const id = bookmarkIdOf(item);
      if (id !== null) {
        const m: BookmarkMarker = { blockId: block.id, offset, start: item.kind === "embed" && item.embedType === BOOKMARK_START_EMBED_TYPE };
        const list = byId.get(id);
        if (list === undefined) byId.set(id, [m]);
        else list.push(m);
      }
      offset += item.kind === "text" ? item.text.length : 1;
    }
  }
  const out = new Map<string, BookmarkRange>();
  for (const [id, markers] of byId) {
    const range = pairBookmarkMarkers(markers);
    if (range !== undefined) out.set(id, range);
  }
  return out;
}

/** A bookmark marker at unit `offset` of a paragraph. */
interface BookmarkMarkerAt {
  readonly offset: number;
  readonly id: string;
  readonly start: boolean;
}

/**
 * The bookmark markers a deletion of units [from, to) of `items` touches: `inside`
 * the span, and at its `left` / `right` edge — outside it but separated from it only by
 * other markers (a selection of exactly a bookmark's text leaves its markers just
 * outside).
 */
function bookmarkMarkersOfSpan(
  items: readonly InlineItem[],
  from: number,
  to: number,
): { readonly inside: BookmarkMarkerAt[]; readonly left: BookmarkMarkerAt[]; readonly right: BookmarkMarkerAt[] } {
  const all: (BookmarkMarkerAt | null)[] = [];
  const markerAt: boolean[] = [];
  for (const it of items) {
    if (it.kind === "text") {
      for (let i = 0; i < it.text.length; i++) {
        all.push(null);
        markerAt.push(false);
      }
      continue;
    }
    const id = bookmarkIdOf(it);
    all.push(id === null ? null : { offset: all.length, id, start: it.kind === "embed" && it.embedType === BOOKMARK_START_EMBED_TYPE });
    markerAt.push(isMarker(it));
  }
  const inside: BookmarkMarkerAt[] = [];
  const left: BookmarkMarkerAt[] = [];
  const right: BookmarkMarkerAt[] = [];
  for (let u = from; u < to; u++) {
    const m = all[u];
    if (m !== null && m !== undefined) inside.push(m);
  }
  for (let u = from - 1; u >= 0 && markerAt[u] === true; u--) {
    const m = all[u];
    if (m !== null && m !== undefined) left.push(m);
  }
  for (let u = to; u < all.length && markerAt[u] === true; u++) {
    const m = all[u];
    if (m !== null && m !== undefined) right.push(m);
  }
  return { inside, left, right };
}

/** One deleted part of a paragraph: units [from, to) of `items` (its read model). */
export interface DeletedPart {
  readonly items: readonly InlineItem[];
  readonly from: number;
  readonly to: number;
  /** The paragraph's id: parts of ONE paragraph share it (several parts per paragraph). */
  readonly id?: string;
  /** Content the deletion keeps lies between the previous part and this one, outside both paragraphs. */
  readonly afterGap?: boolean;
}

/** True iff units [from, to) of `items` hold content (a unit that is not a marker). */
export function hasContent(items: readonly InlineItem[], from: number, to: number): boolean {
  let pos = 0;
  for (const it of items) {
    if (pos >= to) break;
    const len = it.kind === "text" ? it.text.length : 1;
    if (pos + len > from && !isMarker(it)) return true;
    pos += len;
  }
  return false;
}

/**
 * The bookmarks a deletion removes (Word: "deleting part of a marked item keeps
 * the bookmark on the remaining text"): those the deleted `parts` (in document order)
 * cover ALL the content of — the start marker inside a part or at a part's LEFT edge,
 * the end marker inside or at a RIGHT edge of a part of the same CONTIGUOUS run of
 * parts (no kept content between them: within a paragraph, after the previous part's
 * paragraph end, before this part's paragraph start, or `afterGap`). (An empty bookmark
 * beside the span is not covered: both its markers sit on one side.)
 */
export function bookmarksRemovedBy(parts: readonly DeletedPart[]): Set<string> {
  const removed = new Set<string>();
  let starts = new Set<string>();
  let ends = new Set<string>();
  const flush = (): void => {
    for (const id of starts) if (ends.has(id)) removed.add(id);
    starts = new Set();
    ends = new Set();
  };
  let prev: DeletedPart | undefined;
  for (const p of parts) {
    if (prev !== undefined) {
      const gap =
        p.afterGap === true ||
        (p.id !== undefined && p.id === prev.id
          ? hasContent(p.items, prev.to, p.from)
          : hasContent(prev.items, prev.to, Infinity) || hasContent(p.items, 0, p.from));
      if (gap) flush();
    }
    const t = bookmarkMarkersOfSpan(p.items, p.from, p.to);
    for (const m of [...t.inside, ...t.left]) if (m.start) starts.add(m.id);
    for (const m of [...t.inside, ...t.right]) if (!m.start) ends.add(m.id);
    prev = p;
  }
  flush();
  return removed;
}

/**
 * `offset` of `items` widened over the run of markers adjacent to it (`backward` = the
 * run ending at it, `forward` = the run starting at it) up to the outermost marker of a
 * bookmark in `ids` — the edge rule {@link bookmarksRemovedBy} applies, so a copy takes
 * exactly the bookmarks a deletion of the same span removes. O(items).
 */
export function widenOverBookmarkMarkers(
  items: readonly InlineItem[],
  offset: number,
  direction: "backward" | "forward",
  ids: ReadonlySet<string>,
): number {
  let pos = 0;
  let i = 0;
  while (i < items.length && pos < offset) {
    const it = items[i];
    pos += it?.kind === "text" ? it.text.length : 1;
    i++;
  }
  if (pos !== offset) return offset; // inside a text run: no adjacent marker
  const step = direction === "backward" ? -1 : 1;
  let out = offset;
  for (let j = direction === "backward" ? i - 1 : i, at = offset; isMarker(items[j]); j += step) {
    at += step;
    const item = items[j];
    const id = item === undefined ? null : bookmarkIdOf(item);
    if (id !== null && ids.has(id)) out = at;
  }
  return out;
}

/**
 * The units {@link deleteKeepingBookmarks} deletes for [from, to) of `items`: the span
 * minus the markers it keeps, plus the edge markers of the `removed` bookmarks. A
 * planner predicting a deletion's result uses it, so the prediction is the rule itself.
 */
export function unitsDeletedBy(items: readonly InlineItem[], from: number, to: number, removed: ReadonlySet<string>): number[] {
  const t = bookmarkMarkersOfSpan(items, from, to);
  const keep = new Set(t.inside.filter((m) => !removed.has(m.id)).map((m) => m.offset));
  const units = [...t.left, ...t.right].filter((m) => removed.has(m.id)).map((m) => m.offset);
  for (let u = from; u < to; u++) if (!keep.has(u)) units.push(u);
  return units;
}

/**
 * Delete units [from, to) of `text` (whose live items are `items`), KEEPING every
 * bookmark marker inside the span whose bookmark is not in `removed` (it lands at the
 * span's collapse point, un-reminted) and also deleting the edge markers of the removed
 * bookmarks. Runs are deleted last-first, so offsets stay valid.
 */
export function deleteKeepingBookmarks(
  text: InlineText,
  items: readonly InlineItem[],
  from: number,
  to: number,
  removed: ReadonlySet<string>,
): void {
  const units = unitsDeletedBy(items, from, to, removed);
  units.sort((a, b) => b - a);
  for (let k = 0; k < units.length; ) {
    const hi = (units[k] ?? 0) + 1;
    let lo = hi - 1;
    k++;
    while (k < units.length && units[k] === lo - 1) lo = units[k++] ?? lo;
    text.delete(lo, hi - lo);
  }
}
