import type { BlockId } from "../../block";
import type { FlowState } from "../../document/types";
import type { Plan, Write } from "../../plan";
import { caretAt } from "../../position/model-position";
import { itemAt, itemBefore, unitsOf } from "../../position/items";
import { type ParagraphLayout, type StoragePoint, starts } from "../../position/paragraph-layout";
import { comparePoints, pointAfter, pointBefore, storageOf } from "../../position/storage-points";
import { isZeroWidth } from "../../scan/kinds";
import type { CommandContext } from "../command-context";
import type { At, Range } from "./at";
import { plan } from "./build-plan";
import { type Keys, diffKeys, joinKeys, keysOf } from "./paragraph-keys";
import { deleteBetween, idAfter, keysWrite, materialize } from "./writes";

export interface Deletion {
  readonly writes: Write[];
  /** The surviving paragraph's id after Apply. */
  readonly survivor: () => BlockId;
  /** Where the deletion starts: the insertion point for what replaces the range. */
  readonly at: StoragePoint;
}

/**
 * C9: delete everything from `start` to `end` (one flow, start ≤ end). Block objects,
 * `[S]` and whole rule paragraphs inside are taken whole; the end paragraph's ¶
 * survives with the JOIN keys (or `tailKeys`, when given, overriding them).
 * A select-all's start (`At.from`) is its flow's start: the range takes the block
 * objects before the start paragraph too. Zero-width
 * units (anchor edges) never go: those at the range's ends stay where they are, those
 * inside end up at the collapse point — a pair with one edge inside shrinks to it, a
 * pair inside collapses there (Word bookmarks).
 */
export function deleteRange(start: At, end: At, tailKeys?: Keys): Deletion | null {
  const same = start.L.block.id === end.L.block.id;
  const s = pastZeroWidth(start.L, start.offset, 1);
  const e = Math.max(pastZeroWidth(end.L, end.offset, -1), same ? s : 0);
  const a = start.from ?? pointBefore(start.L, s);
  const b = pointAfter(end.L, e);
  if (a === null || b === null) return null;
  const writes = deleteKeepingAnchors(start.L.fs, a, b);
  const join = !same;
  const target = tailKeys ?? (join ? joinKeys(start) : null);
  if (end.L.mark !== null) {
    if (target !== null) writes.push(...keysWrite(end.L.mark, diffKeys(keysOf(end.L), target)));
    const id = end.L.block.id;
    return { writes, survivor: () => id, at: a };
  }
  // Debris stays debris; an implicit end paragraph (a cell's `/empty`, a block object's `/after`) gets its ¶, so
  // what replaces the range is not left without one.
  if (!join && tailKeys === undefined && !end.L.implicit) {
    const id = end.L.block.id;
    return { writes, survivor: () => id, at: a };
  }
  // The end paragraph is debris or implicit: give it a ¶ (X2 / X5) carrying the joined keys.
  const m = materialize(end.L, target ?? {}, [], a);
  if (m === null) return null;
  writes.push(...m.writes);
  const fallback = end.L.block.id;
  return { writes, survivor: () => idAfter(m.map, fallback), at: a };
}

/** Delete storage `[a, b)` except the zero-width units in it. */
export function deleteKeepingAnchors(fs: FlowState, a: StoragePoint, b: StoragePoint): Write[] {
  const out: Write[] = [];
  let from = a;
  for (const p of zeroWidthPoints(fs, a, b)) {
    out.push(...deleteBetween(fs, from, p));
    from = { ...p, index: p.index + 1 };
  }
  out.push(...deleteBetween(fs, from, b));
  return out;
}

/** The storage points of the zero-width units (anchor edges) in storage `[a, b)` of `fs`, in order. */
export function zeroWidthPoints(fs: FlowState, a: StoragePoint, b: StoragePoint): StoragePoint[] {
  const keep: StoragePoint[] = [];
  for (let j = a.seg; j <= b.seg; j++) {
    const seg = fs.segments[j];
    if (seg === undefined) continue;
    const st = starts(seg);
    seg.tokens.forEach((t, k) => {
      if (t.k !== "run") return;
      let q = 0;
      for (const item of t.items) {
        const p = { piece: seg.piece, index: (st[k] ?? 0) + storageOf(t.inert, q), seg: j };
        if (isZeroWidth(item) && comparePoints(a, p) <= 0 && comparePoints(p, b) < 0) keep.push(p);
        q += unitsOf(item);
      }
    });
  }
  return keep;
}

/** `offset` moved over the zero-width units next to it, forward (`dir` 1) or backward (-1), within `L`. */
function pastZeroWidth(L: ParagraphLayout, offset: number, dir: -1 | 1): number {
  let o = offset;
  for (let r = dir > 0 ? itemAt(L, o) : itemBefore(L, o); r !== null && isZeroWidth(r.item); r = dir > 0 ? itemAt(L, o) : itemBefore(L, o)) o = dir > 0 ? r.start + 1 : r.start;
  return o;
}

/** Backspace / Delete over a range: C9. A selected `[hr]` (an inline atom: a one-unit range) is a character like any other: only it goes. */
export function deleteSelectionOf(ctx: CommandContext, r: Range): Plan | null {
  const del = deleteRange(r.start, r.end);
  if (del === null || del.writes.length === 0) return null;
  const offset = r.start.offset;
  return plan(ctx.version, del.writes, () => caretAt(del.survivor(), offset));
}
