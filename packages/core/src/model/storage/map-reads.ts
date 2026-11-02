import * as Y from "yjs";
import { FLOW_KEY, KIND_KEY } from "./keys";
import { isScalar } from "./scalar";

/**
 * The scalar values of `prefix`-keyed entries of `m`, prefix stripped (stripping is
 * injective, so no two keys alias). Built in sorted key order: independent of the
 * map's iteration order.
 */
export function scalarsWithPrefix(m: Y.Map<unknown>, prefix: string): Record<string, unknown> {
  const keys: string[] = [];
  m.forEach((v, k) => {
    if (k.length > prefix.length && k.startsWith(prefix) && isScalar(v)) keys.push(k);
  });
  // fromEntries defines own data properties: a `p:__proto__` key cannot set the prototype.
  return Object.fromEntries(keys.sort().map((k) => [k.slice(prefix.length), m.get(k)]));
}

/** A holder's flow: its `flow` key when that is a `Y.Array`, else null. */
export function flowOf(m: Y.Map<unknown>): Y.Array<Y.Text> | null {
  const f = m.get(FLOW_KEY);
  return f instanceof Y.Array ? f : null;
}

/** `m.get(key)` when it is a `Y.Map`, else null. */
export function childMap(m: Y.Map<unknown>, key: string): Y.Map<unknown> | null {
  const c = m.get(key);
  return c instanceof Y.Map ? c : null;
}

/** The `k` of an embedded item map ("" when missing / not a string). */
export function kindOf(m: Y.Map<unknown>): string {
  const k = m.get(KIND_KEY);
  return typeof k === "string" ? k : "";
}
