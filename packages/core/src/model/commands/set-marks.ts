import type { Plan, Write } from "../plan";
import { pointAfter, pointBefore } from "../position/storage-points";
import type { Scalar } from "../storage/scalar";
import type { CommandContext } from "./command-context";
import { rangeOf } from "./helpers/at";
import { cellsRect } from "./table/cell-rect";
import { overCells } from "./table/over-cells";
import { plan } from "./helpers/build-plan";
import { keysOf } from "./helpers/paragraph-keys";
import { paragraphsBetween } from "./helpers/paragraphs-between";
import { isInclusive } from "./helpers/typing-attrs";
import { checkScalars } from "./helpers/validate";
import { deleteBetween, keysWrite } from "./helpers/writes";

// ---------------------------------------------------------------------------
// Marks and paragraph attrs (C16)
// ---------------------------------------------------------------------------

/** Inline formatting over the selection: `attrs` values set (null removes). A caret has no stored marks in the model (an editor concern). */
export function setMarks(ctx: CommandContext, attrs: Readonly<Record<string, Scalar>>): Plan | null {
  const values = checkScalars(attrs, "mark");
  // A cell selection: every cell of its rectangle, whole (GDocs / Word / PM); empty virtual cells have nothing to mark.
  const cells = cellsRect(ctx);
  if (cells !== null) return overCells(ctx, cells, (c) => setMarks(c, attrs));
  const r = rangeOf(ctx);
  if (r === null || r.collapsed || Object.keys(values).length === 0) return null;
  const a = pointBefore(r.start.L, r.start.offset);
  const b = pointAfter(r.end.L, r.end.offset);
  if (a === null || b === null) return null;
  const writes: Write[] = deleteBetween(r.start.L.fs, a, b).map((w) => (w.k === "delete" ? { k: "format", piece: w.piece, index: w.index, len: w.len, attrs: values } : w));
  // The ¶s: one the range covers, or the end paragraph's when the range ends at its end with
  // content selected, merges the inclusive values into its mark props (today's apply-attrs).
  const opts = ctx.options ?? {};
  const mark: Record<string, Scalar | undefined> = {};
  for (const [k, v] of Object.entries(values)) if (isInclusive(k, opts)) mark[`m:${k}`] = v ?? undefined;
  const endId = r.end.L.block.id;
  const endSelected = r.end.offset === r.end.L.length && (r.start.L.block.id === endId ? r.start.offset < r.end.offset : r.end.offset > 0);
  if (Object.keys(mark).length > 0) {
    for (const L of paragraphsBetween(ctx.version, r.start.L.block.id, endId)) {
      if (L.mark === null || (L.block.id === endId && !endSelected)) continue;
      const cur = keysOf(L);
      const diff: Record<string, Scalar | undefined> = {};
      for (const [k, v] of Object.entries(mark)) if (cur[k] !== v && !(v === undefined && !(k in cur))) diff[k] = v;
      writes.push(...keysWrite(L.mark, diff));
    }
  }
  if (writes.length === 0) return null;
  const sel = ctx.selection;
  return plan(ctx.version, writes, () => sel);
}
