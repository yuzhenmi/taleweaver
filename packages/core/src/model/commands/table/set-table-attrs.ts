import type * as Y from "yjs";
import type { Plan, Write } from "../../plan";
import { paragraphLayout } from "../../position/paragraph-layout";
import { emptyCellParagraphId } from "../../ids";
import { type Scalar, isWriteScalar } from "../../storage/scalar";
import type { CommandContext } from "../command-context";
import { plan } from "../helpers/build-plan";
import { keysWrite, materialize } from "../helpers/writes";
import { keptSelection, selectedCell } from "./table-at";

/** What a {@link setTableAttrs} writes on: the table's `⟦`, the selected cell's row's `⟨r⟩`, or its `⟨c⟩`. */
export type TablePart = "table" | "row" | "cell";

/** Attrs the read derives on each part's record: a write of them would be shadowed. */
const DERIVED: Readonly<Record<TablePart, readonly string[]>> = { table: ["columnWidths", "headerRowCount"], row: [], cell: ["rowSpan", "colSpan"] };

/**
 * T4: write attrs (`a:*`; null removes) on the selected cell's table, row or cell (GDocs `updateTableStyle` /
 * `updateTableRowStyle` / `updateTableCellStyle`; Word `tblPr` / `trPr` / `tcPr`). An empty key, a value that is no
 * scalar, or an attr the read derives throws. A virtual end cell is made real with the attrs on its `⟨c⟩`. The
 * selection stays (in a made-real cell: a caret at its start).
 */
export function setTableAttrs(ctx: CommandContext, part: TablePart, attrs: Readonly<Record<string, Scalar>>): Plan | null {
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "" || DERIVED[part].includes(k)) throw new Error(`model: ${k === "" ? "an empty" : k} is no ${part} attr`);
    if (!isWriteScalar(v)) throw new Error(`model: ${part} attr ${k} must be null, a string, a finite number or a boolean`);
  }
  const c = selectedCell(ctx);
  if (c === null) return null;
  const map: Y.Map<unknown> | null = part === "table" ? c.form.map : part === "row" ? (c.form.rows[c.row]?.map ?? null) : c.map;
  const keys: Record<string, Scalar | undefined> = {};
  for (const [k, v] of Object.entries(attrs)) if ((map?.get(`a:${k}`) ?? null) !== v) keys[`a:${k}`] = v ?? undefined;
  if (Object.keys(keys).length === 0) return null;
  let writes: Write[];
  if (map !== null) writes = keysWrite(map, keys);
  else {
    // A virtual end cell: its `⟨c⟩` (and the virtual cells' before it) made real, with the attrs (none is null here).
    const L = paragraphLayout(c.d, emptyCellParagraphId(c.cellId));
    const fresh = Object.fromEntries(Object.entries(keys).filter((e): e is [string, Scalar] => e[1] !== undefined));
    const m = L === null ? null : materialize(L, {}, [], undefined, fresh);
    if (m === null) return null;
    writes = m.writes;
  }
  return plan(c.d, writes, keptSelection(ctx, c, 0, 0));
}
