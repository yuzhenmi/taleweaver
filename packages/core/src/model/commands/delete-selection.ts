import type { Plan } from "../plan";
import { isObjectSelection } from "../position/model-position";
import type { CommandContext } from "./command-context";
import { clearCells } from "./table/clear-cells";
import { cellsRect } from "./table/cell-rect";
import { deleteBlockObject } from "./delete-block-object";
import { rangeOf } from "./helpers/at";
import { deleteSelectionOf } from "./helpers/delete-range";

/** C9: delete the selection (cut / type-over without text); an object selection's object (C10). */
export function deleteSelection(ctx: CommandContext): Plan | null {
  const cells = cellsRect(ctx);
  if (cells !== null) return clearCells(ctx, cells); // N7: every cell cleared, the selection stays
  if (isObjectSelection(ctx.selection)) return deleteBlockObject(ctx, ctx.selection.object); // C10
  const r = rangeOf(ctx);
  if (r === null || r.collapsed) return null;
  return deleteSelectionOf(ctx, r);
}
