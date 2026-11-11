/** Test-only table storage builders: raw mark sequences, including states commands never write. */
import * as Y from "yjs";
import { BLOCK_TYPES, type Block } from "../block";
import type { Document, TreeKind } from "../document/types";
import { COL_SPAN_KEY, DEPTH_KEY, HEADER_KEY, ROW_SPAN_KEY } from "../storage/keys";
import { newParagraphMark, newSectionBreak } from "../storage/new-items";
import { newCellMark, newRowMark, newTableEnd, newTableStart } from "../storage/table-marks";
import { childrenOf, textOf } from "./fixture";
import { Harness } from "./harness";

export type Unit = string | Y.Map<unknown>;

const MARK = /^(⟦|⟨r⟩|⟨c⟩|⟧)(h)?(?:r(\d+))?(?:c(\d+))?(?:@(\d+|x))?$/;

/**
 * Units from a compact spec of whitespace-separated words:
 *   - `⟦` `⟨r⟩` `⟨c⟩` `⟧`, then optionally `h` (header row), `r<n>` / `c<n>` (cell spans),
 *     `@<d>` (depth, default 0; `@x` stores an invalid one);
 *   - `¶`, `[S]`;
 *   - any other word is text; a trailing `¶` ends a paragraph (`a¶` = `a` then a ¶).
 */
export function units(spec: string): Unit[] {
  const out: Unit[] = [];
  for (const word of spec.split(/\s+/).filter((w) => w !== "")) {
    const m = MARK.exec(word);
    if (m !== null) {
      const [, mark, h, rs, cs, d] = m;
      const depth = d === undefined ? 0 : d === "x" ? "x" : Number(d);
      const keys: Record<string, number | boolean> = {};
      if (h !== undefined) keys[HEADER_KEY] = true;
      if (rs !== undefined) keys[ROW_SPAN_KEY] = Number(rs);
      if (cs !== undefined) keys[COL_SPAN_KEY] = Number(cs);
      const map = mark === "⟦" ? newTableStart(0, [], keys) : mark === "⟨r⟩" ? newRowMark(0, keys) : mark === "⟨c⟩" ? newCellMark(0, keys) : newTableEnd(0);
      map.set(DEPTH_KEY, depth);
      out.push(map);
    } else if (word === "¶") out.push(newParagraphMark());
    else if (word === "[S]") out.push(newSectionBreak());
    else if (word.endsWith("¶")) out.push(word.slice(0, -1), newParagraphMark());
    else out.push(word);
  }
  return out;
}

/** Insert `us` at storage index `index` of `piece` (in order). */
export function insertUnits(piece: Y.Text, index: number, us: readonly Unit[]): void {
  let i = index;
  for (const u of us) {
    if (typeof u === "string") piece.insert(i, u);
    else piece.insertEmbed(i, u);
    i += typeof u === "string" ? u.length : 1;
  }
}

/** The maps of `us` (marks, ¶s, `[S]`s), in order. */
export const mapsOf = (us: readonly Unit[]): Y.Map<unknown>[] => us.filter((u): u is Y.Map<unknown> => typeof u !== "string");

/** A harness whose body holds `spec` before its final ¶; `edit` may set keys on the spec's maps first. */
export function raw(spec: string | Unit[], edit?: (maps: Y.Map<unknown>[]) => void): Harness {
  const h = new Harness();
  const us = typeof spec === "string" ? units(spec) : spec;
  edit?.(mapsOf(us));
  h.f.doc.transact(() => insertUnits(h.f.piece, 0, us));
  h.history.clear();
  return h;
}

/** A cell's content as text: its blocks' texts joined by `|`, a nested table as `T`. */
const cellText = (d: Document, tree: TreeKind, cell: Block): string =>
  childrenOf(d, tree, cell.id)
    .map((b) => (b.type === BLOCK_TYPES.table ? "T" : textOf(b)))
    .join("|");

/** A table's grid as rows of cell texts. */
export function shape(d: Document, tableId: string, tree: TreeKind = "block"): string[][] {
  return childrenOf(d, tree, tableId).map((r) => childrenOf(d, tree, r.id).map((c) => cellText(d, tree, c)));
}

/** A table's cells as rows of ids. */
export function cellIds(d: Document, tableId: string, tree: TreeKind = "block"): string[][] {
  return childrenOf(d, tree, tableId).map((r) => childrenOf(d, tree, r.id).map((c) => c.id));
}
