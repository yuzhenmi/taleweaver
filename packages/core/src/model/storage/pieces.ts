import * as Y from "yjs";
import { PIECES_KEY } from "./keys";

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/** The flow / sub-flow array holding `piece`. */
export function arrayOfPiece(piece: Y.Text): Y.Array<Y.Text> {
  const it = piece._item;
  if (it === null || !(it.parent instanceof Y.Array)) throw new Error("schema4: detached piece");
  return it.parent;
}

/** The piece holding a sub-flow array, or null when `arr` is a holder's flow. */
export function pieceHoldingSubflow(arr: Y.Array<Y.Text>): Y.Text | null {
  const owner = arr._item;
  if (owner === null || owner.parentSub !== PIECES_KEY || !(owner.parent instanceof Y.Map)) return null;
  const subItem = owner.parent._item;
  return subItem !== null && subItem.parent instanceof Y.Text ? subItem.parent : null;
}

/** Sub-flow nesting depth of `piece` (0 = a top-level piece). */
export function pieceDepth(piece: Y.Text): number {
  let d = 0;
  for (let p = pieceHoldingSubflow(arrayOfPiece(piece)); p !== null; p = pieceHoldingSubflow(arrayOfPiece(p))) d++;
  return d;
}

/** Index of `piece` in its array: a walk bounded by the array's piece count. */
export function pieceIndex(piece: Y.Text): number {
  const arr = arrayOfPiece(piece);
  let n = 0;
  for (let it = arr._start; it !== null; it = it.right) {
    if (it === piece._item) return n;
    if (!it.deleted && it.countable) n += it.length;
  }
  throw new Error("schema4: piece not in its array");
}

/** Insert `fresh` right after `piece` (public `Y.Array.insert` after a bounded walk; X13 dropped). */
export function insertPieceAfter(piece: Y.Text, fresh: Y.Text): void {
  arrayOfPiece(piece).insert(pieceIndex(piece) + 1, [fresh]);
}

export function insertPieceBefore(piece: Y.Text, fresh: Y.Text): void {
  arrayOfPiece(piece).insert(pieceIndex(piece), [fresh]);
}

/** Struct count of a piece (incl. tombstones and formats): the size metric. O(piece). */
export function pieceStructCount(piece: Y.Text): number {
  let n = 0;
  for (let it = piece._start; it !== null; it = it.right) n++;
  return n;
}
