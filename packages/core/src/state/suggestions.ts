import * as Y from "yjs";
import type { ReadonlyAttrs } from "./attrs";
import type { InlineItem } from "./inline-content";
import type { State } from "./state";
import type { Position } from "./block-position";
import { createPosition } from "./block-position";
import { iterateAllBlocksInDocumentOrder } from "./document-order";
import { buildYAttrs } from "./y-block";
import { yMapAsObject } from "./y-utils";
import { STATE_INTERNAL } from "./state-internal";
import { getSuggestionsMap, requireInTransaction } from "./yjs-doc";

declare const crypto: { randomUUID(): string };

/**
 * Branded identifier for a tracked-change suggestion. Minted host-side (slice 3)
 * and stamped into the inline `attrs` of every `TextItem` the suggestion covers
 * (via one of {@link INSERTION_SUGGESTION_ATTR} / {@link DELETION_SUGGESTION_ATTR}
 * / {@link FORMATTING_SUGGESTION_ATTR}) AND used as the key of its
 * {@link SuggestionRecord} in the top-level `suggestions` Y.Map. The structural
 * paragraph-break case (deleting/inserting a block boundary) stamps the id into
 * the `properties` of a {@link BLOCK_JOIN_SUGGESTION_EMBED_TYPE} /
 * {@link BLOCK_SPLIT_SUGGESTION_EMBED_TYPE} embed instead.
 */
export type SuggestionId = string & { readonly __brand: "SuggestionId" };

/**
 * Mint a fresh {@link SuggestionId} for a brand-new suggestion. Mirrors
 * `newListId` (block-id.ts): reuses the same ambient `crypto.randomUUID()` and
 * brands the result. The CREATE ops ({@link mintInsertion} / {@link markDeletion}
 * / {@link markFormatting}) take a pre-minted id as `input.id` (so it can be
 * REUSED when a mark coalesces into an adjacent same-author suggestion); the
 * suggesting-mode editor handlers call this once per create-branch to produce
 * that id.
 */
export function newSuggestionId(): SuggestionId {
  return crypto.randomUUID() as SuggestionId;
}

/**
 * The fields a host supplies to MINT a single-id suggestion (insertion / deletion /
 * formatting / a suggested split or join). `id` is the branded {@link SuggestionId}
 * (minted host-side; REUSED — not consumed — when a create op coalesces into an
 * adjacent same-author suggestion); `author` / `createdAt` are deterministic
 * host-injected values. Shared by every single-id create op
 * (markFormatting / markDeletion / mintInsertion / splitWithSuggestion /
 * markBlockJoinSuggestion). The two-id replace input is {@link ReplaceSuggestionInput}.
 */
export interface SuggestionMintInput {
  readonly id: SuggestionId;
  readonly author: string;
  readonly createdAt: number;
}

/**
 * The three independent suggestion dimensions. A single run can simultaneously
 * be an `insertion` by one author and a pending `deletion` by another, so these
 * are distinct attr dimensions, NOT mutually-exclusive states (see design §2).
 *   - `insertion`  — this run is suggested-inserted text.
 *   - `deletion`   — this run is suggested-deleted (still present until resolved).
 *   - `formatting` — this run has a pending formatting proposal
 *     ({@link SuggestionRecord.proposedAttrs}).
 */
export type SuggestionKind = "insertion" | "deletion" | "formatting";

/**
 * A suggestion's data. Stored as a `Y.Map` in the top-level `suggestions`
 * side-table keyed by {@link SuggestionId}. There is NO range/anchor field —
 * the suggestion's RANGE is DERIVED by a content scan over the items carrying
 * its id (the items move/clone with the text for free; mirror of the comments
 * marker-scan model). `author`/`createdAt` are host-injected
 * (deterministic/testable). `proposedAttrs` is present ONLY for the
 * `formatting` kind: the attrs the suggestion proposes to apply (e.g.
 * `{ bold: true }`), stored CRDT-mergeably as a nested `Y.Map` (built via
 * `buildYAttrs`, read back via the public `yMapAsObject`).
 */
export interface SuggestionRecord {
  readonly id: SuggestionId;
  readonly kind: SuggestionKind;
  readonly author: string;
  readonly createdAt: number;
  readonly proposedAttrs?: Readonly<Record<string, unknown>>;
}

/**
 * Inline-attr key on a `TextItem` marking the run as suggested-inserted. Its
 * value is the owning {@link SuggestionId}. A run can carry this AND
 * {@link DELETION_SUGGESTION_ATTR} simultaneously (B suggests deleting A's
 * suggested insertion). Deliberately NOT part of `INLINE_FORMAT_ATTR_KEYS` (a
 * suggestion id is provenance, not a user-toggleable format).
 */
export const INSERTION_SUGGESTION_ATTR = "insertionSuggestionId";

/** Inline-attr key marking a run as suggested-deleted. Value = {@link SuggestionId}. */
export const DELETION_SUGGESTION_ATTR = "deletionSuggestionId";

/** Inline-attr key marking a run as having a pending formatting proposal. Value = {@link SuggestionId}. */
export const FORMATTING_SUGGESTION_ATTR = "formattingSuggestionId";

/**
 * The `embedType` discriminant of the embed that records a suggested JOIN of two
 * blocks (a suggested deletion of a paragraph break with no adjacent text to
 * carry a {@link DELETION_SUGGESTION_ATTR}). Like every other embed it occupies
 * one `Position` offset and emits exactly one IFC token (the one-token / one-offset
 * #407 invariant); it serializes to "" (see `state/extract-text.ts`). Its
 * `properties` carry the owning {@link SuggestionId}. It RENDERS as a visible
 * struck pilcrow (¶) — a deletion-flavored inline-block atom tinted by the
 * suggestion author's color (see `render/render-core.ts`).
 */
export const BLOCK_JOIN_SUGGESTION_EMBED_TYPE = "block-join-suggestion";

/**
 * The `embedType` discriminant of the embed that records a suggested SPLIT (a
 * suggested insertion of a paragraph break). Same one-IFC-token / one-offset /
 * serialize-to-"" contract as {@link BLOCK_JOIN_SUGGESTION_EMBED_TYPE}, but
 * RENDERS as a visible UNDERLINED pilcrow (¶) — an insertion-flavored inline-block
 * atom tinted by the suggestion author's color.
 */
export const BLOCK_SPLIT_SUGGESTION_EMBED_TYPE = "block-split-suggestion";

/**
 * The preview-view selector for the read/render projection (slice 5c) — a PURE
 * derivation over inline content (never a state mutation) that selects what
 * `extractText` / `getWordCount` / serialize / render see over a document with
 * pending tracked changes:
 *   - `"suggesting"` (default) → the LITERAL document: insertions, deletions, and
 *     formatting proposals are all shown with their suggestion visuals. Live
 *     editing always renders this view.
 *   - `"final"` → the document as it would read if ALL suggestions were ACCEPTED:
 *     insertions kept (as real text), deletions REMOVED, formatting proposals
 *     applied for real.
 *   - `"original"` → as if ALL were REJECTED: insertions REMOVED, deletions kept
 *     (as real text), formatting proposals dropped.
 */
export type SuggestionView = "suggesting" | "final" | "original";

/**
 * Per-item VISIBILITY under a {@link SuggestionView} — the foundation predicate of
 * the slice-5c projection. Returns whether `item` survives into the projected
 * document for `view`:
 *   - `"suggesting"` → everything is visible (the literal document).
 *   - `"final"` (accept all) → a text run carrying a {@link DELETION_SUGGESTION_ATTR}
 *     is absent (its deletion is accepted), and a {@link BLOCK_JOIN_SUGGESTION_EMBED_TYPE}
 *     embed is absent (the suggested break-deletion happens). Insertions/splits stay.
 *   - `"original"` (reject all) → a text run carrying an {@link INSERTION_SUGGESTION_ATTR}
 *     is absent (its insertion is rejected), and a {@link BLOCK_SPLIT_SUGGESTION_EMBED_TYPE}
 *     embed is absent (the suggested split is undone). Deletions/joins stay.
 *
 * A run that is BOTH an insertion AND a deletion (text inserted then struck in
 * suggesting mode) is absent in BOTH non-literal views — accept removes it via the
 * deletion, reject via the insertion — which the two branches yield without a
 * special case. A formatting-marked run is ALWAYS visible (its `proposedAttrs`
 * change only its STYLE, applied at the render surface, never its presence).
 */
export function itemVisibleInView(item: InlineItem, view: SuggestionView): boolean {
  switch (view) {
    case "suggesting":
      // The literal document — every item is visible.
      return true;
    case "final":
      // Accept all → the dimensions resolved AWAY are deletions (text runs) and
      // joins (break embeds); everything else stays.
      return item.kind === "text"
        ? typeof item.attrs[DELETION_SUGGESTION_ATTR] !== "string"
        : item.embedType !== BLOCK_JOIN_SUGGESTION_EMBED_TYPE;
    case "original":
      // Reject all → the symmetric mirror: insertions (text runs) and splits
      // (break embeds) resolve away; everything else stays.
      return item.kind === "text"
        ? typeof item.attrs[INSERTION_SUGGESTION_ATTR] !== "string"
        : item.embedType !== BLOCK_SPLIT_SUGGESTION_EMBED_TYPE;
    default: {
      // Exhaustiveness guard (mirrors `assertNeverWritingMode` / the editor's
      // `action satisfies never`): adding a 4th `SuggestionView` member is a
      // COMPILE error here, forcing its projection to be defined rather than
      // silently mis-treated as one of the existing views.
      const exhaustive: never = view;
      throw new Error(`Unhandled SuggestionView: ${String(exhaustive)}`);
    }
  }
}

/**
 * The slice-5c-structural projection: returns whether a block whose inline content
 * is `items` MERGES with its NEXT sibling in `view` — i.e. its trailing
 * break-suggestion embed (a `block-join-suggestion` / `block-split-suggestion`,
 * always appended LAST by the create ops) is resolved AWAY in this view. A join
 * accepted in `"final"` and a split rejected in `"original"` both merge the two
 * blocks into one paragraph; the literal `"suggesting"` view never merges.
 *
 * The trailing embed's view-INVISIBILITY (per {@link itemVisibleInView}) IS the
 * merge decision — the same `breakMerge = (insertion && reject) || (deletion &&
 * accept)` predicate the `resolve` cascade uses, but read-only and derived from
 * the embed alone (no record read). Consumers suppress the inter-block separator
 * across a merging boundary: `extractText` / word count drop the "\n"; the render
 * projection (the remaining 5c-structural surface) concatenates the block boxes.
 * Always `false` when the block has no trailing break embed.
 */
export function blockBoundaryMergesInView(
  items: ReadonlyArray<InlineItem>,
  view: SuggestionView,
): boolean {
  if (view === "suggesting") return false;
  const last = items[items.length - 1];
  return (
    last !== undefined &&
    last.kind === "embed" &&
    (last.embedType === BLOCK_JOIN_SUGGESTION_EMBED_TYPE ||
      last.embedType === BLOCK_SPLIT_SUGGESTION_EMBED_TYPE) &&
    !itemVisibleInView(last, view)
  );
}

/**
 * The Y.Doc transaction `origin` slice-3's accept/reject ops pass so the resolve
 * txn is NON-undoable. The `History` constructs its `Y.UndoManager` with
 * `trackedOrigins: new Set([null])` — only `null`-origin (default) transactions
 * are tracked — so a transaction tagged with this symbol fires NO UndoManager
 * StackItem event and cannot be reverted by `History.undo`. Accepting/rejecting a
 * suggestion is a final resolution (Google Docs does not let you undo an
 * accept/reject through the normal Ctrl+Z stack), so it must be invisible to the
 * undo manager. Passed via `applyOperation(state, fn, { origin:
 * SUGGESTION_RESOLVE_ORIGIN })` (which forwards it to `runTransaction` →
 * `doc.transact(fn, origin)`); the caller then reconciles the cached
 * `currentState` via {@link History.advanceState} (the non-undoable txn skipped
 * `History.commit`, so `currentState` would otherwise stay pinned at the
 * pre-resolve snapshot).
 *
 * A unique `Symbol` (not a string) keeps the origin from ever colliding with any
 * future origin tag.
 */
export const SUGGESTION_RESOLVE_ORIGIN: unique symbol = Symbol(
  "suggestion-resolve",
);

/**
 * Guarded read of a required field out of an untyped Yjs `Y.Map<unknown>` — the
 * suggestions-map mirror of comments.ts's `requireRecordField`. `Y.Map.get`
 * returns `undefined` for an absent key; a bare `as T` would silently widen that
 * to the expected type and crash opaquely downstream. This turns a malformed
 * record (a collab peer / migration that wrote a record missing a required key)
 * into a clear error naming the field.
 */
function requireRecordField<T>(yMap: Y.Map<unknown>, id: string, key: string): T {
  const raw = yMap.get(key);
  if (raw === undefined) {
    throw new Error(`suggestions: record "${id}" missing required "${key}" field`);
  }
  return raw as T;
}

/**
 * Write (or overwrite) a suggestion record into the top-level `suggestions`
 * Y.Map keyed by `record.id`. Must run inside a transaction (mirrors
 * `writeCommentRecordInTx`). Scalars (`kind`/`author`/`createdAt`) are plain
 * values; the optional `proposedAttrs` (formatting kind only) becomes a nested
 * `Y.Map` via `buildYAttrs` so concurrent proposal edits merge under collab.
 */
export function writeSuggestionRecordInTx(doc: Y.Doc, record: SuggestionRecord): void {
  requireInTransaction(doc, "writeSuggestionRecord");
  const yRecord = new Y.Map<unknown>();
  yRecord.set("kind", record.kind);
  yRecord.set("author", record.author);
  yRecord.set("createdAt", record.createdAt);
  if (record.proposedAttrs !== undefined) {
    yRecord.set("proposedAttrs", buildYAttrs(record.proposedAttrs as ReadonlyAttrs));
  }
  getSuggestionsMap(doc).set(record.id, yRecord);
}

/**
 * Read a suggestion record back out of the `suggestions` map, or `null` if
 * absent. The optional `proposedAttrs` nested `Y.Map` is frozen to a plain
 * object via the PUBLIC `yMapAsObject` (which carries the #142 nested-Y-type
 * guard). The returned record is frozen.
 */
export function readSuggestionRecord(doc: Y.Doc, id: SuggestionId): SuggestionRecord | null {
  const yRecord = getSuggestionsMap(doc).get(id);
  if (yRecord === undefined) return null;
  const base = {
    id,
    kind: requireRecordField<SuggestionKind>(yRecord, id, "kind"),
    author: requireRecordField<string>(yRecord, id, "author"),
    createdAt: requireRecordField<number>(yRecord, id, "createdAt"),
  };
  const yProposed = yRecord.get("proposedAttrs");
  if (yProposed instanceof Y.Map) {
    return Object.freeze({
      ...base,
      proposedAttrs: Object.freeze(yMapAsObject(yProposed)),
    });
  }
  return Object.freeze(base);
}

/**
 * `State`-level read of a single suggestion record, or `null` if absent. Thin
 * wrapper over {@link readSuggestionRecord} that pulls the backing `Y.Doc` out
 * of the opaque `State` so callers OUTSIDE the state module (the render pass
 * resolves suggestion visuals in `expandInlineItems`) can read a record by id
 * WITHOUT reaching into `STATE_INTERNAL` themselves. Mirror of how other
 * cross-module reads (`resolveSuggestionRange`, `getSuggestions`) take `State`
 * rather than a raw `Y.Doc`.
 */
export function readSuggestionRecordFromState(
  state: State,
  id: SuggestionId,
): SuggestionRecord | null {
  return readSuggestionRecord(state[STATE_INTERNAL].doc, id);
}

// ─────────────────────────────────────────────────────────────────────────
// Range index + read surface (slice 2)
// ─────────────────────────────────────────────────────────────────────────

/**
 * A suggestion's resolved RANGE — the span its tagged items cover in document
 * order. `start` is the position of the FIRST item carrying the id; `end` is the
 * position JUST AFTER the LAST (i.e. `[start, end)` is the tagged extent). A
 * suggestion can span multiple contiguous items (a whole inserted run) or even
 * cross blocks (the same id on text in two paragraphs), in which case `start`
 * and `end` name positions in different blocks.
 *
 * Unlike {@link CommentRange} there is NO `orphaned` field on the range itself:
 * a suggestion's items ARE its content (not a paired marker pair that can go
 * one-sided), so the LIVE condition is simply "≥1 item carries the id". Orphaning
 * is therefore derived purely at the read side ({@link getSuggestions}): a record
 * whose id tags no item has NO entry in the index → it is reported `orphaned:
 * true, range: null`. The index thus only ever holds well-formed (non-empty)
 * ranges.
 */
export interface SuggestionRange {
  readonly start: Position;
  readonly end: Position;
}

/** Mutable per-id accumulator used during the single content scan. */
interface RangeAccumulator {
  start: Position;
  end: Position;
}

/**
 * Scan the MAIN-TREE inline content ONCE and build the per-suggestion range
 * index. For every leaf block in document order, accumulate an offset cursor
 * over its inline items:
 *   - a `text` item advances the cursor by `text.length`. For each of the three
 *     suggestion attr keys present in its `attrs`, extend that id's range via
 *     {@link extend} (the first occurrence seeds `start`; each later one only
 *     advances `end` — see that function's JSDoc + the monotonicity note below).
 *   - an `embed` item advances the cursor by 1. If its `embedType` is one of the
 *     break-suggestion embeds ({@link BLOCK_JOIN_SUGGESTION_EMBED_TYPE} /
 *     {@link BLOCK_SPLIT_SUGGESTION_EMBED_TYPE}), read `properties.suggestionId`
 *     and extend that id's range by the embed's 1-offset slot.
 *
 * A single id may appear on multiple contiguous items (a whole inserted run) and
 * across multiple blocks. The scan visits items in strictly-monotone document
 * order (`iterateAllBlocksInDocumentOrder` × per-block offset cursor), so the
 * FIRST occurrence of an id seeds `start` and every later occurrence only needs
 * to advance `end` forward — the unconditional overwrite in {@link extend} is
 * correct precisely because the cursor never moves backward within or across
 * blocks (no `comparePositions` / min-max needed). The walk covers ALL THREE
 * block trees (main, then each `embedContents` body, then each `templateContents`
 * body) so a suggestion tagged in a footnote / header / footer body resolves; a
 * suggestion id is CONTEXT-LOCAL (every item it tags lives in one tree), so its
 * occurrences stay contiguous and monotone within that tree's segment of the walk.
 *
 * Returns only ids with ≥1 tagged item. A record with no items is
 * orphaned-by-absence and surfaced as orphaned at the read side, which holds the
 * record list. One O(N inline-items) walk, no layout — the mirror of
 * {@link buildCommentRangeIndex}.
 */
export function buildSuggestionRangeIndex(
  state: State,
): Map<SuggestionId, SuggestionRange> {
  const acc = new Map<SuggestionId, RangeAccumulator>();

  for (const block of iterateAllBlocksInDocumentOrder(state)) {
    const content = block.inlineContent;
    if (content === null) continue;
    let offset = 0;
    for (const item of content.items) {
      if (item.kind === "text") {
        const itemStart = createPosition(block.id, offset);
        offset += item.text.length;
        const itemEnd = createPosition(block.id, offset);
        // A text item may carry up to all three suggestion-id dimensions at
        // once (insertion-A + deletion-B + formatting-C — distinct ids). Extend
        // every present id's range.
        for (const key of SUGGESTION_ATTR_KEYS) {
          const rawId = item.attrs[key];
          if (typeof rawId === "string") {
            extend(acc, rawId as SuggestionId, itemStart, itemEnd);
          }
        }
        continue;
      }
      // Embed: contributes one offset unit. A break-suggestion embed carries its
      // owning id in `properties.suggestionId`.
      const itemStart = createPosition(block.id, offset);
      offset += 1;
      const itemEnd = createPosition(block.id, offset);
      if (
        item.embedType === BLOCK_JOIN_SUGGESTION_EMBED_TYPE ||
        item.embedType === BLOCK_SPLIT_SUGGESTION_EMBED_TYPE
      ) {
        const rawId = item.properties.suggestionId;
        if (typeof rawId === "string") {
          extend(acc, rawId as SuggestionId, itemStart, itemEnd);
        }
      }
    }
  }

  const index = new Map<SuggestionId, SuggestionRange>();
  for (const [id, range] of acc) {
    index.set(id, Object.freeze({ start: range.start, end: range.end }));
  }
  return index;
}

/** The three inline suggestion-id attr keys, iterated by the range scan. */
const SUGGESTION_ATTR_KEYS = [
  INSERTION_SUGGESTION_ATTR,
  DELETION_SUGGESTION_ATTR,
  FORMATTING_SUGGESTION_ATTR,
] as const;

/**
 * Extend the accumulated range for `id` to enclose `[itemStart, itemEnd]`. The
 * scan visits items in strictly-monotone document order, so the first call seeds
 * `start` and every later call only advances `end` forward — `end` is therefore
 * overwritten unconditionally, with NO min/max or `comparePositions` (the running
 * cursor never moves backward within a block, blocks are visited in document
 * order, and a suggestion id is CONTEXT-LOCAL so all its occurrences fall within
 * one tree's contiguous segment of the {@link iterateAllBlocksInDocumentOrder}
 * walk). See {@link buildSuggestionRangeIndex} for the full monotonicity argument.
 */
function extend(
  acc: Map<SuggestionId, RangeAccumulator>,
  id: SuggestionId,
  itemStart: Position,
  itemEnd: Position,
): void {
  const existing = acc.get(id);
  if (existing === undefined) {
    acc.set(id, { start: itemStart, end: itemEnd });
    return;
  }
  // Document-order monotonicity: the scan only advances, so `itemStart` is never
  // before `existing.start` and `itemEnd` is never before `existing.end`. We
  // therefore only need to push `end` forward; `start` stays at the first
  // occurrence.
  existing.end = itemEnd;
}

/**
 * Resolve a single suggestion's range by content scan, or `null` when no item
 * carries its id (orphaned-by-absence). Mirror of {@link resolveCommentRange}.
 */
export function resolveSuggestionRange(
  state: State,
  id: SuggestionId,
): SuggestionRange | null {
  return buildSuggestionRangeIndex(state).get(id) ?? null;
}

/**
 * A suggestion record combined with its scanned RANGE. `orphaned: true` (with
 * `range: null`) when the record exists in the `suggestions` map but no item
 * carries its id — the whole tagged extent was deleted, or the record was
 * written before any item adopted it. Mirror of {@link ResolvedComment}'s
 * orphaned-by-absence, except a suggestion's range is `null` when orphaned (a
 * suggestion has no defensive paired-marker position to fall back on — its items
 * ARE its content).
 */
export interface ResolvedSuggestion extends SuggestionRecord {
  readonly range: SuggestionRange | null;
  readonly orphaned: boolean;
}

/**
 * The read surface for suggestions: every record in the `suggestions` map joined
 * with its scanned range. A record whose id tags ≥1 item → `{ ...record, range,
 * orphaned: false }`; a record whose id tags nothing → `{ ...record, range:
 * null, orphaned: true }`. One range scan ({@link buildSuggestionRangeIndex})
 * feeds every record — a single O(N inline-items + N records) pass. Frozen
 * output, stable iteration order (the `suggestions` map's key order). Mirror of
 * {@link getComments}.
 */
export function getSuggestions(state: State): readonly ResolvedSuggestion[] {
  const doc = state[STATE_INTERNAL].doc;
  const rangeIndex = buildSuggestionRangeIndex(state);
  const out: ResolvedSuggestion[] = [];
  for (const key of getSuggestionsMap(doc).keys()) {
    const id = key as SuggestionId;
    const record = readSuggestionRecord(doc, id);
    if (record === null) continue;
    const range = rangeIndex.get(id) ?? null;
    out.push(
      Object.freeze({ ...record, range, orphaned: range === null }),
    );
  }
  return Object.freeze(out);
}
