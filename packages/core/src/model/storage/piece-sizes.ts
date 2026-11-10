import * as Y from "yjs";
import { PIECE_SOFT_MAX } from "./limits";
import { pieceStructCount } from "./pieces";

/** Whether `budget` more structs fit in `piece` under the piece-size rule. */
export type PieceFits = (piece: Y.Text, budget: number) => boolean;

/** The exact check: one O(piece) walk. */
export const fitsExact: PieceFits = (piece, budget) => pieceStructCount(piece) + budget <= PIECE_SOFT_MAX;

/**
 * {@link fitsExact} for many writes in ONE transaction, without a walk per write: one exact count per piece, then
 * bounds. Within a transaction a piece's struct count never falls (Yjs removes / merges structs only in transaction
 * cleanup), so the last count is a lower bound. An insert call adds ≥ 1 to the local clock and splits ≤ 1 item; every
 * other struct it makes is local, ≥ 1 clock each: so the last count + 2 × the local clock gained since is an upper
 * bound. A check the bounds settle needs no walk; else the piece is recounted. A delete / format (which splits up to 2
 * items for no clock) must {@link PieceSizes.forget} its piece.
 */
export class PieceSizes {
  readonly #counts = new Map<Y.Text, { n: number; clock: number }>();

  readonly fits: PieceFits = (piece, budget) => {
    const doc = piece.doc;
    if (doc === null) return fitsExact(piece, budget);
    const clock = Y.getState(doc.store, doc.clientID);
    const c = this.#counts.get(piece);
    if (c !== undefined) {
      if (c.n + budget > PIECE_SOFT_MAX) return false;
      if (c.n + 2 * (clock - c.clock) + budget <= PIECE_SOFT_MAX) return true;
    }
    const n = pieceStructCount(piece);
    this.#counts.set(piece, { n, clock });
    return n + budget <= PIECE_SOFT_MAX;
  };

  forget(piece: Y.Text): void {
    this.#counts.delete(piece);
  }
}
