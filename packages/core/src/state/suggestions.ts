import * as Y from "yjs";
import type { ReadonlyAttrs } from "./attrs";
import { mergeAttrs } from "./attrs";
import type { InlineItem } from "./inline-content";
import type { Document } from "./state";
import type { Position } from "./block-position";
import { createPosition } from "./block-position";
import { iterateAllBlocksInDocumentOrder } from "./document-order";
import { yMapAsObject } from "./y-utils";
import { STATE_INTERNAL } from "./state-internal";
import { getSuggestionsMap, requireInTransaction } from "./yjs-doc";
import { boundaryRangeParts } from "./break-suggestions";

declare const crypto: { randomUUID(): string };

/**
 * Branded identifier for a tracked-change suggestion. Minted host-side
 * and stamped into the inline `attrs` of every `TextItem` the suggestion covers
 * (via one of {@link INSERTION_SUGGESTION_ATTR} / {@link DELETION_SUGGESTION_ATTR}
 * / {@link FORMATTING_SUGGESTION_ATTR}) AND used as the key of its
 * {@link SuggestionRecord} in the top-level `suggestions` Y.Map. The structural
 * paragraph-break / section-break case (inserting or deleting a boundary) stores
 * the id as a TAG on the mark's registry entry instead (see `break-tags.ts`).
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

let lastSuggestionOrder = 0;

/**
 * The next suggestion mint sequence number (`SuggestionRecord.order`): strictly
 * increasing across every mint of this JS realm, so monotonic per editor. It is the
 * primary suggestion order key ({@link compareSuggestionOrder}), so clocks never decide
 * (a proposal's edits share one `createdAt`; peer clocks skew). A formatting mint
 * additionally bumps its order past every formatting suggestion it stacks on (Lamport)
 * and advances this counter past that value ({@link observeSuggestionOrder}), so it
 * ranks above everything it stacks on across reloads and peers.
 */
export function nextSuggestionOrder(): number {
  // Saturates at the largest safe integer (only reachable via a peer-written maximal
  // order); ties there fall back to `createdAt`, then id.
  lastSuggestionOrder = Math.min(Number.MAX_SAFE_INTEGER, lastSuggestionOrder + 1);
  return lastSuggestionOrder;
}

/** Advance the mint counter past an `order` value seen in a document (Lamport receive). Invalid values are ignored. */
export function observeSuggestionOrder(order: number): void {
  if (isValidSuggestionOrder(order) && order > lastSuggestionOrder) lastSuggestionOrder = order;
}

/** A valid `SuggestionRecord.order`: a non-negative safe integer (anything else reads as absent). */
export function isValidSuggestionOrder(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" && value >= 0;
}

/**
 * The fields a host supplies to MINT a single-id suggestion (insertion / deletion /
 * formatting / a suggested split or join). `id` is the branded {@link SuggestionId}
 * (minted host-side; REUSED — not consumed — when a create op coalesces into an
 * adjacent same-author suggestion); `author` / `createdAt` are deterministic
 * host-injected values. Shared by every single-id create op
 * (markFormatting / markDeletion / mintInsertion / mintLineBreak / splitWithSuggestion /
 * markParagraphMarkDeletion). The two-id replace input is {@link ReplaceSuggestionInput}.
 */
export interface SuggestionMintInput {
  readonly id: SuggestionId;
  readonly author: string;
  readonly createdAt: number;
  /** Mint sequence number (see {@link SuggestionRecord.order}). */
  readonly order?: number;
  /** Mint a fresh record — never extend an adjacent suggestion (host proposals). */
  readonly noCoalesce?: boolean;
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
 * `{ bold: true }`), stored CRDT-mergeably as a nested `Y.Map` keeping every
 * key (read back via the public `yMapAsObject`).
 */
export interface SuggestionRecord {
  readonly id: SuggestionId;
  readonly kind: SuggestionKind;
  readonly author: string;
  readonly createdAt: number;
  /**
   * Mint sequence number, monotonic per editor (`nextSuggestionOrder`) and
   * Lamport-bumped for formatting mints (causal: above everything it stacks on).
   * Formatting suggestions on a run are ordered by (`order`, `createdAt`, id);
   * absent = 0 (older records fall back to `createdAt`, then id).
   */
  readonly order?: number;
  readonly proposedAttrs?: Readonly<Record<string, unknown>>;
  /**
   * The reviewable GROUP this suggestion belongs to (a host proposal spanning several
   * edits). Absent → the suggestion is a group of its own (`groupId ?? id`, see
   * {@link suggestionGroupOf}). Accept / reject act on whole groups.
   */
  readonly groupId?: string;
  /** Host-defined metadata (opaque JSON, e.g. `{ source, reason }`), stored with the record. */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** The group a suggestion belongs to: its `groupId`, or its own id (a group of one). */
export function suggestionGroupOf(record: Pick<SuggestionRecord, "id" | "groupId">): string {
  return record.groupId ?? record.id;
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

/**
 * Key PREFIX of the inline attrs tagging a run with pending formatting proposals. A
 * run carries ONE tag per formatting suggestion — key
 * `formattingSuggestionId:<id>` ({@link formattingSuggestionKey}) — so several
 * suggestions stack on the same characters, each independently resolvable. The `:`
 * separator is deliberately NOT the mark-instance `#` separator: provenance is not a
 * mark, so `markTypeOf` / `getMarkRanges` / `AttrRegistry` never treat a tag as one.
 * Tag value: `true`, or the canonical JSON of the sorted attr keys SHADOWED on this
 * run by an accepted newer suggestion (see {@link resolveFormattingSuggestionTags}).
 */
export const FORMATTING_SUGGESTION_ATTR = "formattingSuggestionId";

const FORMATTING_SUGGESTION_PREFIX = `${FORMATTING_SUGGESTION_ATTR}:`;

/** The run attr key tagging a run with formatting suggestion `id`. */
export function formattingSuggestionKey(id: SuggestionId): string {
  return FORMATTING_SUGGESTION_PREFIX + id;
}

/** True iff `key` is a formatting-suggestion tag ({@link formattingSuggestionKey}). */
export function isFormattingSuggestionKey(key: string): boolean {
  return key.startsWith(FORMATTING_SUGGESTION_PREFIX) && key.length > FORMATTING_SUGGESTION_PREFIX.length;
}

/** The formatting suggestion ids tagged on a run (attr-key order; records not consulted). */
export function formattingSuggestionIds(attrs: ReadonlyAttrs): SuggestionId[] {
  const out: SuggestionId[] = [];
  for (const key of Object.keys(attrs)) {
    if (isFormattingSuggestionKey(key)) out.push(key.slice(FORMATTING_SUGGESTION_PREFIX.length) as SuggestionId);
  }
  return out;
}

/** The attr keys a tag value marks as shadowed (`true` / malformed → none). */
function shadowedKeysOf(value: unknown): Set<string> {
  if (typeof value !== "string") return new Set();
  try {
    const parsed: unknown = JSON.parse(value);
    return new Set(Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : []);
  } catch {
    return new Set();
  }
}

/** The canonical tag value for a shadowed-key set (primitive → exact Yjs attribute equality). */
function tagValueOf(shadowed: ReadonlySet<string>): true | string {
  return shadowed.size === 0 ? true : JSON.stringify([...shadowed].sort());
}

/** One pending formatting suggestion on a run: its record + the keys shadowed on this run. */
export interface PendingFormattingSuggestion {
  readonly record: SuggestionRecord;
  readonly shadowed: ReadonlySet<string>;
}

/**
 * The pending formatting suggestions tagged on a run, ordered by
 * {@link compareSuggestionOrder} (`order`, `createdAt`, id) —
 * deterministic on every peer. A tag whose record is missing (or not a formatting
 * record) is ignored.
 */
export function pendingFormattingSuggestions(
  attrs: ReadonlyAttrs,
  readRecord: (id: SuggestionId) => SuggestionRecord | null,
): PendingFormattingSuggestion[] {
  const out: PendingFormattingSuggestion[] = [];
  for (const id of formattingSuggestionIds(attrs)) {
    const record = readRecord(id);
    if (record === null || record.kind !== "formatting") continue;
    out.push({ record, shadowed: shadowedKeysOf(attrs[formattingSuggestionKey(id)]) });
  }
  return out.sort((a, b) => compareSuggestionOrder(a.record, b.record));
}

/**
 * The (`order`, `createdAt`, id) order of suggestions — deterministic on every peer.
 * `order` comes first: with the Lamport bump it is causal (a formatting mint ranks above
 * everything it stacks on, whatever the clocks say); records without one (0) fall back
 * to `createdAt`, then id. Negative when `a` ranks before `b`.
 */
export function compareSuggestionOrder(
  a: Pick<SuggestionRecord, "id" | "createdAt" | "order">,
  b: Pick<SuggestionRecord, "id" | "createdAt" | "order">,
): number {
  return (a.order ?? 0) - (b.order ?? 0) || a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Resolve formatting suggestions on ONE run (text or visible embed). `decide(id)` says
 * what happens to each tagged suggestion: `"accept"`, `"reject"`, or `null` (stays
 * pending). Suggestions are processed in (`order`, `createdAt`, id) order:
 *   - accept S → live attrs ⊕= `S.proposedAttrs` minus S's shadowed keys; every OLDER
 *     suggestion still pending on the run gets those keys added to its shadowed set
 *     (the newer, accepted value must win over an older proposal's preview);
 *   - reject S → its tag is removed (pending suggestions never shadow).
 * So any sequential accept/reject order — and a set resolve (group / all) — yields the
 * same attrs as accepting in creation order. Tags whose record is missing are stripped.
 * Returns `attrs` itself when no tag is decided (the run is untouched).
 *
 * With `decide = () => "accept"` this is the run's COMPOSITE ("final" / preview) attrs.
 */
export function resolveFormattingSuggestionTags(
  attrs: ReadonlyAttrs,
  decide: (id: SuggestionId) => "accept" | "reject" | null,
  readRecord: (id: SuggestionId) => SuggestionRecord | null,
): ReadonlyAttrs {
  const ids = formattingSuggestionIds(attrs);
  if (!ids.some((id) => decide(id) !== null)) return attrs;
  let live: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (!isFormattingSuggestionKey(key)) live[key] = value;
  }
  const kept: { id: SuggestionId; shadowed: Set<string> }[] = [];
  for (const { record, shadowed } of pendingFormattingSuggestions(attrs, readRecord)) {
    const decision = decide(record.id);
    if (decision === null) {
      kept.push({ id: record.id, shadowed: new Set(shadowed) });
      continue;
    }
    if (decision === "reject") continue;
    const effective: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record.proposedAttrs ?? {})) {
      if (!shadowed.has(key)) effective[key] = value;
    }
    live = { ...mergeAttrs(live, effective) };
    for (const older of kept) for (const key of Object.keys(effective)) older.shadowed.add(key);
  }
  for (const { id, shadowed } of kept) live[formattingSuggestionKey(id)] = tagValueOf(shadowed);
  return Object.freeze(live);
}

/**
 * The preview-view selector for the read/render projection — a PURE
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
 * the preview-view projection. Returns whether `item` survives into the projected
 * document for `view`:
 *   - `"suggesting"` → everything is visible (the literal document).
 *   - `"final"` (accept all) → an item (a text run, or an embed revision such as a
 *     tracked soft line break) carrying a {@link DELETION_SUGGESTION_ATTR}
 *     is absent (its deletion is accepted). Insertions stay.
 *   - `"original"` (reject all) → an item carrying an {@link INSERTION_SUGGESTION_ATTR}
 *     is absent (its insertion is rejected). Deletions stay.
 * Tracked ¶s are not items: they are keys on the ¶'s entry, projected by
 * `boundaryMergesInView` (`break-suggestions.ts`).
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
      // Accept all → deletion runs resolve away; everything else stays.
      return typeof item.attrs[DELETION_SUGGESTION_ATTR] !== "string";
    case "original":
      // Reject all → the symmetric mirror: insertion runs resolve away.
      return typeof item.attrs[INSERTION_SUGGESTION_ATTR] !== "string";
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

function isPlainRecord(v: unknown): v is Readonly<Record<string, unknown>> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Y.AbstractType);
}

/**
 * Write (or overwrite) a suggestion record into the top-level `suggestions`
 * Y.Map keyed by `record.id`. Must run inside a transaction (mirrors
 * `writeCommentRecordInTx`). Scalars (`kind`/`author`/`createdAt`) are plain
 * values; the optional `proposedAttrs` (formatting kind only) becomes a nested
 * `Y.Map` (every key kept) so concurrent proposal edits merge under collab.
 */
export function writeSuggestionRecordInTx(doc: Y.Doc, record: SuggestionRecord): void {
  requireInTransaction(doc, "writeSuggestionRecord");
  const yRecord = new Y.Map<unknown>();
  yRecord.set("kind", record.kind);
  yRecord.set("author", record.author);
  yRecord.set("createdAt", record.createdAt);
  if (isValidSuggestionOrder(record.order)) yRecord.set("order", record.order);
  if (record.proposedAttrs !== undefined) {
    // Every key is kept, `undefined` included: an undefined proposed value means
    // "remove this attr" on accept (a block-attrs map drops undefined instead).
    const yProposed = new Y.Map<unknown>();
    for (const [k, v] of Object.entries(record.proposedAttrs)) yProposed.set(k, v);
    yRecord.set("proposedAttrs", yProposed);
  }
  if (record.groupId !== undefined) yRecord.set("groupId", record.groupId);
  if (record.metadata !== undefined) yRecord.set("metadata", record.metadata);
  getSuggestionsMap(doc).set(record.id, yRecord);
}

/**
 * Read a suggestion record back out of the `suggestions` map, or `null` if
 * absent. The optional `proposedAttrs` nested `Y.Map` is frozen to a plain
 * object via the PUBLIC `yMapAsObject` (which carries the nested-Y-type
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
  const groupId = yRecord.get("groupId");
  const metadata = yRecord.get("metadata");
  const order = yRecord.get("order");
  const grouping = {
    // A peer-written invalid order (Infinity, 1e300, negative, fraction) reads as absent.
    ...(isValidSuggestionOrder(order) ? { order } : {}),
    ...(typeof groupId === "string" ? { groupId } : {}),
    ...(isPlainRecord(metadata) ? { metadata: Object.freeze({ ...metadata }) } : {}),
  };
  const yProposed = yRecord.get("proposedAttrs");
  if (yProposed instanceof Y.Map) {
    return Object.freeze({
      ...base,
      proposedAttrs: Object.freeze(yMapAsObject(yProposed)),
      ...grouping,
    });
  }
  return Object.freeze({ ...base, ...grouping });
}

/**
 * `Document`-level read of a single suggestion record, or `null` if absent. Thin
 * wrapper over {@link readSuggestionRecord} that pulls the backing `Y.Doc` out
 * of the opaque `Document` so callers OUTSIDE the state module (the render pass
 * resolves suggestion visuals in `expandInlineItems`) can read a record by id
 * WITHOUT reaching into `STATE_INTERNAL` themselves. Mirror of how other
 * cross-module reads (`resolveSuggestionRange`, `getSuggestions`) take `Document`
 * rather than a raw `Y.Doc`.
 */
export function readSuggestionRecordFromState(
  state: Document,
  id: SuggestionId,
): SuggestionRecord | null {
  return readSuggestionRecord(state[STATE_INTERNAL].doc, id);
}

// ─────────────────────────────────────────────────────────────────────────
// Range index + read surface
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
 * one-sided), so the LIVE condition is simply "≥1 item carries the id". A record
 * whose id tags nothing has NO entry in the index and is not surfaced by
 * {@link getSuggestions}. The index thus only ever holds well-formed ranges.
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
 *   - an `embed` item advances the cursor by 1; a visible field embed extends the
 *     range of every formatting suggestion tagged on it.
 *   - a key on the block's own ¶ (`boundaryRangeParts`, a section-end item's too)
 *     extends its id's range by the ¶: `[(P, len P), (N, 0)]`, collapsed at
 *     `(P, len P)` when an object or the flow end follows.
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
 * Returns only ids with ≥1 tagged item. A record with no items is not surfaced by
 * the read side ({@link getSuggestions}). One O(N inline-items) walk, no layout —
 * the mirror of {@link buildCommentRangeIndex}.
 */
export function buildSuggestionRangeIndex(
  state: Document,
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
        // A text item may carry every suggestion dimension at once (insertion-A +
        // deletion-B + formatting-C + formatting-D — distinct ids). Extend every
        // present id's range.
        for (const key of SUGGESTION_ATTR_KEYS) {
          const rawId = item.attrs[key];
          if (typeof rawId === "string") {
            extend(acc, rawId as SuggestionId, itemStart, itemEnd);
          }
        }
        for (const id of formattingSuggestionIds(item.attrs)) extend(acc, id, itemStart, itemEnd);
        continue;
      }
      // Embed: contributes one offset unit; a visible field embed inside a
      // formatting suggestion carries its tag, and an inline insertion revision (a
      // tracked soft line break) its insertion id.
      const itemStart = createPosition(block.id, offset);
      offset += 1;
      const itemEnd = createPosition(block.id, offset);
      for (const key of SUGGESTION_ATTR_KEYS) {
        const rawId = item.attrs[key];
        if (typeof rawId === "string") extend(acc, rawId as SuggestionId, itemStart, itemEnd);
      }
      for (const id of formattingSuggestionIds(item.attrs)) extend(acc, id, itemStart, itemEnd);
    }
    for (const p of boundaryRangeParts(state, block)) extend(acc, p.id, p.start, p.end);
  }

  const index = new Map<SuggestionId, SuggestionRange>();
  for (const [id, range] of acc) {
    index.set(id, Object.freeze({ start: range.start, end: range.end }));
  }
  return index;
}

/**
 * The suggestion ids a single inline item carries: a text run via its insertion /
 * deletion attrs ({@link INSERTION_SUGGESTION_ATTR} / `DELETION`) and every
 * formatting tag (`formattingSuggestionIds`); a VISIBLE field embed (footnote-anchor
 * / cross-reference / page-field / tab) via its formatting tags (the only provenance
 * that reaches embeds).
 */
export function suggestionIdsOnItem(item: InlineItem): SuggestionId[] {
  const out: SuggestionId[] = [];
  for (const key of [INSERTION_SUGGESTION_ATTR, DELETION_SUGGESTION_ATTR]) {
    const v = item.attrs[key];
    if (typeof v === "string") out.push(v as SuggestionId);
  }
  out.push(...formattingSuggestionIds(item.attrs));
  return out;
}

/** The single-valued inline suggestion-id attr keys (formatting tags are per-id keys). */
const SUGGESTION_ATTR_KEYS = [INSERTION_SUGGESTION_ATTR, DELETION_SUGGESTION_ATTR] as const;

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
  state: Document,
  id: SuggestionId,
): SuggestionRange | null {
  return buildSuggestionRangeIndex(state).get(id) ?? null;
}

/** A suggestion record combined with its scanned (live) RANGE. */
export interface ResolvedSuggestion extends SuggestionRecord {
  readonly range: SuggestionRange;
}

/**
 * The read surface for suggestions: every record in the `suggestions` map that has
 * a LIVE carrier (≥1 tagged char / embed, or a key on a live ¶), joined with its
 * range. A record with no live carrier is never surfaced and is deleted lazily by the
 * next resolve (its last occurrence was deleted, a concurrent same-key write lost by
 * last-writer-wins, its ¶ was deleted by a peer). Write ops never delete records. One range scan ({@link buildSuggestionRangeIndex}) feeds every
 * record — a single O(N inline-items + N records) pass. Frozen output, stable
 * iteration order (the `suggestions` map's key order).
 */
export function getSuggestions(state: Document): readonly ResolvedSuggestion[] {
  const doc = state[STATE_INTERNAL].doc;
  const rangeIndex = buildSuggestionRangeIndex(state);
  const out: ResolvedSuggestion[] = [];
  for (const key of getSuggestionsMap(doc).keys()) {
    const id = key as SuggestionId;
    const range = rangeIndex.get(id);
    if (range === undefined) continue;
    const record = readSuggestionRecord(doc, id);
    if (record === null) continue;
    out.push(Object.freeze({ ...record, range }));
  }
  return Object.freeze(out);
}

/**
 * A reviewable group of suggestions (a host proposal, or a single suggestion — a group
 * of one). `author` / `createdAt` / `metadata` are the first member's (a proposal writes
 * the same values on every member; a member's own `metadata` may extend it).
 */
export interface SuggestionGroup {
  readonly id: string;
  readonly author: string;
  readonly createdAt: number;
  readonly metadata: Readonly<Record<string, unknown>> | undefined;
  /** The VISIBLE member suggestions (≥1 tagged char / embed), in document order. */
  readonly suggestions: readonly ResolvedSuggestion[];
  /** The live ranges of the members. */
  readonly ranges: readonly SuggestionRange[];
}

/**
 * Every open suggestion group with ≥1 visible member, in document order of its first
 * range. A record with no live range is not a member (see {@link getSuggestions}).
 */
export function getSuggestionGroups(state: Document): readonly SuggestionGroup[] {
  const byGroup = new Map<string, ResolvedSuggestion[]>();
  for (const s of getSuggestions(state)) {
    const key = suggestionGroupOf(s);
    let members = byGroup.get(key);
    if (members === undefined) byGroup.set(key, (members = []));
    members.push(s);
  }
  // Document order: rank each range start by the order the range index produced them.
  const order = new Map<string, number>();
  let k = 0;
  for (const [id] of buildSuggestionRangeIndex(state)) order.set(id, k++);
  const rank = (s: ResolvedSuggestion): number => order.get(s.id) ?? Number.MAX_SAFE_INTEGER;
  const groups: SuggestionGroup[] = [];
  for (const [id, members] of byGroup) {
    members.sort((a, b) => rank(a) - rank(b));
    const first = members[0];
    if (first === undefined) continue;
    groups.push(
      Object.freeze({
        id,
        author: first.author,
        createdAt: first.createdAt,
        metadata: first.metadata,
        suggestions: Object.freeze(members),
        ranges: Object.freeze(members.map((m) => m.range)),
      }),
    );
  }
  const groupRank = (g: SuggestionGroup): number => Math.min(...g.suggestions.map(rank));
  return Object.freeze(groups.sort((a, b) => groupRank(a) - groupRank(b)));
}
