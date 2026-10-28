/**
 * Paragraph-break / section-break SUGGESTION TAGS (schema 3).
 *
 * A suggested paragraph split or join is not an inline item: it is a revision ON
 * the paragraph mark (Word's model — a tracked paragraph-mark insertion / deletion).
 * It is stored as two plain string keys on the registry entry of the mark that
 * starts the right side of the break (a text block's mark or a section mark):
 *   - `insertionSuggestionId` — this mark was inserted (a suggested split / section
 *                               break insertion);
 *   - `deletionSuggestionId`  — this mark is suggested for removal (a suggested join).
 * The keys are NOT attrs: never cascaded, never copied into fragments, never
 * inherited on split, never touched by `setBlockAttrs`.
 *
 * This module holds the key vocabulary and the raw entry read (no flow / state
 * dependency); `break-suggestions.ts` holds the boundary read model and the writers.
 */
import type * as Y from "yjs";
import type { SuggestionId } from "./suggestions";

export const INSERTION_TAG_KEY = "insertionSuggestionId";
export const DELETION_TAG_KEY = "deletionSuggestionId";

export type BreakTagKey = typeof INSERTION_TAG_KEY | typeof DELETION_TAG_KEY;

export const BREAK_TAG_KEYS: readonly BreakTagKey[] = [INSERTION_TAG_KEY, DELETION_TAG_KEY];

/** True iff `key` is a break-suggestion tag key. */
export function isBreakTagKey(key: string): key is BreakTagKey {
  return key === INSERTION_TAG_KEY || key === DELETION_TAG_KEY;
}

/**
 * The break-suggestion tags of a block (read model, `Block.breakSuggestion`): the
 * raw ids stored on its entry. A tag whose record is absent is still listed here;
 * every consumer that SHOWS a tag (render, ranges, a11y, views) filters it by record
 * presence (see `break-suggestions.ts`).
 */
export interface BreakSuggestion {
  /** This mark was inserted (suggested split / section-break insertion). */
  readonly insertionId?: SuggestionId;
  /** This mark is suggested for removal (suggested join). */
  readonly deletionId?: SuggestionId;
}

const FIELD_OF: Readonly<Record<BreakTagKey, keyof BreakSuggestion>> = {
  [INSERTION_TAG_KEY]: "insertionId",
  [DELETION_TAG_KEY]: "deletionId",
};

/** The tag key a `BreakSuggestion` field is stored under. */
export function breakKeyOf(field: keyof BreakSuggestion): BreakTagKey {
  return field === "insertionId" ? INSERTION_TAG_KEY : DELETION_TAG_KEY;
}

type MapGet = (map: Y.Map<unknown>, key: string) => unknown;
const plainGet: MapGet = (map, key) => map.get(key);

/**
 * The tags stored on `entries` (a chain's entries, head first): per key, the first
 * entry holding it wins (the absent-key rule, as attrs). `undefined` when none.
 */
export function breakSuggestionOfEntries(
  entries: Iterable<Y.Map<unknown>>,
  get: MapGet = plainGet,
): BreakSuggestion | undefined {
  let out: { insertionId?: SuggestionId; deletionId?: SuggestionId } | undefined;
  for (const e of entries) {
    for (const key of BREAK_TAG_KEYS) {
      const v = get(e, key);
      if (typeof v !== "string") continue;
      const field = FIELD_OF[key];
      out ??= {};
      if (out[field] === undefined) out[field] = v as SuggestionId;
    }
  }
  return out === undefined ? undefined : Object.freeze(out);
}
