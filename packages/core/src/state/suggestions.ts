import * as Y from "yjs";
import type { ReadonlyAttrs } from "./attrs";
import { buildYAttrs } from "./y-block";
import { yMapAsObject } from "./y-utils";
import { getSuggestionsMap, requireInTransaction } from "./yjs-doc";

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
 * The `embedType` discriminant of the zero-width embed that records a suggested
 * JOIN of two blocks (a suggested deletion of a paragraph break with no adjacent
 * text to carry a {@link DELETION_SUGGESTION_ATTR}). Like every other embed it
 * occupies one `Position` offset and emits exactly one zero-width IFC token (see
 * `render/render-core.ts`); it serializes to "" (see `state/extract-text.ts`).
 * Its `properties` carry the owning {@link SuggestionId}. (The visible struck
 * pilcrow is slice 5; slice 1 only preserves the offset invariant.)
 */
export const BLOCK_JOIN_SUGGESTION_EMBED_TYPE = "block-join-suggestion";

/**
 * The `embedType` discriminant of the zero-width embed that records a suggested
 * SPLIT (a suggested insertion of a paragraph break). Same zero-width
 * one-IFC-token / serialize-to-"" contract as
 * {@link BLOCK_JOIN_SUGGESTION_EMBED_TYPE}.
 */
export const BLOCK_SPLIT_SUGGESTION_EMBED_TYPE = "block-split-suggestion";

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
