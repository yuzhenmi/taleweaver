import { BLOCK_TYPES } from "../../block";
import type { ParagraphLayout } from "../../position/paragraph-layout";
import { type Scalar, isWriteScalar } from "../../storage/scalar";
import type { At } from "./at";

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/** Flat `p:*` / `m:*` keys. */
export type Keys = Record<string, Scalar>;

export const scalar = (v: unknown): Scalar | undefined => (isWriteScalar(v) ? v : undefined);

/** A paragraph's ¶ keys as the version reads them (a debris / R17 paragraph has none). */
export function keysOf(L: ParagraphLayout): Keys {
  const out: Keys = {};
  if (L.mark === null) return out;
  if (L.block.type !== BLOCK_TYPES.paragraph) out["p:type"] = L.block.type;
  for (const [k, v] of Object.entries(L.block.attrs)) {
    const s = scalar(v);
    if (s !== undefined) out[`p:${k}`] = s;
  }
  for (const [k, v] of Object.entries(L.block.markAttrs ?? {})) {
    const s = scalar(v);
    if (s !== undefined) out[`m:${k}`] = s;
  }
  return out;
}

/** The writes turning keys `from` into `to` (p:* / m:* only). */
export function diffKeys(from: Keys, to: Keys): Record<string, Scalar | undefined> {
  const out: Record<string, Scalar | undefined> = {};
  for (const k of Object.keys(from)) if (!(k in to)) out[k] = undefined;
  for (const [k, v] of Object.entries(to)) if (from[k] !== v) out[k] = v;
  return out;
}

export const pKeys = (k: Keys): Keys => Object.fromEntries(Object.entries(k).filter(([key]) => key.startsWith("p:")));
export const mKeys = (k: Keys): Keys => Object.fromEntries(Object.entries(k).filter(([key]) => key.startsWith("m:")));

/** JOIN: the keys the surviving ¶ takes, or null when it keeps its own (the first paragraph is left an empty default paragraph). */
export function joinKeys(start: At): Keys | null {
  const b = start.L.block;
  const wins = start.offset > 0 || b.type !== BLOCK_TYPES.paragraph || Object.keys(b.attrs).length > 0;
  return wins ? keysOf(start.L) : null;
}
