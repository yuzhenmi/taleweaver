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
