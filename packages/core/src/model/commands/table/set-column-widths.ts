import * as Y from "yjs";
import type { Plan, Write } from "../../plan";
import { COLS_KEY, WIDTH_KEY } from "../../storage/keys";
import { mapOf } from "../../storage/new-items";
import type { CommandContext } from "../command-context";
import { plan } from "../helpers/build-plan";
import { keysWrite } from "../helpers/writes";
import { selectedCell } from "./table-at";

/**
 * T4: the column weights of the selected cell's table (GDocs `updateTableColumnProperties`, Word `gridCol`), one finite
 * weight > 0 per grid column, their sum finite (else it throws). `cols` entries take their `w` (an entry that is no map is replaced);
 * missing ones are appended, so a table with no `cols` becomes fixed. Entries past the column count stay (RT3 ignores
 * them). The selection stays.
 */
export function setColumnWidths(ctx: CommandContext, weights: readonly number[]): Plan | null {
  const c = selectedCell(ctx);
  if (c === null) return null;
  // RT3 divides by their sum: it must be finite too.
  if (weights.length !== c.columnCount || !weights.every((w) => Number.isFinite(w) && w > 0) || !Number.isFinite(weights.reduce((s, w) => s + w, 0))) {
    throw new Error(`model: column widths must be ${c.columnCount} finite weights > 0 with a finite sum`);
  }
  const cols = c.form.map.get(COLS_KEY);
  if (!(cols instanceof Y.Array)) return null;
  const writes: Write[] = [];
  weights.forEach((w, i) => {
    if (i >= cols.length) return;
    const e: unknown = cols.get(i);
    if (!(e instanceof Y.Map)) writes.push({ k: "cols", array: cols, index: i, delete: 1, insert: [mapOf({ [WIDTH_KEY]: w })] });
    else if (e.get(WIDTH_KEY) !== w) writes.push(...keysWrite(e, { [WIDTH_KEY]: w }));
  });
  const more = weights.slice(cols.length).map((w) => mapOf({ [WIDTH_KEY]: w }));
  if (more.length > 0) writes.push({ k: "cols", array: cols, index: cols.length, delete: 0, insert: more });
  if (writes.length === 0) return null;
  const sel = ctx.selection;
  return plan(c.d, writes, () => sel);
}
