import * as Y from "yjs";
import { ITEM_KINDS, PIECES_KEY } from "../storage/keys";
import { SUBFLOW_DEPTH_CAP } from "../storage/limits";
import { kindOf } from "../storage/map-reads";
import { scanRange } from "./scan-range";
import type { ScanCtx, Segment } from "./tokens";

/** The pieces of a sub-flow item's map, in order. */
export function subflowPieces(m: Y.Map<unknown>): Y.Text[] {
  const arr = m.get(PIECES_KEY);
  const out: Y.Text[] = [];
  if (arr instanceof Y.Array) for (const p of arr.toArray()) if (p instanceof Y.Text) out.push(p);
  return out;
}

/** Live sub-flow items of `piece`: their storage index and map. */
function subflowItems(piece: Y.Text): { index: number; map: Y.Map<unknown> }[] {
  const out: { index: number; map: Y.Map<unknown> }[] = [];
  let idx = 0;
  for (let it = piece._start; it !== null; it = it.right) {
    if (it.deleted || !it.countable) continue;
    const c = it.content;
    if (c instanceof Y.ContentType && c.type instanceof Y.Map && kindOf(c.type) === ITEM_KINDS.sub) out.push({ index: idx, map: c.type });
    idx += it.length;
  }
  return out;
}

/**
 * A piece's segments in reading order, its sub-flows' pieces (recursively, at most
 * {@link SUBFLOW_DEPTH_CAP} levels) between them. `depth`: the piece's sub-flow depth.
 */
export function flattenPiece(piece: Y.Text, ctx: ScanCtx, out: Segment[] = [], depth = 0): Segment[] {
  let start = 0;
  const seg = (end: number): void => {
    out.push({ piece, depth, start, len: end - start, tokens: scanRange(piece, start, end, ctx, depth) ?? [] });
  };
  for (const sub of depth >= SUBFLOW_DEPTH_CAP ? [] : subflowItems(piece)) {
    seg(sub.index);
    for (const p of subflowPieces(sub.map)) flattenPiece(p, ctx, out, depth + 1);
    start = sub.index + 1;
  }
  seg(piece.length);
  return out;
}
