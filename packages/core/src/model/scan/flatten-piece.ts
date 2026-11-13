import * as Y from "yjs";
import { ITEM_KINDS, PIECES_KEY } from "../storage/keys";
import { SUBFLOW_DEPTH_CAP } from "../storage/limits";
import { kindOf } from "../storage/map-reads";
import { scanRanges } from "./scan-range";
import type { ScanCtx, Segment } from "./tokens";

/** The pieces of a sub-flow item's map, in order. */
export function subflowPieces(m: Y.Map<unknown>): Y.Text[] {
  const arr = m.get(PIECES_KEY);
  const out: Y.Text[] = [];
  if (arr instanceof Y.Array) for (const p of arr.toArray()) if (p instanceof Y.Text) out.push(p);
  return out;
}

/** A sub-flow item's map. */
export const isSubflow = (v: unknown): v is Y.Map<unknown> => v instanceof Y.Map && kindOf(v) === ITEM_KINDS.sub;

/** Live sub-flow items of `piece`: their storage index and map. */
function subflowItems(piece: Y.Text): { index: number; map: Y.Map<unknown> }[] {
  const out: { index: number; map: Y.Map<unknown> }[] = [];
  let idx = 0;
  for (let it = piece._start; it !== null; it = it.right) {
    if (it.deleted || !it.countable) continue;
    const c = it.content;
    if (c instanceof Y.ContentType && isSubflow(c.type)) out.push({ index: idx, map: c.type });
    idx += it.length;
  }
  return out;
}

/**
 * A piece's segments in reading order, its sub-flows' pieces (recursively, at most
 * {@link SUBFLOW_DEPTH_CAP} levels) between them. `depth`: the piece's sub-flow depth.
 */
export function flattenPiece(piece: Y.Text, ctx: ScanCtx, out: Segment[] = [], depth = 0): Segment[] {
  const subs = depth >= SUBFLOW_DEPTH_CAP ? [] : subflowItems(piece);
  const ranges: [number, number][] = [];
  let start = 0;
  for (const sub of subs) {
    ranges.push([start, sub.index]);
    start = sub.index + 1;
  }
  ranges.push([start, piece.length]);
  // One walk for all ranges (no range holds a read sub-flow item, so it never aborts).
  const tokens = scanRanges(piece, ranges, ctx, depth);
  ranges.forEach(([from, to], i) => {
    out.push({ piece, depth, start: from, len: to - from, tokens: tokens?.[i] ?? [] });
    const sub = subs[i];
    if (sub !== undefined) for (const p of subflowPieces(sub.map)) flattenPiece(p, ctx, out, depth + 1);
  });
  return out;
}
