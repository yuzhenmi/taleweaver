/**
 * Tracked paragraph marks (Word's model): a suggested paragraph /
 * section-break INSERTION or DELETION is a revision ON a ¶ — the two keys of
 * `break-tags.ts` on the ¶'s OWN registry entry (the entry its `end` names, a
 * section-end item's paragraph included). This module holds the read model (the ¶
 * drawn at a block's end, view merges, range parts) and the in-transaction writers.
 *
 * A key is SHOWN only while its record exists and its ¶ is live.
 */
import type * as Y from "yjs";
import type { Block } from "./block";
import type { BlockId } from "./block-id";
import type { State } from "./state";
import { resolveBlock } from "./state";
import { STATE_INTERNAL } from "./state-internal";
import type { Position, Span } from "./block-position";
import { createPosition } from "./block-position";
import { inlineContentLength, type InlineItem } from "./inline-content";
import { getSuggestionsMap } from "./yjs-doc";
import { getRegistry } from "./registry";
import { readCtx } from "./flow-read";
import { chainMarks, deleteUnits, joinWithNext, realIdForWrite } from "./flow-ops";
import { iterateSpan } from "./span-iteration";
import { blockAfter } from "./paragraph-neighbour";
import { BREAK_TAG_KEYS, type BreakTagKey } from "./break-tags";
import { DELETION_SUGGESTION_ATTR, readSuggestionRecord, type SuggestionId, type SuggestionView } from "./suggestions";

// ---------------------------------------------------------------------------
// Read model
// ---------------------------------------------------------------------------

/** What a tracked ¶ shows: a paragraph mark or a section-end item, inserted and / or deleted. */
export type BoundaryMarkKind =
  | "split"
  | "join"
  | "split+join"
  | "section-join"
  | "section-insert"
  | "section-insert+section-join";

/** One drawn tracked ¶: its kind + the visible suggestion ids naming it (insertion first). */
export interface BoundaryMark {
  readonly kind: BoundaryMarkKind;
  readonly suggestionIds: readonly SuggestionId[];
}

const docOf = (state: State): Y.Doc => state[STATE_INTERNAL].doc;
const blockOf = (state: State, id: BlockId): Block | null => resolveBlock(state, id)?.block ?? null;

function live(doc: Y.Doc, id: SuggestionId | undefined): id is SuggestionId {
  return id !== undefined && getSuggestionsMap(doc).has(id);
}

/**
 * The tracked ¶ at the END of text block `blockId`: its own visible keys; kind
 * `section-*` when the ¶ is a section-end item (the block ends a doc-root section that
 * another follows). O(1).
 */
export function endMarkOf(state: State, blockId: BlockId): BoundaryMark | null {
  const b = blockOf(state, blockId);
  if (b === null || b.inlineContent === null) return null;
  const doc = docOf(state);
  const ins = live(doc, b.breakSuggestion?.insertionId) ? b.breakSuggestion?.insertionId : undefined;
  const del = live(doc, b.breakSuggestion?.deletionId) ? b.breakSuggestion?.deletionId : undefined;
  if (ins === undefined && del === undefined) return null;
  const section = blockAfter(state, b)?.sectionBreak != null;
  const kind: BoundaryMarkKind =
    ins !== undefined && del !== undefined
      ? section ? "section-insert+section-join" : "split+join"
      : ins !== undefined
        ? section ? "section-insert" : "split"
        : section ? "section-join" : "join";
  const ids = [ins, del].filter((x): x is SuggestionId => x !== undefined);
  return Object.freeze({ kind, suggestionIds: Object.freeze(ids) });
}

/**
 * True iff text blocks `left` | `right` read as ONE paragraph in `view`: ¶`left` is
 * hidden (insertion-keyed in `"original"`, deletion-keyed in `"final"`; never in
 * `"suggesting"`) AND the unit after it starts a paragraph — `right` is the text block
 * right after ¶`left`. A key on a required ¶ (before an object / at a flow end) never
 * merges, exactly as resolving it keeps the ¶. O(1).
 */
export function boundaryMergesInView(state: State, left: Block, right: Block, view: SuggestionView): boolean {
  if (view === "suggesting" || left.inlineContent === null || right.inlineContent === null) return false;
  const doc = docOf(state);
  const id = view === "final" ? left.breakSuggestion?.deletionId : left.breakSuggestion?.insertionId;
  return live(doc, id) && blockAfter(state, left)?.block.id === right.id;
}

/** One `[start, end)` range contribution of a ¶ key. */
export interface BoundaryRangePart {
  readonly id: SuggestionId;
  readonly start: Position;
  readonly end: Position;
}

/**
 * The range parts of text block `b`'s keyed ¶ (records not consulted): ONE part per
 * key, `(b, len)`–`(N, 0)` with N the text block after ¶b, collapsed at `(b, len)` when
 * an object or the flow end follows.
 */
export function boundaryRangeParts(state: State, b: Block): BoundaryRangePart[] {
  const tags = b.breakSuggestion;
  if (b.inlineContent === null || tags === undefined) return [];
  const start = createPosition(b.id, inlineContentLength(b.inlineContent));
  const next = blockAfter(state, b)?.block ?? null;
  const end = next !== null && next.inlineContent !== null ? createPosition(next.id, 0) : start;
  const out: BoundaryRangePart[] = [];
  if (tags.insertionId !== undefined) out.push({ id: tags.insertionId, start, end });
  if (tags.deletionId !== undefined) out.push({ id: tags.deletionId, start, end });
  return out;
}

// ---------------------------------------------------------------------------
// Suggested deletion over ¶s
// ---------------------------------------------------------------------------

/** What a suggested deletion by `author` does to a ¶. */
export type MarkDeletion =
  /** The author's own pending insertion: removed for real. */
  | "remove"
  /** Already deletion-keyed (any author, live record): left as is. */
  | "keep"
  /** Keyed with the deletion id. */
  | "key";

/** The suggested-deletion rule for ¶`b` (own pending insertion → remove; live deletion → keep; else key). */
export function markDeletionOf(state: State, b: Block, author: string): MarkDeletion {
  const doc = docOf(state);
  const ins = b.breakSuggestion?.insertionId;
  if (live(doc, ins) && readSuggestionRecord(doc, ins)?.author === author) return "remove";
  return live(doc, b.breakSuggestion?.deletionId) ? "keep" : "key";
}

/**
 * True iff accepting a suggested deletion of ¶`b` would delete it — `deleteUnits`'
 * invariant-I check on the "final" projection: false at a flow's last ¶ (I2);
 * true when a paragraph follows; before an object, true only when the paragraph ¶b
 * would leave (its content and that of the earlier deletion-keyed ¶s' runs, as the
 * "final" view shows them) is empty and does not follow an object (I1). O(1) unless an
 * object follows (then O(the deletion-keyed run before b)).
 */
export function markDeletableInFinal(state: State, b: Block): boolean {
  const after = blockAfter(state, b)?.block ?? null;
  if (after === null) return false;
  if (after.inlineContent !== null) return true;
  const doc = docOf(state);
  for (let cur: Block = b; ; ) {
    if (cur.inlineContent === null || liveOutside(cur.inlineContent.items, 0, 0)) return false;
    const prev = cur.prevSiblingId === null ? null : blockOf(state, cur.prevSiblingId);
    if (prev === null) return true;
    if (prev.inlineContent === null) return false;
    if (!live(doc, prev.breakSuggestion?.deletionId)) return true;
    cur = prev;
  }
}

/** True iff an item of `items` outside `[from, to)` survives the "final" view (not deletion-tagged). */
function liveOutside(items: readonly InlineItem[], from: number, to: number): boolean {
  let pos = 0;
  for (const it of items) {
    const len = it.kind === "text" ? it.text.length : 1;
    const outside = pos < from || pos + len > to;
    if (outside && typeof it.attrs[DELETION_SUGGESTION_ATTR] !== "string") return true;
    pos += len;
  }
  return false;
}

/**
 * The ¶s a suggested deletion over `span` acts on, in document order: the ¶ of every
 * text block in the span except the last segment's (a span ending at (Q, 0) covers ¶ of
 * Q's predecessor), MINUS each ¶ that `deleteUnits` would skip if the deletion were
 * accepted — the same invariant-I check run on the "final" projection, where struck
 * content and earlier keyed ¶s count as deleted:
 *   - the flow's last ¶ (no unit after it) is skipped (I2);
 *   - a ¶ followed by an object is skipped when the paragraph it would leave
 *     (its surviving content, merged with earlier keyed ¶s' runs) is non-empty or
 *     follows an object (I1).
 * O(span + #¶).
 */
export function paragraphMarksInSpan(state: State, span: Span): Block[] {
  const segs = [...iterateSpan(state, span)];
  const out: Block[] = [];
  let runLive = false;
  let runAfterObject = false;
  let runOpen = false;
  segs.forEach((seg, i) => {
    const b = seg.block;
    if (b.inlineContent === null) {
      runOpen = false;
      return;
    }
    if (!runOpen) {
      const prev = b.prevSiblingId === null ? null : blockOf(state, b.prevSiblingId);
      runAfterObject = prev !== null && prev.inlineContent === null;
      runLive = false;
      runOpen = true;
    }
    runLive ||= liveOutside(b.inlineContent.items, seg.rangeStart, seg.rangeEnd);
    if (i === segs.length - 1) return;
    const after = blockAfter(state, b)?.block ?? null;
    const deletable = after !== null && (after.inlineContent !== null || (!runLive && !runAfterObject));
    if (deletable) out.push(b);
    else runOpen = false;
  });
  return out;
}

// ---------------------------------------------------------------------------
// Writers (in-transaction)
// ---------------------------------------------------------------------------

/** The registry entries holding block `id`'s keys (its chain ¶s' entries). */
export function tagEntriesOf(doc: Y.Doc, id: string): Y.Map<unknown>[] {
  const out: Y.Map<unknown>[] = [];
  for (const e of chainMarks(readCtx(doc), id)) if (!out.includes(e.entry)) out.push(e.entry);
  return out;
}

/** Write key `key` = `suggestionId` on text block `blockId`'s ¶ entry (a derived entity is made real first). The ONLY key writer. */
export function writeBreakTagInTx(doc: Y.Doc, blockId: string, key: BreakTagKey, suggestionId: SuggestionId): void {
  const entry = getRegistry(doc).get(realIdForWrite(doc, blockId));
  if (entry === undefined) throw new Error(`break key: block "${blockId}" not found`);
  if (entry.get(key) !== suggestionId) entry.set(key, suggestionId);
}

/** Delete `keys` from every entry in `entries` (missing keys skipped). */
export function deleteTagKeys(entries: readonly Y.Map<unknown>[], keys: readonly BreakTagKey[] = BREAK_TAG_KEYS): void {
  for (const e of entries) for (const k of keys) if (e.has(k)) e.delete(k);
}

/**
 * Delete ¶`blockId` for real: the merge rule (`joinWithNext`, a section-end ¶ merging
 * the sections too) when a paragraph follows, else through `deleteUnits` (an empty
 * paragraph before an object goes; invariant I may keep the ¶). The ¶'s keys go with
 * its entry. Returns whether the ¶ was deleted. MUST run inside a transaction.
 */
export function deleteParagraphMarkInTx(doc: Y.Doc, blockId: string): boolean {
  if (joinWithNext(doc, blockId) !== null) return true;
  const marks = chainMarks(readCtx(doc), blockId).map((m) => m.item);
  return marks.length > 0 && deleteUnits(doc, { items: marks }).size === marks.length;
}
