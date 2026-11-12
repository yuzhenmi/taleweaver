/**
 * Test-only oracle: a pure slot-matrix model of the table row / column commands T1–T3 (design §3, N4 note). A grid is
 * its cells (each a rectangle of slots, with a content tag) and a header flag per row; an uncovered slot is free (a
 * virtual cell). It shares no code with the production placement.
 */

/** A cell: its content tag and its rectangle (head slot, spans). */
export interface ModelCell {
  readonly tag: string;
  readonly row: number;
  readonly col: number;
  readonly rowSpan: number;
  readonly colSpan: number;
}

export interface Grid {
  readonly cells: readonly ModelCell[];
  /** Each row's `header` flag (the row count is its length). */
  readonly header: readonly boolean[];
}

/** A slot: [row, col]. */
export type Slot = readonly [number, number];

/** After a command: the grid (null: the table is gone, C10) and the caret's slot (null with no table). */
export interface Outcome {
  readonly grid: Grid | null;
  readonly caret: Slot | null;
}

/** The column cap (storage/limits `TABLE_COLUMN_CAP`, restated: this is the oracle). */
export const COLUMN_CAP = 63;

export const rowCount = (g: Grid): number => g.header.length;
/** The column count: the widest row. */
export const columnCount = (g: Grid): number => Math.max(0, ...g.cells.map((c) => c.col + c.colSpan));

const covers = (c: ModelCell, r: number, col: number): boolean => c.row <= r && r < c.row + c.rowSpan && c.col <= col && col < c.col + c.colSpan;

/** The cell covering slot (r, col), or null when it is free. */
export const cellAt = (g: Grid, r: number, col: number): ModelCell | null => g.cells.find((c) => covers(c, r, col)) ?? null;

/**
 * The reference rectangle of corners `from` / `to` (default: one slot), grown until no cell crosses its edge (GDocs):
 * a slot's own cell's rectangle, or a free slot's 1×1.
 */
export function grow(g: Grid, from: Slot, to: Slot = from): ModelCell {
  let [r0, r1] = [Math.min(from[0], to[0]), Math.max(from[0], to[0])];
  let [c0, c1] = [Math.min(from[1], to[1]), Math.max(from[1], to[1])];
  for (let grew = true; grew; ) {
    grew = false;
    for (const c of g.cells) {
      if (!(c.row <= r1 && r0 < c.row + c.rowSpan && c.col <= c1 && c0 < c.col + c.colSpan)) continue;
      const [a, b, x, y] = [Math.min(r0, c.row), Math.max(r1, c.row + c.rowSpan - 1), Math.min(c0, c.col), Math.max(c1, c.col + c.colSpan - 1)];
      if (a !== r0 || b !== r1 || x !== c0 || y !== c1) [r0, r1, c0, c1, grew] = [a, b, x, y, true];
    }
  }
  return { tag: "", row: r0, col: c0, rowSpan: r1 - r0 + 1, colSpan: c1 - c0 + 1 };
}

/** Is rectangle `ref` one cell's own (or one free slot)? Then an insert adds one row / column (GDocs). */
const oneCell = (g: Grid, ref: ModelCell): boolean => {
  const c = cellAt(g, ref.row, ref.col);
  return c === null ? ref.rowSpan * ref.colSpan === 1 : c.row === ref.row && c.col === ref.col && c.rowSpan === ref.rowSpan && c.colSpan === ref.colSpan;
};

/** Row r's width: the end of its last covered slot (rows are left-packed). */
const widthOf = (g: Grid, r: number): number => Math.max(0, ...g.cells.filter((c) => c.row <= r && r < c.row + c.rowSpan).map((c) => c.col + c.colSpan));

/** RT4: the leading run of header rows, shrunk while a cell crosses its lower boundary. */
export function headerCount(g: Grid): number {
  let h = 0;
  while (g.header[h] === true) h++;
  while (h > 0 && g.cells.some((c) => c.row < h && h < c.row + c.rowSpan)) h--;
  return h;
}

const empty = (row: number, col: number): ModelCell => ({ tag: "", row, col, rowSpan: 1, colSpan: 1 });

/**
 * T1 rows: as many as the reference rectangle has (one cell's own: one), at line p (its top, or its bottom); crossing cells grow by them,
 * each new row gets an empty cell per uncovered column (GDocs / Word "insert N rows").
 */
export function insertRow(g: Grid, from: Slot, side: "above" | "below", to: Slot = from): Outcome {
  const ref = grow(g, from, to);
  const n = oneCell(g, ref) ? 1 : ref.rowSpan;
  const p = side === "above" ? ref.row : ref.row + ref.rowSpan;
  const crosses = (c: ModelCell): boolean => c.row < p && p < c.row + c.rowSpan;
  const cells = g.cells.map((c) => (c.row >= p ? { ...c, row: c.row + n } : crosses(c) ? { ...c, rowSpan: c.rowSpan + n } : c));
  for (let col = 0; col < columnCount(g); col++) {
    if (g.cells.some((c) => crosses(c) && c.col <= col && col < c.col + c.colSpan)) continue;
    for (let k = 0; k < n; k++) cells.push(empty(p + k, col));
  }
  const header = [...g.header];
  header.splice(p, 0, ...Array.from({ length: n }, () => p < headerCount(g)));
  return { grid: { cells, header }, caret: [ref.row + (side === "above" ? n : 0), ref.col] };
}

/** T1 columns: as many as the reference rectangle has (one cell's own: one), at column j; a straddling cell grows by them, every other row reaching j gets empty cells there. */
export function insertColumn(g: Grid, from: Slot, side: "left" | "right", to: Slot = from): Outcome {
  const ref = grow(g, from, to);
  const n = oneCell(g, ref) ? 1 : ref.colSpan;
  if (columnCount(g) + n > COLUMN_CAP) return { grid: g, caret: from };
  const j = side === "left" ? ref.col : ref.col + ref.colSpan;
  const straddles = (c: ModelCell): boolean => c.col < j && j < c.col + c.colSpan;
  const cells = g.cells.map((c) => (straddles(c) ? { ...c, colSpan: c.colSpan + n } : c.col >= j ? { ...c, col: c.col + n } : c));
  for (let r = 0; r < rowCount(g); r++) {
    if (g.cells.some((c) => straddles(c) && c.row <= r && r < c.row + c.rowSpan)) continue;
    if (widthOf(g, r) >= j) for (let k = 0; k < n; k++) cells.push(empty(r, j + k));
  }
  return { grid: { cells, header: g.header }, caret: [ref.row, ref.col + (side === "left" ? n : 0)] };
}

/** T2: delete the reference's rows [a, b); crossing cells shrink, cells anchored there reaching past b move to row b. */
export function deleteRow(g: Grid, from: Slot, to: Slot = from): Outcome {
  const ref = grow(g, from, to);
  const R = rowCount(g);
  const a = ref.row;
  const b = ref.row + ref.rowSpan;
  if (a === 0 && b >= R) return { grid: null, caret: null };
  const cells: ModelCell[] = [];
  for (const c of g.cells) {
    const end = c.row + c.rowSpan;
    if (c.row < a) cells.push({ ...c, rowSpan: c.rowSpan - Math.max(0, Math.min(end, b) - a) });
    else if (c.row >= b) cells.push({ ...c, row: c.row - (b - a) });
    else if (end > b) cells.push({ ...c, row: a, rowSpan: end - b });
  }
  const grid = { cells, header: g.header.filter((_, r) => r < a || r >= b) };
  return { grid, caret: [b < R ? a : a - 1, Math.min(ref.col, columnCount(grid) - 1)] };
}

/** T3: delete the reference's columns [j, k); cells inside go, cells crossing them narrow. */
export function deleteColumn(g: Grid, from: Slot, to: Slot = from): Outcome {
  const ref = grow(g, from, to);
  const j = ref.col;
  const k = ref.col + ref.colSpan;
  if (j === 0 && k >= columnCount(g)) return { grid: null, caret: null };
  const cells: ModelCell[] = [];
  for (const c of g.cells) {
    const overlap = Math.max(0, Math.min(c.col + c.colSpan, k) - Math.max(c.col, j));
    if (overlap === c.colSpan) continue;
    cells.push({ ...c, colSpan: c.colSpan - overlap, col: c.col < j ? c.col : Math.max(j, c.col - (k - j)) });
  }
  const grid = { cells, header: g.header };
  return { grid, caret: [ref.row, Math.min(j, columnCount(grid) - 1)] };
}

/**
 * T6: merge the rectangle `from`–`to` (any two corners), grown until no cell crosses its edge (GDocs). Its head is the
 * cell at its top-left slot; the non-empty tags of its cells, row-major, joined by `|` (one paragraph each). A
 * rectangle of one cell, or of one free slot, is a no-op. The caret goes to the head.
 */
export function merge(g: Grid, from: Slot, to: Slot = from): Outcome {
  const ref = grow(g, from, to);
  const { row: r0, col: c0, rowSpan, colSpan } = ref;
  const inside = g.cells.filter((c) => c.row >= r0 && c.row < r0 + rowSpan && c.col >= c0 && c.col < c0 + colSpan).sort((a, b) => a.row - b.row || a.col - b.col);
  const one = inside.length === 0 ? rowSpan * colSpan === 1 : inside.length === 1 && inside[0]?.rowSpan === rowSpan && inside[0].colSpan === colSpan;
  if (one) return { grid: g, caret: from };
  const tag = inside
    .map((c) => c.tag)
    .filter((t) => t !== "")
    .join("|");
  const cells = [...g.cells.filter((c) => !inside.includes(c)), { tag, row: r0, col: c0, rowSpan, colSpan }];
  return { grid: { cells, header: g.header }, caret: [r0, c0] };
}

/**
 * T7: unmerge every cell of the reference rectangle: each keeps its tag at its head slot, 1×1, and every other slot it
 * covered gets an empty cell; a row below with free slots left of it is padded with empty cells up to it (cells are
 * positional). No cell spanning more than one slot: a no-op. The caret goes to the rectangle's top-left.
 */
export function unmerge(g: Grid, from: Slot, to: Slot = from): Outcome {
  const ref = grow(g, from, to);
  const heads = g.cells.filter((c) => c.row >= ref.row && c.row < ref.row + ref.rowSpan && c.col >= ref.col && c.col < ref.col + ref.colSpan && c.rowSpan * c.colSpan > 1);
  if (heads.length === 0) return { grid: g, caret: from };
  const cells: ModelCell[] = g.cells.filter((x) => !heads.includes(x));
  const added = new Set<string>();
  const add = (r: number, col: number): void => {
    if (added.has(`${r},${col}`)) return;
    added.add(`${r},${col}`);
    cells.push(empty(r, col));
  };
  for (const c of heads) {
    cells.push({ ...c, rowSpan: 1, colSpan: 1 });
    for (let r = c.row; r < c.row + c.rowSpan; r++) {
      for (let col = 0; col < c.col; col++) if (r > c.row && cellAt(g, r, col) === null) add(r, col);
      for (let col = c.col; col < c.col + c.colSpan; col++) if (r !== c.row || col !== c.col) add(r, col);
    }
  }
  return { grid: { cells, header: g.header }, caret: [ref.row, ref.col] };
}

/**
 * A grid from a picture: one string per row of space-separated slot tags, `.` a free slot; a tag repeated over a
 * rectangle is one spanning cell (tags are unique per cell). The first `headerRows` rows are header rows.
 */
export function gridOf(rows: readonly string[], headerRows = 0): Grid {
  const tags = rows.map((r) => r.split(" ").filter((t) => t !== ""));
  const cells = new Map<string, ModelCell>();
  tags.forEach((row, r) =>
    row.forEach((tag, col) => {
      if (tag === ".") return;
      const c = cells.get(tag);
      if (c === undefined) cells.set(tag, { tag, row: r, col, rowSpan: 1, colSpan: 1 });
      else cells.set(tag, { ...c, rowSpan: Math.max(c.rowSpan, r - c.row + 1), colSpan: Math.max(c.colSpan, col - c.col + 1) });
    }),
  );
  return { cells: [...cells.values()], header: rows.map((_, r) => r < headerRows) };
}

/** A grid's slots, each `tag@row,col:rowSpan×colSpan` of its cell, or `.` when free: what a comparison reads. */
export function slotsOf(g: Grid): string[][] {
  const C = columnCount(g);
  return g.header.map((_, r) =>
    Array.from({ length: C }, (_, col) => {
      const c = cellAt(g, r, col);
      return c === null ? "." : slotLabel(c.tag, c.row, c.col, c.rowSpan, c.colSpan);
    }),
  );
}

export const slotLabel = (tag: string, row: number, col: number, rowSpan: number, colSpan: number): string => `${JSON.stringify(tag)}@${row},${col}:${rowSpan}×${colSpan}`;
