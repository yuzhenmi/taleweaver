import type { ReadonlyAttrs } from "./block";

/** Equality of two read values: identical, or JSON-equal objects; never throws (a peer's bigint or cycle compares unequal). */
export function valueEqual(x: unknown, y: unknown): boolean {
  if (x === y) return true;
  if (typeof x !== "object" || typeof y !== "object" || x === null || y === null) return false;
  try {
    return JSON.stringify(x) === JSON.stringify(y);
  } catch {
    return false;
  }
}

/** Shallow attrs equality (values are Yjs scalars / JSON; objects compare by JSON). */
export function attrsEqual(a: ReadonlyAttrs, b: ReadonlyAttrs): boolean {
  if (a === b) return true;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k) || !valueEqual(a[k], b[k])) return false;
  }
  return true;
}
