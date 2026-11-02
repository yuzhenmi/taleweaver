import type * as Y from "yjs";
import { BLOCK_TYPES, type BlockId, type ReadonlyAttrs } from "../../block";
import type { InsertUnit, Write } from "../../plan";
import { textNeighbours } from "../../position/items";
import type { ParagraphLayout, StoragePoint } from "../../position/paragraph-layout";
import { comparePoints, pointAfter } from "../../position/storage-points";
import { newParagraphMark } from "../../storage/new-items";
import type { CommandContext, CommandOptions } from "../command-context";
import type { Range } from "./at";
import { deleteRange } from "./delete-range";
import { type Keys, diffKeys, joinKeys, keysOf, mKeys, pKeys, scalar } from "./paragraph-keys";
import { idAfter, insertAt, keysWrite, materialize } from "./writes";

const DEFAULT_ONE_SHOT: ReadonlySet<string> = new Set(["listCounterOverride"]);
const defaultNextStyle = (type: string): string | undefined => (type === "heading" ? BLOCK_TYPES.paragraph : undefined);

// ---------------------------------------------------------------------------
// C2 Enter
// ---------------------------------------------------------------------------

/** C2's keys for a split of a paragraph with keys `K` at `k` of `n` units. */
export function splitKeys(K: Keys, type: string, k: number, n: number, L: ParagraphLayout, opts: CommandOptions = {}): { head: Keys; tail: Keys } {
  const oneShot = opts.oneShotAttrs ?? DEFAULT_ONE_SHOT;
  const without = Object.fromEntries(Object.entries(pKeys(K)).filter(([key]) => !oneShot.has(key.slice(2))));
  // One-shot attrs follow the content: they stay on the tail only at k = 0 of a non-empty paragraph.
  const stays = k === 0 && n > 0;
  const headP = stays ? without : pKeys(K);
  const next = k === n ? (opts.nextStyle ?? defaultNextStyle)(type) : undefined;
  const tailP: Keys = next !== undefined ? (next === BLOCK_TYPES.paragraph ? {} : { "p:type": next }) : stays ? pKeys(K) : without;
  let headM: Keys = mKeys(K);
  if (n > 0) {
    headM = {};
    const src = caretTextAttrs(L, k);
    for (const [key, v] of Object.entries(src)) {
      const s = scalar(v);
      if (s !== undefined && opts.isAtomicMark?.(key) !== true && opts.isInclusiveMark?.(key) !== false) headM[`m:${key}`] = s;
    }
  }
  return { head: { ...headP, ...headM }, tail: { ...tailP, ...mKeys(K) } };
}

/** The formatting of the text item before `k` (at the start: after it), as today's split takes for the head's ¶ props. */
function caretTextAttrs(L: ParagraphLayout, k: number): ReadonlyAttrs {
  const { before, after } = textNeighbours(L, k);
  return (k > 0 ? (before ?? after) : (after ?? before))?.item.attrs ?? {};
}

/**
 * The writes splitting the paragraph at `at` (the C2 shape: ¶N inserted at the
 * split, before `extra` units), `deletion` first when the selection was a range.
 * Shared by Enter, TOC / section-break inserts and paste.
 */
export function splitWrites(ctx: CommandContext, r: Range, extra: readonly InsertUnit[] = []): { writes: Write[]; tail: () => BlockId; head: Y.Map<unknown> } | null {
  const { start, end } = r;
  const p = pointAfter(start.L, start.offset);
  if (p === null) return null;
  // The paragraph being split: the start paragraph joined with the end's tail.
  const join = start.L.block.id !== end.L.block.id;
  const winner = join && joinKeys(start) === null ? end.L : start.L;
  const K = keysOf(winner);
  const n = start.offset + (end.L.length - end.offset);
  const { head, tail } = splitKeys(K, winner.block.type, start.offset, n, start.L, ctx.options);
  const headMark = newParagraphMark(head);
  const writes: Write[] = [];
  let tailId: () => BlockId;
  let ins: StoragePoint = p;
  if (!r.collapsed) {
    const del = deleteRange(start, end, tail);
    if (del === null) return null;
    writes.push(...del.writes);
    tailId = del.survivor;
    if (comparePoints(del.at, p) < 0) ins = del.at;
  } else if (end.L.mark !== null) {
    writes.push(...keysWrite(end.L.mark, diffKeys(keysOf(end.L), tail)));
    const id = end.L.block.id;
    tailId = () => id;
  } else {
    // X2: Enter in debris gives the tail its ¶.
    const m = materialize(end.L, tail);
    if (m === null) return null;
    writes.push(...m.writes);
    const fallback = end.L.block.id;
    tailId = () => idAfter(m.map, fallback);
  }
  // ¶N first: when the materialized tail ¶ lands at the same index, plan order puts ¶N before it.
  writes.unshift(insertAt(ins, [{ embed: headMark, attrs: {} }, ...extra]));
  return { writes, tail: tailId, head: headMark };
}
