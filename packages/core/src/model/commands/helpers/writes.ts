import type * as Y from "yjs";
import type { BlockId } from "../../block";
import type { FlowState } from "../../document/types";
import type { InsertUnit, Write } from "../../plan";
import type { ParagraphLayout, StoragePoint } from "../../position/paragraph-layout";
import { comparePoints, pointAfter, pointOf } from "../../position/storage-points";
import { typeId } from "../../storage/item-id";
import { newParagraphMark } from "../../storage/new-items";
import { newCellMark, newTableEnd } from "../../storage/table-marks";
import { depthOf, roleOf } from "../../scan/tokens";
import type { Scalar } from "../../storage/scalar";
import type { Keys } from "./paragraph-keys";

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export const insertAt = (p: StoragePoint, units: readonly InsertUnit[]): Write => ({ k: "insert", piece: p.piece, index: p.index, units });

export function keysWrite(map: Y.Map<unknown>, keys: Record<string, Scalar | undefined>): Write[] {
  return Object.keys(keys).length === 0 ? [] : [{ k: "keys", map, keys }];
}

/** Delete storage `[a, b)` of one flow, per segment (sub-flow items between segments are kept). */
export function deleteBetween(fs: FlowState, a: StoragePoint, b: StoragePoint): Write[] {
  if (comparePoints(a, b) >= 0) return [];
  const out: Write[] = [];
  for (let j = a.seg; j <= b.seg; j++) {
    const seg = fs.segments[j];
    if (seg === undefined) continue;
    const from = j === a.seg ? a.index : seg.start;
    const to = j === b.seg ? b.index : seg.start + seg.len;
    if (to > from) out.push({ k: "delete", piece: seg.piece, index: from, len: to - from });
  }
  return out;
}

/**
 * An unclosed table's implicit paragraph (its `before` is the `⟦`; not one of its virtual end cells, which stay inside)
 * made real: the missing `⟧` first, so it reads after the table — unless the same plan deletes the table (its `⟦` at or after `deletedFrom`, a range's start).
 */
function tableClose(L: ParagraphLayout, deletedFrom?: StoragePoint): InsertUnit[] {
  const open = L.implicit && L.virtualCell === undefined ? L.before : null;
  const at = open === null ? null : pointOf(L.fs, open);
  if (deletedFrom !== undefined && at !== null && comparePoints(deletedFrom, at) <= 0) return [];
  const d = open === null || roleOf(open.token) !== "open" ? null : depthOf(open.token);
  return d === null ? [] : [{ embed: newTableEnd(d), attrs: {} }];
}

/**
 * A virtual end cell's paragraph made real (design: short rows): real `⟨c⟩¶` cells for the virtual cells before it
 * in its row, then its own `⟨c⟩` (its ¶ follows). `cellKeys`: its own `⟨c⟩`'s keys, or each one's by rank in the row's
 * virtual run (1 = the first; the lead cells get none otherwise). Nothing for any other paragraph.
 */
function cellLead(L: ParagraphLayout, cellKeys: Keys | ((rank: number) => Keys)): InsertUnit[] {
  const v = L.virtualCell;
  if (v === undefined) return [];
  const keysAt = (rank: number): Keys => (typeof cellKeys === "function" ? cellKeys(rank) : rank === v.rank ? cellKeys : {});
  const out: InsertUnit[] = [];
  for (let i = 1; i < v.rank; i++) {
    out.push({ embed: newCellMark(v.depth, keysAt(i)), attrs: {} });
    if (!(i === 1 && v.firstHolds)) out.push({ embed: newParagraphMark({}), attrs: {} });
  }
  out.push({ embed: newCellMark(v.depth, keysAt(v.rank)), attrs: {} });
  return out;
}

/**
 * X2: the writes inserting a ¶ (with `keys`) at the end of debris / R17 paragraph `L`,
 * and the new map (a virtual end cell's own `⟨c⟩` gets `cellKeys`). Null when the flow cannot be written (a holder without a flow).
 */
export function materialize(L: ParagraphLayout, keys: Keys, before: readonly InsertUnit[] = [], deletedFrom?: StoragePoint, cellKeys: Keys | ((rank: number) => Keys) = {}): { writes: Write[]; map: Y.Map<unknown> } | null {
  const map = newParagraphMark(keys);
  const units: InsertUnit[] = [...tableClose(L, deletedFrom), ...cellLead(L, cellKeys), ...before, { embed: map, attrs: {} }];
  const p = pointAfter(L, L.length);
  if (p !== null) return { writes: [insertAt(p, units)], map };
  return L.fs.array === null ? null : { writes: [{ k: "firstPiece", flow: L.fs.array, units }], map };
}

/** The id a materialized / surviving ¶ reads as after Apply. */
export const idAfter = (map: Y.Map<unknown>, fallback: BlockId): BlockId => typeId(map) ?? fallback;

/** X5 for a command whose caret stays in paragraph `L`: an implicit one first gets its ¶ (default keys); the id `L` reads as after Apply. */
export function keepParagraph(L: ParagraphLayout): { writes: Write[]; id: () => BlockId } {
  const m = L.implicit ? materialize(L, {}) : null;
  const id = L.block.id;
  return m === null ? { writes: [], id: () => id } : { writes: m.writes, id: () => idAfter(m.map, id) };
}
