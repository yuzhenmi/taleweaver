import * as Y from "yjs";
import { SUBFLOW_DEPTH_CAP } from "./limits";
import { newSubflow } from "./new-items";
import { type PieceFits, fitsExact } from "./piece-sizes";
import { insertPieceAfter, insertPieceBefore, pieceDepth } from "./pieces";

export interface PiecePoint {
  readonly piece: Y.Text;
  readonly index: number;
}

/**
 * The piece-size rule (X11/X12): the point a write of `budget` structs at `p`
 * actually goes to. A full piece gets a fresh piece after / before it, or (mid
 * piece) a fresh piece inside a new sub-flow, up to {@link SUBFLOW_DEPTH_CAP}.
 * Must run inside the write's transaction. `fits`: the size check (many writes in one transaction: a
 * `PieceSizes`).
 */
export function writablePoint(p: PiecePoint, budget = 1, fits: PieceFits = fitsExact): PiecePoint {
  if (fits(p.piece, budget)) return p;
  if (p.index >= p.piece.length) {
    const fresh = new Y.Text();
    insertPieceAfter(p.piece, fresh);
    return { piece: fresh, index: 0 };
  }
  if (p.index === 0) {
    const fresh = new Y.Text();
    insertPieceBefore(p.piece, fresh);
    return { piece: fresh, index: 0 };
  }
  if (pieceDepth(p.piece) >= SUBFLOW_DEPTH_CAP) return p;
  const fresh = new Y.Text();
  p.piece.insertEmbed(p.index, newSubflow(fresh), {});
  return { piece: fresh, index: 0 };
}
