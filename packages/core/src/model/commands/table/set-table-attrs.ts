import type * as Y from "yjs";
import type { Plan, Write } from "../../plan";
import { type Scalar, isWriteScalar } from "../../storage/scalar";
import type { CommandContext } from "../command-context";
import { plan } from "../helpers/build-plan";
import { keysWrite } from "../helpers/writes";
import { selectedRect } from "./cell-rect";
import { realizeVirtual } from "./over-cells";
import { keptSelection, markOf } from "./table-at";

/** What a {@link setTableAttrs} writes on: the table's `⟦`, the selected cell's row's `⟨r⟩`, or its `⟨c⟩`. */
export type TablePart = "table" | "row" | "cell";

/** Attrs the read derives on each part's record: a write of them would be shadowed. */
const DERIVED: Readonly<Record<TablePart, readonly string[]>> = { table: ["columnWidths", "headerRowCount"], row: [], cell: ["rowSpan", "colSpan"] };

/**
 * T4: write attrs (`a:*`; null removes) on the selection's table, on every row of its rectangle, or on every cell of
 * it (a caret: its cell; GDocs `updateTableStyle` / `updateTableRowStyle` / `updateTableCellStyle`; Word `tblPr` /
 * `trPr` / `tcPr`). An empty key, a value that is no scalar, or an attr the read derives throws. Virtual end cells
 * are made real with the attrs on their `⟨c⟩`s, one insert per row. The selection stays (a caret in a made-real cell:
 * at its start).
 */
export function setTableAttrs(ctx: CommandContext, part: TablePart, attrs: Readonly<Record<string, Scalar>>): Plan | null {
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "" || DERIVED[part].includes(k)) throw new Error(`model: ${k === "" ? "an empty" : k} is no ${part} attr`);
    if (!isWriteScalar(v)) throw new Error(`model: ${part} attr ${k} must be null, a string, a finite number or a boolean`);
  }
  const rect = selectedRect(ctx);
  if (rect === null) return null;
  const { c, box } = rect;
  const { form } = c;
  const changed = (map: Y.Map<unknown> | null): Record<string, Scalar | undefined> => {
    const keys: Record<string, Scalar | undefined> = {};
    for (const [k, v] of Object.entries(attrs)) if ((map?.get(`a:${k}`) ?? null) !== v) keys[`a:${k}`] = v ?? undefined;
    return keys;
  };
  const writes: Write[] = [];
  if (part === "table") writes.push(...keysWrite(form.map, changed(form.map)));
  for (let i = box.r0; part !== "table" && i <= box.r1; i++) {
    const row = form.rows[i];
    if (row === undefined) return null;
    if (part === "row") {
      writes.push(...keysWrite(row.map, changed(row.map)));
      continue;
    }
    for (const p of row.placed) {
      if (p.gridCol < box.c0 || p.gridCol > box.c1) continue;
      const m = markOf(c.d, c.fs, p.cellId);
      if (m === null) return null;
      writes.push(...keysWrite(m, changed(m)));
    }
    const fresh = Object.fromEntries(Object.entries(changed(null)).filter((e): e is [string, Scalar] => e[1] !== undefined));
    const v = realizeVirtual(rect, i, { cell: fresh });
    if (v === null) return null;
    writes.push(...v);
  }
  if (writes.length === 0) return null;
  return plan(c.d, writes, keptSelection(ctx, c, 0, 0));
}
