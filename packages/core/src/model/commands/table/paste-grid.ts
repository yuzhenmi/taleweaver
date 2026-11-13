/**
 * The final grid of a cells paste (N7 step 5): which cells a table holds after a fragment overwrites the rectangle `t`,
 * with the cells crossing its edges isolated (PM `isolateHorizontal` / `isolateVertical`).
 */
import type { BlockId } from "../../block";
import type { Box } from "./cell-rect";

/** A cell's slots: its top-left and clipped spans. */
export interface Rect {
  readonly r: number;
  readonly c: number;
  readonly rs: number;
  readonly cs: number;
}

const inBox = (b: Box, r: number, c: number): boolean => r >= b.r0 && r <= b.r1 && c >= b.c0 && c <= b.c1;

const meets = (x: Rect, b: Box): boolean => x.r <= b.r1 && x.r + x.rs - 1 >= b.r0 && x.c <= b.c1 && x.c + x.cs - 1 >= b.c0;

const inside = (x: Rect, b: Box): boolean => x.r >= b.r0 && x.r + x.rs - 1 <= b.r1 && x.c >= b.c0 && x.c + x.cs - 1 <= b.c1;

/**
 * `x − b` as bands: top and bottom take `x`'s full width, left and right only `b`'s rows. The first band holds `x`'s
 * top-left slot whenever that slot is outside `b`.
 */
export function bandsOf(x: Rect, b: Box): Rect[] {
  const end = x.r + x.rs - 1;
  const right = x.c + x.cs - 1;
  const m0 = Math.max(x.r, b.r0);
  const m1 = Math.min(end, b.r1);
  const out: Rect[] = [];
  if (x.r < b.r0) out.push({ r: x.r, c: x.c, rs: b.r0 - x.r, cs: x.cs });
  if (x.c < b.c0) out.push({ r: m0, c: x.c, rs: m1 - m0 + 1, cs: b.c0 - x.c });
  if (right > b.c1) out.push({ r: m0, c: b.c1 + 1, rs: m1 - m0 + 1, cs: right - b.c1 });
  if (end > b.r1) out.push({ r: b.r1 + 1, c: x.c, rs: end - b.r1, cs: x.cs });
  return out;
}

/** What becomes of an existing cell: kept (at `rect`, its spans rewritten when they change), or deleted. */
export type Fate = { readonly kept: Rect } | { readonly deleted: true };

/** An existing cell's fate under a paste over `b`, and the empty cells its other bands become. */
export function fateOf(x: Rect, b: Box): { fate: Fate; bands: Rect[] } {
  if (!meets(x, b)) return { fate: { kept: x }, bands: [] };
  if (inside(x, b)) return { fate: { deleted: true }, bands: [] };
  const bands = bandsOf(x, b);
  if (inBox(b, x.r, x.c)) return { fate: { deleted: true }, bands };
  const [own, ...rest] = bands;
  return own === undefined ? { fate: { deleted: true }, bands: [] } : { fate: { kept: own }, bands: rest };
}

/** A cell of the final grid: an existing one kept, or a new one (`make` gives its units). */
export type FinalCell<N> = { readonly rect: Rect; readonly id: BlockId } | { readonly rect: Rect; readonly make: N };

/**
 * Row `r`'s own cells in the final grid, left to right; a free slot left of an own cell is a padding cell (`pad`).
 * `owner` maps each slot to the index of the final cell covering it.
 */
export function rowSequence<N>(owner: readonly (readonly (number | undefined)[])[], cells: readonly FinalCell<N>[], r: number, pad: N): FinalCell<N>[] {
  const row = owner[r] ?? [];
  const out: FinalCell<N>[] = [];
  let pending: FinalCell<N>[] = [];
  row.forEach((o, c) => {
    if (o === undefined) {
      pending.push({ rect: { r, c, rs: 1, cs: 1 }, make: pad });
      return;
    }
    const f = cells[o];
    if (f === undefined || f.rect.r !== r || f.rect.c !== c) return;
    out.push(...pending, f);
    pending = [];
  });
  return out;
}

/** Slot owners of `cells` in an `R` × `C` grid. */
export function ownersOf<N>(cells: readonly FinalCell<N>[], R: number, C: number): (number | undefined)[][] {
  const owner: (number | undefined)[][] = Array.from({ length: R }, () => Array.from({ length: C }, () => undefined));
  cells.forEach((f, i) => {
    for (let r = f.rect.r; r < f.rect.r + f.rect.rs; r++) for (let c = f.rect.c; c < f.rect.c + f.rect.cs; c++) {
      const row = owner[r];
      if (row !== undefined && c < C) row[c] = i;
    }
  });
  return owner;
}
