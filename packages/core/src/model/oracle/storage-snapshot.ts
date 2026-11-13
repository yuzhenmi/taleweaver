import { expect } from "vitest";
import * as Y from "yjs";
import { PIECES_KEY } from "../storage/keys";

export interface Snap {
  readonly read: unknown;
  readonly sel: string;
  /** {@link storageOf} the doc. */
  readonly storage: unknown;
}

/**
 * Live storage without ids: pieces as deltas (embedded types recursed), maps by key, arrays in order. What an undo's
 * delete filter keeps (X17) is dropped when empty: empty pieces, and sub-flows whose pieces are all empty.
 */
export function storageOf(v: unknown): unknown {
  if (v instanceof Y.Text) {
    const ops: { insert?: unknown }[] = v.toDelta();
    return ops.flatMap((op) => {
      const pieces = op.insert instanceof Y.Map ? op.insert.get(PIECES_KEY) : undefined;
      return pieces instanceof Y.Array && isEmptyArray(storageOf(pieces)) ? [] : [{ ...op, insert: storageOf(op.insert) }];
    });
  }
  if (v instanceof Y.Map) return Object.fromEntries([...v.entries()].map(([k, x]) => [k, storageOf(x)]));
  if (v instanceof Y.Array) {
    return v.toArray().flatMap((x) => {
      const y = storageOf(x);
      return x instanceof Y.Text && isEmptyArray(y) ? [] : [y];
    });
  }
  return v;
}

const isEmptyArray = (x: unknown): boolean => Array.isArray(x) && x.length === 0;

/** `toEqual` as a boolean. */
export function sameRead(a: unknown, b: unknown): boolean {
  try {
    expect(a).toEqual(b);
    return true;
  } catch {
    return false;
  }
}
