import { cleanHeaderCount } from "../../derive/table/table-form";
import type { Plan, Write } from "../../plan";
import { HEADER_KEY } from "../../storage/keys";
import type { CommandContext } from "../command-context";
import { plan } from "../helpers/build-plan";
import { keysWrite } from "../helpers/writes";
import { selectedRect } from "./cell-rect";

/**
 * T4: pin the first `count` rows of the selected cell's table as header rows (GDocs "Pin header rows"; Word's leading
 * "Repeat as header row" run). `count` is clamped to the rows, then down to the largest boundary no merged cell crosses
 * (RT4 reads no more), so the stored flags are the ones that read. Rows past it lose their flag. The selection stays.
 */
export function setHeaderRows(ctx: CommandContext, count: number): Plan | null {
  const c = selectedRect(ctx)?.c ?? null;
  if (c === null || !Number.isInteger(count)) return null;
  const n = cleanHeaderCount(c.form, count);
  const writes: Write[] = c.form.rows.flatMap((r, i) => (r.header === i < n ? [] : keysWrite(r.map, { [HEADER_KEY]: i < n ? true : undefined })));
  if (writes.length === 0) return null;
  const sel = ctx.selection;
  return plan(c.d, writes, () => sel);
}
