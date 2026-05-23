// Type-only import: the runtime cycle between `state/attrs.ts` and
// `cascade/attr-registry.ts` is broken by `import type` (erased at runtime).
// cascade already imports `ReadonlyAttrs` (type-only) from this file; this
// keeps the back-edge type-only as well so there is no runtime cycle.
import type { AttrRegistry } from "../cascade/attr-registry";

/**
 * Open-schema attribute bag. Used at every level of the state tree:
 * - Block.attrs (block-level attributes)
 * - TextItem.attrs (inline text styles)
 * - EmbedItem.attrs (attributes that wrap an embed, e.g. link or comment-range)
 *
 * Plugins register interpreters per attribute key with the cascade module
 * to translate these open-schema values into closed-schema ComputedStyle.
 */
export type ReadonlyAttrs = Readonly<Record<string, unknown>>;

/**
 * Default deep value equality for attribute comparison and run merging.
 * Compares primitives by ===, objects by recursive key/value walk, arrays
 * by element-wise compare. Returns false when types differ (object vs array).
 */
export function deepValueEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;

  const aIsArr = Array.isArray(a);
  const bIsArr = Array.isArray(b);
  if (aIsArr !== bIsArr) return false;

  if (aIsArr && bIsArr) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepValueEqual(a[i], b[i])) return false;
    }
    return true;
  }

  const aRec = a as Record<string, unknown>;
  const bRec = b as Record<string, unknown>;
  const aKeys = Object.keys(aRec);
  const bKeys = Object.keys(bRec);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!(k in bRec)) return false;
    if (!deepValueEqual(aRec[k], bRec[k])) return false;
  }
  return true;
}

/**
 * Compare two attribute bags for equality. Defaults to deep value equality
 * for each attribute. When `registry` is passed, consults each key's
 * registered `AttrInterpreter.equals` (if any) for custom per-key equality —
 * intended for rare cases like a `comment` attribute whose `timestamp`
 * field shouldn't affect run-merge decisions (two adjacent runs with the
 * same comment id but differing timestamps still merge into one).
 *
 * Keys with no registered interpreter, and interpreters without an `equals`
 * function, fall back to `deepValueEqual`.
 */
export function attrsEqual(
  a: ReadonlyAttrs,
  b: ReadonlyAttrs,
  registry?: AttrRegistry,
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!(k in b)) return false;
    const eq = registry?.get(k)?.equals ?? deepValueEqual;
    if (!eq(a[k], b[k])) return false;
  }
  return true;
}

/**
 * Merge incoming attrs into existing attrs.
 * - Keys with value `undefined` in `incoming` are REMOVED from the result.
 * - Other keys in `incoming` overwrite or add to `existing`.
 * - Keys only in `existing` are preserved.
 *
 * Used by `applyAttrsToRange` to support the documented contract that
 * passing `{ bold: undefined }` deletes the `bold` attr from items in
 * range (rather than storing a literal `undefined` value).
 */
export function mergeAttrs(existing: ReadonlyAttrs, incoming: ReadonlyAttrs): ReadonlyAttrs {
  const result: Record<string, unknown> = { ...existing };
  for (const key of Object.keys(incoming)) {
    if (incoming[key] === undefined) {
      delete result[key];
    } else {
      result[key] = incoming[key];
    }
  }
  return Object.freeze(result) as ReadonlyAttrs;
}
